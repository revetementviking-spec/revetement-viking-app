import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { MODELES } from "@/lib/viking-ai";
import { OUTILS_JARVIS, OUTILS_ACTION, executerOutilJarvis, encadrerDonnees, CONSIGNE_DONNEES } from "@/lib/jarvis";
import { utilisateurActif } from "@/lib/authUser";
import { enregistrerCoutIA, coutMoisCourantIA, type UsageIA } from "@/lib/ia-couts";
import { aujourdhuiMontreal } from "@/lib/date";

export const dynamic = "force-dynamic";
// Jusqu'à 8 tours d'outils avec Opus : 60 s coupaient les questions qui creusent.
export const maxDuration = 300;

const SYSTEME = `Tu es « Jarvis », l'assistant d'intelligence d'affaires de Revêtement Viking Inc. (entrepreneur en revêtement extérieur, Québec, RBQ 5811-4299-01). Tu réponds à Francis (le proprio) et à Gabriel à propos de LEURS vraies données d'entreprise.

RÈGLES :
- Utilise TOUJOURS les outils pour obtenir les chiffres réels. Ne devine JAMAIS un montant ou une donnée.
- Pour une question générale, commence par « apercu_entreprise », puis creuse avec les outils spécifiques au besoin.
- Tu peux appeler plusieurs outils, en plusieurs tours, avant de répondre.
- EFFICACITÉ : quand tu as besoin de plusieurs informations INDÉPENDANTES, appelle les outils EN PARALLÈLE (plusieurs outils dans un seul tour) plutôt qu'un à la fois. Ça répond plus vite.
- Réponds en français du Québec, de façon claire et actionnable. Va droit au but.
- Formate les montants en dollars CAD (ex: 12 500 $). Utilise des listes/tableaux courts quand c'est utile.
- Contexte fiscal : taxes TPS 5 % + TVQ 9,975 %. La RENTABILITÉ se calcule AVANT taxes (revenu ÷ 1,14975 − coûts). Le revenu d'un projet = prix de contrat + extras facturés. La main-d'œuvre est un coût.
- Un projet « complété » est considéré facturé.
- Tu peux PROPOSER des actions (créer une tâche, compléter un projet, enregistrer une dépense) via les outils « proposer_* ». Ça n'exécute RIEN : ça affiche un bouton que Francis doit confirmer. Ne dis JAMAIS qu'une action est faite — dis « je te propose de… confirme le bouton ci-dessous ».
- Pour tout le reste, tu es en lecture seule. Si une donnée manque, dis-le franchement plutôt que d'inventer. Termine par une suggestion utile si pertinent.
- ${CONSIGNE_DONNEES}`;

// Point de cache roulant sur l'historique croissant (prompt caching ~0,1× en relecture).
function appliquerCacheMessages(messages: any[]) {
  for (const m of messages) {
    if (Array.isArray(m.content)) for (const b of m.content) if (b && typeof b === "object") delete b.cache_control;
  }
  const last = messages[messages.length - 1];
  if (last && Array.isArray(last.content) && last.content.length) {
    const b = last.content[last.content.length - 1];
    if (b && typeof b === "object") b.cache_control = { type: "ephemeral" };
  }
}

const sse = (event: string, data: any) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante" }, { status: 500 });
  const user = await utilisateurActif(req);
  if (!user) return NextResponse.json({ error: "non authentifié" }, { status: 401 });

  const { question, historique } = await req.json().catch(() => ({}));
  if (!question || !String(question).trim()) return NextResponse.json({ error: "question requise" }, { status: 400 });

  const client = new Anthropic({ apiKey });
  const auj = aujourdhuiMontreal();
  const messages: any[] = [];
  if (Array.isArray(historique)) {
    for (const m of historique.slice(-8)) {
      if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
        messages.push({ role: m.role, content: m.content });
      }
    }
  }
  messages.push({ role: "user", content: String(question) });

  const systemBlocks = [
    { type: "text", text: SYSTEME, cache_control: { type: "ephemeral" } },
    { type: "text", text: `Date du jour : ${auj}. Tu parles à : ${user}.` },
  ];

  const encoder = new TextEncoder();
  // Si l'utilisateur ferme l'onglet ou coupe la question, il faut ARRÊTER d'appeler le
  // modèle : sans ça la boucle de 8 tours allait jusqu'au bout, personne ne lisait la
  // réponse, et l'appel était facturé quand même.
  const abort = new AbortController();
  let annule = false;
  const arreter = () => { annule = true; try { abort.abort(); } catch { /* déjà arrêté */ } };
  // Déconnexion réseau du client (onglet fermé, navigation, perte de connexion).
  try { req.signal?.addEventListener("abort", arreter, { once: true }); } catch { /* pas de signal */ }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: any) => {
        if (annule) return;
        try { controller.enqueue(encoder.encode(sse(event, data))); } catch { /* fermé */ }
      };
      const outilsUtilises: string[] = [];
      // Coût journalisé APRÈS CHAQUE TOUR (et non une fois à la fin) : un flux coupé au
      // 5e tour — onglet fermé, délai de la fonction, panne — a déjà été facturé par
      // Anthropic pour les 4 premiers, et le compteur du mois doit les voir.
      let coutTotal = 0;
      let repondu = false;

      try {
        for (let tour = 0; tour < 8; tour++) {
          if (annule) return;   // plus personne à l'écoute : on n'entame pas un tour de plus
          appliquerCacheMessages(messages);

          const s = client.messages.stream({
            model: MODELES.jarvis, // Opus 4.8
            max_tokens: 4096,
            thinking: { type: "adaptive" },
            system: systemBlocks as any,
            tools: OUTILS_JARVIS as any,
            messages,
          }, { signal: abort.signal });
          // Diffuse le texte en direct (l'utilisateur voit la réponse se former).
          s.on("text", (delta: string) => { if (delta) send("text", { delta }); });

          const resp = await s.finalMessage();
          const u: any = resp.usage || {};
          const usageTour: Required<UsageIA> = {
            input: u.input_tokens || 0, output: u.output_tokens || 0,
            cacheWrite: u.cache_creation_input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0,
          };
          if (usageTour.input + usageTour.output + usageTour.cacheWrite + usageTour.cacheRead > 0) {
            coutTotal += await enregistrerCoutIA({ outil: "jarvis", model: MODELES.jarvis, usage: usageTour, user }).catch(() => 0);
          }

          messages.push({ role: "assistant", content: resp.content });

          if (resp.stop_reason === "tool_use") {
            if (annule) return;  // n'exécute pas les outils d'un tour dont personne n'attend le résultat
            const demandes = resp.content.filter((b: any) => b.type === "tool_use") as any[];
            send("statut", { names: demandes.map((d) => d.name) });
            const resultats = await Promise.all(
              demandes.map(async (tu) => {
                outilsUtilises.push(tu.name);
                return { tu, resultat: await executerOutilJarvis(tu.name, tu.input || {}) };
              }),
            );
            const toolResults: any[] = [];
            const actions: any[] = [];
            for (const { tu, resultat } of resultats) {
              if (OUTILS_ACTION.has(tu.name) && (resultat as any)?.propose && (resultat as any).action) {
                actions.push((resultat as any).action);
              }
              // Résultat d'outil = donnée de la base (noms, notes, descriptions saisis par
              // n'importe qui) : encadré, jamais lu comme une instruction.
              toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: encadrerDonnees(JSON.stringify(resultat).slice(0, 60000), tu.name) });
            }
            if (actions.length) send("actions", { actions });
            messages.push({ role: "user", content: toolResults });
            continue;
          }

          repondu = true;
          break;
        }

        if (!repondu) send("text", { delta: "\nJe n'ai pas réussi à formuler une réponse. Reformule ta question ?" });
        if (outilsUtilises.length) send("outils", { names: Array.from(new Set(outilsUtilises)) });

        // Retour du coût au client (chaque tour est déjà au journal).
        const mois = await coutMoisCourantIA();
        send("cout", { total_usd: coutTotal, mois_usd: mois.total_usd, mois: mois.mois });
        send("done", {});
      } catch (e: any) {
        // Une annulation n'est pas une erreur à afficher : personne n'écoute plus.
        if (!annule) send("erreur", { error: e?.message || "Erreur serveur" });
      } finally {
        // Les tours consommés sont journalisés au fil de l'eau (voir la boucle) : une
        // annulation ou une interruption ne perd plus rien.
        try { controller.close(); } catch { /* déjà fermé */ }
      }
    },
    // Appelé par la plateforme quand le client se détache du flux.
    cancel() { arreter(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

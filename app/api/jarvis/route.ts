import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { MODELES } from "@/lib/viking-ai";
import { OUTILS_JARVIS, OUTILS_ACTION, executerOutilJarvis } from "@/lib/jarvis";
import { utilisateurActif } from "@/lib/authUser";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEME = `Tu es « Jarvis », l'assistant d'intelligence d'affaires de Revêtement Viking Inc. (entrepreneur en revêtement extérieur, Québec, RBQ 5811-4299-01). Tu réponds à Francis (le proprio) et à Gabriel à propos de LEURS vraies données d'entreprise.

RÈGLES :
- Utilise TOUJOURS les outils pour obtenir les chiffres réels. Ne devine JAMAIS un montant ou une donnée.
- Pour une question générale, commence par « apercu_entreprise », puis creuse avec les outils spécifiques au besoin.
- Tu peux appeler plusieurs outils, en plusieurs tours, avant de répondre.
- Réponds en français du Québec, de façon claire et actionnable. Va droit au but.
- Formate les montants en dollars CAD (ex: 12 500 $). Utilise des listes/tableaux courts quand c'est utile.
- Contexte fiscal : taxes TPS 5 % + TVQ 9,975 %. La RENTABILITÉ se calcule AVANT taxes (revenu ÷ 1,14975 − coûts). Le revenu d'un projet = prix de contrat + extras facturés. La main-d'œuvre est un coût.
- Un projet « complété » est considéré facturé.
- Tu peux PROPOSER des actions (créer une tâche, compléter un projet, enregistrer une dépense) via les outils « proposer_* ». Ça n'exécute RIEN : ça affiche un bouton que Francis doit confirmer. Ne dis JAMAIS qu'une action est faite — dis « je te propose de… confirme le bouton ci-dessous ».
- Pour tout le reste, tu es en lecture seule. Si une donnée manque, dis-le franchement plutôt que d'inventer. Termine par une suggestion utile si pertinent.`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante" }, { status: 500 });
    const user = await utilisateurActif(req);
    if (!user) return NextResponse.json({ error: "non authentifié" }, { status: 401 });

    const { question, historique } = await req.json();
    if (!question || !String(question).trim()) return NextResponse.json({ error: "question requise" }, { status: 400 });

    const client = new Anthropic({ apiKey });
    const auj = new Date().toISOString().slice(0, 10);
    const messages: any[] = [];
    if (Array.isArray(historique)) {
      for (const m of historique.slice(-8)) {
        if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
          messages.push({ role: m.role, content: m.content });
        }
      }
    }
    messages.push({ role: "user", content: String(question) });

    const outilsUtilises: string[] = [];
    const actionsProposees: any[] = [];
    let reponse = "";

    // Boucle tool-use : Claude demande des outils → on exécute → on renvoie → il répond.
    for (let tour = 0; tour < 8; tour++) {
      const resp = await client.messages.create({
        model: MODELES.strategie, // Sonnet : raisonnement + tool use
        max_tokens: 3072,
        system: `${SYSTEME}\n\nDate du jour : ${auj}. Tu parles à : ${user}.`,
        tools: OUTILS_JARVIS as any,
        messages,
      });

      messages.push({ role: "assistant", content: resp.content });

      if (resp.stop_reason === "tool_use") {
        const toolResults: any[] = [];
        for (const bloc of resp.content) {
          if ((bloc as any).type === "tool_use") {
            const tu = bloc as any;
            outilsUtilises.push(tu.name);
            const resultat = await executerOutilJarvis(tu.name, tu.input || {});
            if (OUTILS_ACTION.has(tu.name) && (resultat as any)?.propose && (resultat as any).action) {
              actionsProposees.push((resultat as any).action);
            }
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(resultat).slice(0, 60000),
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }

      // Réponse finale
      reponse = resp.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
      break;
    }

    if (!reponse) reponse = "Je n'ai pas réussi à formuler une réponse. Reformule ta question ?";
    return NextResponse.json({ ok: true, reponse, outils: Array.from(new Set(outilsUtilises)), actions: actionsProposees });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erreur serveur" }, { status: 500 });
  }
}

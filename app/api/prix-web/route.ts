import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { MODELES, lirePrixCache, ecrirePrixCache } from "@/lib/viking-ai";
import { journaliserCoutReponse } from "@/lib/ia-couts";
import { validerPrixWeb } from "@/lib/prix-web-validation";
import { rateLimitDepasse } from "@/lib/rateLimit";
import { estAppelCron } from "@/lib/cron-auth";
import { journaliser, type ActiviteType } from "@/lib/audit";
import { ipClient } from "@/lib/ip";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// `force:true` contourne le cache de 7 jours et déclenche une recherche web IA payante :
// plafonné à 20 par heure et par IP. Le cron de nuit (secret de cron) n'est pas compté.
const FORCE_MAX_PAR_HEURE = 20;
// Type « prix_web.force » : à ajouter à ActiviteType (lib/audit.ts, fichier d'un autre
// agent — demande écrite). Le cast tombera de lui-même ensuite.
const TYPE_FORCE = "prix_web.force" as ActiviteType;

const PROMPT = (nomProduit: string, codeProduit: string, fournisseur: string) => `
Tu es un assistant qui aide à vérifier les prix de matériaux de construction au Québec.

Produit recherché:
- Nom: ${nomProduit}
- Code: ${codeProduit}
- Fournisseur principal: ${fournisseur}

Cherche ce produit (ou équivalent) sur les sites de fournisseurs québécois courants:
- Patrick Morin (patrickmorin.com)
- Réno-Dépôt (reno-depot.ca)
- Home Depot Canada (homedepot.ca)
- BMR (bmr.co)
- Matériaux 3+ (materiaux3plus.com)
- Site du fournisseur (${fournisseur})

Retourne UNIQUEMENT un JSON valide:
{
  "prix_trouves": [
    {"source": "Patrick Morin", "url": "...", "prix": 28.99, "unite": "boite", "format": "200 pi²", "date_observation": "2026-05-15"}
  ],
  "prix_moyen_estime": 29.50,
  "tendance": "hausse|stable|baisse",
  "note": "commentaire utile (disponibilité, alternatives, etc.)"
}

Si tu ne trouves rien de fiable, retourne {"prix_trouves": [], "note": "explication"}.
Pas de markdown, JSON pur.`;

export async function POST(req: NextRequest) {
  try {
    const { nom, code, fournisseur, force } = await req.json();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante" }, { status: 500 });
    }

    // === CACHE 7 jours ===
    const cleCache = `${code || ""}|${nom || ""}|${fournisseur || ""}`;
    if (!force) {
      const cache = await lirePrixCache(cleCache);
      if (cache) {
        return NextResponse.json({ ok: true, prix_moyen_estime: cache.prix_unit, prix_trouves: [{ source: cache.source || "cache", prix: cache.prix_unit, unite: cache.unite, format: cache.note }], note: "depuis cache (7j)", cached: true });
      }
    } else if (!estAppelCron(req)) {
      const ip = ipClient(req);
      if (await rateLimitDepasse(TYPE_FORCE, ip, FORCE_MAX_PAR_HEURE, 60)) {
        return NextResponse.json({ error: "trop de recherches forcées", message: `Maximum ${FORCE_MAX_PAR_HEURE} recherches forcées par heure. Réessaie plus tard ou laisse le cache répondre.` }, { status: 429 });
      }
      journaliser(TYPE_FORCE, { ip, ref_type: "prix_web", description: `force · ${cleCache.slice(0, 120)}` }).catch(() => {});
    }

    // Délai borné et un seul réessai : un appel qui traîne ne doit pas dépasser la
    // fonction (maxDuration 60 s) et laisser l'écran sans réponse.
    const client = new Anthropic({ apiKey, timeout: 50_000, maxRetries: 1 });
    const response = await client.messages.create({
      model: MODELES.parse_pdf,
      max_tokens: 2048,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 } as any],
      messages: [{ role: "user", content: PROMPT(nom, code, fournisseur) }],
    });

    journaliserCoutReponse("prix-web", MODELES.parse_pdf, response);
    const text = response.content
      .filter((c) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .trim()
      .replace(/^```json\s*|\s*```$/g, "");

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: true, raw: text, parse_error: true });
    }
    // Validation AVANT mise en cache (lib/prix-web-validation.ts) : prix dans la bande
    // 0,5× à 3× du catalogue, au moins une url, note bornée. Ce qui ne passe pas est
    // renvoyé à l'écran avec la raison, mais n'est PAS figé 7 jours dans le cache.
    const v = validerPrixWeb(data, code);
    if (v.ok) {
      const u = v.prix_trouves[0]?.unite || "u";
      const src = v.prix_trouves[0]?.source || "web";
      await ecrirePrixCache({ produit: cleCache, prix_unit: v.prix_moyen_estime!, unite: u, source: src, note: v.note });
    }
    return NextResponse.json({
      ok: true, ...data, note: v.note, prix_trouves: v.prix_trouves,
      mis_en_cache: v.ok, ...(v.ok ? {} : { raison_non_cache: v.raison }), cached: false,
    });
  } catch (e: any) {
    console.error("[/api/prix-web]", e);
    return NextResponse.json({ error: e?.message || "Erreur serveur" }, { status: 500 });
  }
}

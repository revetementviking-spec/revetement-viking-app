import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { MODELES, lirePrixCache, ecrirePrixCache } from "@/lib/viking-ai";

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
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODELES.parse_pdf,
      max_tokens: 2048,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 } as any],
      messages: [{ role: "user", content: PROMPT(nom, code, fournisseur) }],
    });

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
    // Écrit en cache si on a un prix moyen
    if (data?.prix_moyen_estime > 0) {
      const u = data.prix_trouves?.[0]?.unite || "u";
      const src = data.prix_trouves?.[0]?.source || "web";
      await ecrirePrixCache({ produit: cleCache, prix_unit: data.prix_moyen_estime, unite: u, source: src, note: data.note });
    }
    return NextResponse.json({ ok: true, ...data, cached: false });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erreur serveur" }, { status: 500 });
  }
}

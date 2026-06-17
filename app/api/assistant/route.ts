import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { MODELES } from "@/lib/viking-ai";
import { MATERIAUX } from "@/data/materiaux";

// Assistant conversationnel : prend l'état actuel de la soumission + une demande en langage naturel
// Retourne des modifications structurées (ajout/modif/suppression de lignes)

const SYSTEME = `Tu es l'expert en revêtement extérieur d'Revêtement Viking Inc. (Francis, RBQ 5811-4299-01).
Tu aides Francis à monter une soumission rapide et précise pour soffite, fascia, solin et parement.

CONTEXTE BUSINESS :
- Taux horaire MO facturé client : 90$/h
- Marge matériaux par défaut : 40%
- Frais de gestion : 15%
- Devises CAD, taxes TPS 5% + TVQ 9.975%

CATALOGUE DISPONIBLE (codes à utiliser pour ajouter des lignes) :
{{CATALOGUE}}

TU REÇOIS :
- L'état actuel de la soumission (client, lignes existantes, totaux)
- Une demande de Francis en français du Québec (ex: "ajoute 2400 pi² de Maibec Canexel", "change le parement pour MAC", "augmente la marge à 50%")

TU RETOURNES UNIQUEMENT UN JSON valide :
{
  "reponse_texte": "Confirmation courte de ce que tu as fait, en français du Québec",
  "actions": [
    {"type": "ajouter_ligne", "materiauCode": "64695", "quantite": 2400, "surplus": 0.10, "margePct": 0.40},
    {"type": "modifier_ligne", "index": 0, "quantite": 2500},
    {"type": "supprimer_ligne", "index": 2},
    {"type": "modifier_marge_globale", "margePct": 0.50},
    {"type": "modifier_frais_gestion", "pct": 0.15},
    {"type": "ajouter_frais_forfaitaire", "id": "echafaudage", "heures": 8},
    {"type": "remplacer_categorie", "categorie": "parement-vinyle", "nouveauCode": "MAIBEC-CANEXEL-RIDGEWOOD-6"},
    {"type": "vider_toutes_lignes"},
    {"type": "appliquer_preset", "presetId": "vinyle-complet"}
  ],
  "suggestions": ["question ou conseil pour Francis, optionnel"]
}

RÈGLES :
- Si la demande est ambiguë, pose 1 question dans "reponse_texte" sans faire d'action
- Toujours utiliser les codes EXACTS du catalogue
- Si Francis dit "vinyle pas cher" → choisis Driftwood II (62450, le moins cher)
- Si Francis dit "haut de gamme bois" → Maibec bois (MAIBEC-BOIS-CLASSIQUE)
- Si Francis dit "MAC" sans préciser → MS1 24j (R1G24) par défaut
- Pour calcul auto de quantités d'accessoires depuis surface parement :
  * Moulure J: ~25% du périmètre de parement
  * Coins ext: estimer 4 coins × hauteur (8-20 pi typique)
  * Départ: =périmètre au sol
- Réponses brèves et précises, ton de chantier
- AUCUN markdown, JSON pur`;

const catalogueResume = MATERIAUX.map(
  (m) => `${m.code} | ${m.fournisseur} | ${m.categorie} | ${m.nom} | ${m.uniteCalcul} | ${m.prixCoutantParUniteCalcul.toFixed(2)}$`
).join("\n");

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante" }, { status: 500 });
    }

    const { message, etat, historique } = await req.json();
    if (!message) return NextResponse.json({ error: "message requis" }, { status: 400 });

    const client = new Anthropic({ apiKey });
    const systemPrompt = SYSTEME.replace("{{CATALOGUE}}", catalogueResume);

    const messages: any[] = [];
    if (Array.isArray(historique)) {
      for (const m of historique.slice(-6)) {
        messages.push({ role: m.role, content: m.content });
      }
    }
    messages.push({
      role: "user",
      content: `ÉTAT ACTUEL DE LA SOUMISSION :\n${JSON.stringify(etat, null, 2)}\n\nDEMANDE DE FRÉDÉRIC : ${message}`,
    });

    const response = await client.messages.create({
      model: MODELES.chat_simple,
      max_tokens: 2048,
      system: systemPrompt,
      messages,
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
      data = { reponse_texte: text, actions: [], parse_error: true };
    }

    return NextResponse.json({ ok: true, ...data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Erreur serveur" }, { status: 500 });
  }
}

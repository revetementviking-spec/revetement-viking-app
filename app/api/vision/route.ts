import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { MODELES } from "@/lib/viking-ai";

const PROMPT_EXTRACTION = `Tu es expert en estimation de revêtement extérieur (soffite, fascia, solin, parement).

Analyse l'image (plan, photo de bâtiment, croquis avec mesures) et extrait TOUTES les mesures pertinentes pour soumissionner des travaux de revêtement.

Retourne UNIQUEMENT un JSON valide avec cette structure exacte:
{
  "type_document": "plan|photo|croquis",
  "description_courte": "résumé en 1 phrase de ce qui est visible",
  "mesures": [
    {
      "categorie": "soffite|fascia|solin|parement|coin|moulure|autre",
      "description": "ex: soffite façade avant",
      "valeur": 240,
      "unite": "pi2|pi-lin|piece",
      "confiance": "haute|moyenne|basse",
      "notes": "ex: estimation basée sur largeur 12' × hauteur 20'"
    }
  ],
  "elements_remarquables": ["liste de détails à noter: pentes, obstacles, fenêtres, etc."],
  "questions_pour_clarifier": ["questions à poser à l'utilisateur si mesures ambiguës"]
}

IMPORTANT:
- Si une mesure manque mais peut être déduite (ex: longueur × hauteur de mur), calcule-la
- Si tu vois des cotes (ex: 24'-6"), convertis en pi décimaux (24.5)
- Pour parement: pi² (surface murs moins ouvertures)
- Pour fascia/solin/moulures: pi linéaires
- Pour coins: pi linéaires
- Ne retourne RIEN d'autre que le JSON, pas de markdown, pas d'explication`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY manquante dans .env.local" },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("image") as File | null;
    if (!file) {
      return NextResponse.json({ error: "Aucune image fournie" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const mediaType = (file.type || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODELES.vision_photos,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: PROMPT_EXTRACTION },
          ],
        },
      ],
    });

    const text = response.content
      .filter((c) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .trim();

    // Nettoyer les éventuels ```json
    const jsonText = text.replace(/^```json\s*|\s*```$/g, "").trim();

    let extraction;
    try {
      extraction = JSON.parse(jsonText);
    } catch (e) {
      return NextResponse.json(
        { error: "Réponse IA non parsable", raw: text },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, extraction });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e?.message || "Erreur serveur" },
      { status: 500 }
    );
  }
}

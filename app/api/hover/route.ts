import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { MODELES } from "@/lib/viking-ai";

const PROMPT_HOVER = `Tu es un expert en estimation de revêtement extérieur résidentiel (soffite, fascia, solin, parement) au Québec.

On te fournit un rapport de mesures HOVER (ou similaire EagleView, RoofSnap, etc.) ou des photos/plans de maison avec mesures.

Ta mission : extraire TOUTES les mesures pertinentes pour soumissionner les travaux de revêtement.

Retourne UNIQUEMENT un JSON valide avec cette structure exacte :

{
  "type_rapport": "hover_pro|hover_basic|eagleview|plan_architecte|photo_avec_cotes|croquis|autre",
  "adresse": "adresse si visible",
  "resume": "ex: maison 2 étages, ~2400 pi² parement, garage attaché",
  "mesures_globales": {
    "parement_total_pi2": 2400,
    "parement_net_pi2": 2150,
    "ouvertures_pi2": 250,
    "fascia_total_pi_lin": 180,
    "soffite_total_pi2": 320,
    "solin_total_pi_lin": 145,
    "coins_exterieurs_pi_lin": 96,
    "coins_interieurs_pi_lin": 24,
    "moulure_j_pi_lin": 220,
    "cadrage_fenetres_pi_lin": 165,
    "nb_fenetres": 12,
    "nb_portes": 3
  },
  "par_elevation": [
    {"face": "avant|arriere|gauche|droite|garage|autre", "parement_brut_pi2": 600, "parement_net_pi2": 540, "fascia_pi_lin": 45, "soffite_pi2": 80, "notes": "fronton triangulaire, 1 fenêtre baie"}
  ],
  "elements_remarquables": ["pente toit 8/12", "hauteur 2 étages = 19'", "présence de fronton/gable", "garage attaché", "moulure brique existante", "etc."],
  "questions_pour_clarifier": ["Couleur souhaitée?", "Garder le soffite/fascia existant ou tout remplacer?", "Solin nécessaire au-dessus des fenêtres?"],
  "recommandations_materiaux": [
    {"categorie": "parement", "suggestion": "Vinyle D4.5 ou Maibec Canexel selon budget"},
    {"categorie": "soffite", "suggestion": "Aluminium ventilé 4 panneaux (1606)"},
    {"categorie": "fascia", "suggestion": "Fascia alu 6\" nervuré (1696)"}
  ],
  "estimation_heures_installation": {
    "parement": 65,
    "soffite": 9,
    "fascia": 10,
    "solin": 5,
    "accessoires": 8,
    "mobilisation_echafaudage_nettoyage": 13,
    "total": 110
  }
}

RÈGLES IMPORTANTES :
- Conversion : 24'-6" = 24.5 pi décimaux
- Surface NETTE = brute - ouvertures (toujours utiliser net pour le parement à acheter)
- Hover donne souvent "Total Siding Area" en SF (= pi²)
- Hover donne "Fascia LF" en pi linéaires
- Si une mesure manque, mets null mais ESTIME quand même les heures
- Rendements industrie pour estimation heures:
  * Parement: 35-40 pi²/h installateur
  * Soffite: 35 pi²/h
  * Fascia: 18 pi-lin/h (capping bois inclus)
  * Solin: 28 pi-lin/h
  * Accessoires (coins/J): 35 pi-lin/h
- Mobilisation/échafaudage/nettoyage: forfaitaire 12-15 h pour maison standard
- Réponds en français du Québec
- AUCUN markdown, AUCUNE explication, SEULEMENT le JSON valide`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante dans .env.local" }, { status: 500 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const isPDF = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    const client = new Anthropic({ apiKey });

    const content: any[] = [];
    if (isPDF) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: base64 },
      });
    } else {
      const mediaType = (file.type || "image/jpeg") as any;
      content.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: base64 },
      });
    }
    content.push({ type: "text", text: PROMPT_HOVER });

    const response = await client.messages.create({
      model: MODELES.parse_hover,
      max_tokens: 8192,
      messages: [{ role: "user", content }],
    });

    const text = response.content
      .filter((c) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .trim()
      .replace(/^```json\s*|\s*```$/g, "");

    let extraction;
    try {
      extraction = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Réponse IA non parsable", raw: text }, { status: 500 });
    }

    return NextResponse.json({ ok: true, extraction });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message || "Erreur serveur" }, { status: 500 });
  }
}

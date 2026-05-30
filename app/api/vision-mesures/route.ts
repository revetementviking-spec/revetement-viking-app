// Agent vision multi-photos : prend 3-5 photos d'une maison + une référence d'échelle
// et retourne les dimensions estimées par façade
// Précision attendue : 10-15% (suffisant pour soumission préliminaire, PAS pour commande matériaux)

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { MODELES } from "@/lib/viking-ai";

const SYSTEME = `Tu es un expert en estimation de revêtement extérieur résidentiel pour Revêtement Viking (Québec).

L'utilisateur t'envoie 1 à 5 photos d'une maison résidentielle, accompagnées d'une RÉFÉRENCE D'ÉCHELLE (élément de dimension connue dans les photos).

Ta mission : analyser les photos comme un estimateur expérimenté ferait au téléphone, et estimer toutes les mesures pertinentes pour soumissionner du revêtement extérieur.

RÉFÉRENCES STANDARDS si pas précisé :
- Porte d'entrée standard : 36" large × 80" haut (3' × 6'8")
- Porte de garage simple : 8' ou 9' large × 7' haut
- Porte de garage double : 16' large × 7' haut
- Fenêtre standard : 36" × 48" (3' × 4')
- Brique standard : 8" long × 2 ⅔" haut
- Étage résidentiel : 8-9' du sol au plafond, ~10' du sol au sol incluant plancher

MÉTHODE :
1. Identifie la maison : nb étages, type toit (pente/plat), garage attaché ou non, fronton/gable, particularités
2. Utilise la référence fournie comme échelle (compte combien de "portes de garage de large" mesure la façade, etc.)
3. Pour chaque face visible, estime longueur × hauteur, puis soustrais ouvertures
4. Calcule fascia (= périmètre toit), soffite (= largeur soffite × périmètre), solin si visible
5. Compte fenêtres/portes pour cadrage
6. Indique TON NIVEAU DE CONFIANCE par mesure (haute/moyenne/basse)
7. Liste les angles/photos manquants qui amélioreraient la précision

RETOURNE UNIQUEMENT UN JSON :
{
  "analyse_visuelle": {
    "nb_etages": 1,
    "type_toit": "pignon|cabanon|mansardé|plat|combinaison",
    "garage_attache": true,
    "frontons_gables": 2,
    "materiau_existant": "vinyle|aluminium|brique|bois|composite|inconnu",
    "etat_apparent": "bon|moyen|à remplacer",
    "particularites": ["balcon avant", "fronton triangulaire arrière"]
  },
  "echelle_utilisee": "Porte de garage simple 9' utilisée comme référence dans la photo 1",
  "facades": [
    {
      "face": "avant|arrière|gauche|droite|garage",
      "photo_index": 1,
      "longueur_pi": 35,
      "hauteur_pi": 18,
      "surface_brute_pi2": 630,
      "ouvertures_pi2": 60,
      "surface_nette_pi2": 570,
      "fascia_pi_lin": 38,
      "soffite_estime_pi2": 38,
      "nb_fenetres": 3,
      "nb_portes": 1,
      "confiance": "haute|moyenne|basse",
      "notes": "Vue partielle, hauteur estimée par référence porte"
    }
  ],
  "totaux_estimes": {
    "parement_net_pi2": 2100,
    "fascia_total_pi_lin": 180,
    "soffite_total_pi2": 300,
    "solin_estime_pi_lin": 120,
    "coins_exterieurs_pi_lin": 80,
    "moulure_j_estime_pi_lin": 200,
    "cadrage_fenetres_pi_lin": 130,
    "nb_fenetres_total": 10,
    "nb_portes_total": 3
  },
  "confiance_globale_pct": 75,
  "limitations": [
    "Face arrière non visible dans les photos",
    "Hauteur étage estimée à 9 pi (standard)"
  ],
  "photos_manquantes_recommandees": [
    "Vue arrière complète",
    "Photo avec mètre ruban visible sur façade avant pour calibration précise"
  ],
  "recommandation": "Précision actuelle ~85%. Pour soumission terrain OK. Pour contrat signé, recommander rapport Hover."
}

RÈGLES :
- SOIS HONNÊTE sur la confiance. Si tu vois 1 seule photo, dis-le.
- Pour grosse maison, recommande Hover dans "recommandation"
- AUCUN markdown, JSON pur en français du Québec`;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante" }, { status: 500 });

    const formData = await req.formData();
    const reference = (formData.get("reference") as string) || "Aucune référence fournie - utilise les standards (porte 6'8\", étage 9')";
    const description = (formData.get("description") as string) || "";

    // Récupérer toutes les photos
    const photos: { buffer: Buffer; mediaType: any }[] = [];
    for (let i = 0; i < 10; i++) {
      const f = formData.get(`photo_${i}`) as File | null;
      if (!f) continue;
      const buffer = Buffer.from(await f.arrayBuffer());
      photos.push({ buffer, mediaType: f.type || "image/jpeg" });
    }

    if (photos.length === 0) {
      return NextResponse.json({ error: "Au moins 1 photo requise" }, { status: 400 });
    }

    const client = new Anthropic({ apiKey });

    // Construire le contenu : toutes les photos + le texte de référence
    const content: any[] = [];
    photos.forEach((p, i) => {
      content.push({ type: "text", text: `Photo ${i + 1}:` });
      content.push({
        type: "image",
        source: { type: "base64", media_type: p.mediaType, data: p.buffer.toString("base64") },
      });
    });
    content.push({
      type: "text",
      text: `\nRÉFÉRENCE D'ÉCHELLE : ${reference}\n\nDESCRIPTION SUPPLÉMENTAIRE : ${description || "Aucune"}\n\nAnalyse les ${photos.length} photo(s) et retourne le JSON d'estimation complète.`,
    });

    const response = await client.messages.create({
      model: MODELES.vision_photos,
      max_tokens: 4096,
      system: SYSTEME,
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

    // Convertir au format compatible avec l'auto-estimateur et le mapping Hover
    const formatCompatible = {
      type_rapport: "agent_vision_xpress",
      adresse: "",
      resume: `${extraction.analyse_visuelle?.nb_etages || "?"} étage(s), ${extraction.analyse_visuelle?.type_toit || "type inconnu"}${extraction.analyse_visuelle?.garage_attache ? ", garage attaché" : ""}`,
      mesures_globales: {
        parement_total_pi2: extraction.totaux_estimes?.parement_net_pi2,
        parement_net_pi2: extraction.totaux_estimes?.parement_net_pi2,
        fascia_total_pi_lin: extraction.totaux_estimes?.fascia_total_pi_lin,
        soffite_total_pi2: extraction.totaux_estimes?.soffite_total_pi2,
        solin_total_pi_lin: extraction.totaux_estimes?.solin_estime_pi_lin,
        coins_exterieurs_pi_lin: extraction.totaux_estimes?.coins_exterieurs_pi_lin,
        moulure_j_pi_lin: extraction.totaux_estimes?.moulure_j_estime_pi_lin,
        cadrage_fenetres_pi_lin: extraction.totaux_estimes?.cadrage_fenetres_pi_lin,
        nb_fenetres: extraction.totaux_estimes?.nb_fenetres_total,
        nb_portes: extraction.totaux_estimes?.nb_portes_total,
      },
      par_elevation: extraction.facades,
      elements_remarquables: extraction.analyse_visuelle?.particularites || [],
      questions_pour_clarifier: extraction.photos_manquantes_recommandees || [],
      confiance_globale_pct: extraction.confiance_globale_pct,
      limitations: extraction.limitations,
      recommandation: extraction.recommandation,
      analyse_brute: extraction,
    };

    return NextResponse.json({ ok: true, extraction: formatCompatible });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message || "Erreur serveur" }, { status: 500 });
  }
}

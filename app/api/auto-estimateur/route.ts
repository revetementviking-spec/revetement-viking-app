// Auto-estimateur : prend une extraction Hover + préférence matériau et construit
// automatiquement la soumission complète :
// 1. Choisit les matériaux du catalogue selon les mesures
// 2. Pour les matériaux où le prix est incertain/manquant, va chercher sur le web
// 3. Retourne les lignes de soumission prêtes à appliquer

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { MATERIAUX } from "@/data/materiaux";
import { PRESETS } from "@/data/presets-soumission";
import { jobsSimilaires } from "@/lib/db";
import { REGLES_METIER_VIKING, MODELES, fewShotExemples, trouverProjetsSimilaires, resumeFeedbackHistorique, reglesMetierDynamiques, documentsReferenceActifs } from "@/lib/viking-ai";

const SYSTEME = `Tu es l'expert estimateur en revêtement extérieur d'Revêtement Viking Inc. (RBQ 5811-4299-01, taux 90$/h facturé client).

Tu reçois :
- Une extraction de mesures de plan/photo/Hover (surface parement, fascia LF, soffite SF, solin, coins, etc.)
- Optionnellement une préférence de matériau (ex: vinyle-complet, mac-acier, maibec-bois)

Ta mission : produire une SOUMISSION COMPLÈTE prête à utiliser, en sélectionnant les matériaux EXACTS du catalogue ci-dessous, en calculant les quantités précises (avec surplus appropriés), et en estimant les heures de main-d'œuvre.

CATALOGUE DISPONIBLE (utilise les codes EXACTS) :
{{CATALOGUE}}

PRESETS DE RÉFÉRENCE (pour t'inspirer du mélange de matériaux) :
{{PRESETS}}

RÈGLES BUSINESS :
- Marge matériaux par défaut : 40%
- Surplus par catégorie : 5% accessoires/solins, 10% soffite/parement plat, 12-15% parement complexe
- Rendements MO : parement 35-40 pi²/h, soffite 35 pi²/h, fascia 18 pl/h, solin 28 pl/h, accessoires 35 pl/h
- Si aucune préférence : choisis Gentek vinyle Fair Oaks D4D (économique, 64696) + soffite/fascia/solin aluminium
- Pour chaque matériau, indique si tu es SÛR du prix (catalogue 100% à jour) ou si tu RECOMMANDES une vérification web (couleur spéciale, prix volatile, item rare)

TU RETOURNES UN JSON :
{
  "resume_strategie": "Texte court 1-2 phrases : quel matériau, pourquoi, estimation totale approximative",
  "lignes_generees": [
    {
      "materiauCode": "64696",
      "quantite": 2400,
      "surplus": 0.10,
      "margePct": 0.40,
      "couleur": "Blanc Neige (01)",
      "note": "Parement principal — surface nette du Hover",
      "confiance_prix": "haute|moyenne|basse",
      "verifier_web": false
    }
  ],
  "frais_forfaitaires": [
    {"id": "mobilisation", "heures": 4},
    {"id": "echafaudage", "heures": 8},
    {"id": "nettoyage", "heures": 3}
  ],
  "heures_totales_estimees": 110,
  "elements_a_clarifier": ["Couleur définitive à confirmer avec client", "Si garage attaché, ajuster fascia"],
  "items_a_verifier_prix_web": [
    {"code": "MAIBEC-BOIS-CHANNEL", "raison": "Matériau Maibec - prix peut varier"}
  ],
  "items_manquants_catalogue": [
    {"description": "Membrane pare-air", "estimation_pi2": 2400, "raison": "Pas dans le catalogue actuel, recommander prix marché"}
  ]
}

IMPORTANT :
- Utilise les CODES EXACTS du catalogue
- Calcule les quantités RÉALISTES depuis les mesures (parement net, fascia LF, etc.)
- Pour les accessoires (J trim, coins, départ), estime depuis surface parement et nb fenêtres
- Pour l'échafaudage : 6h pour 1 étage, 10h pour 2 étages, 14h pour 3 étages
- Pas de markdown, JSON pur`;

function catalogueResume(): string {
  return MATERIAUX.map(
    (m) => `${m.code} | ${m.fournisseur} | ${m.categorie} | ${m.nom} | ${m.uniteCalcul} | ${m.prixCoutantParUniteCalcul.toFixed(2)}$/${m.uniteCalcul}`
  ).join("\n");
}

function presetsResume(): string {
  return PRESETS.map(
    (p) => `${p.id} | ${p.nom} | ${p.description} | codes: ${p.lignes.map((l) => l.materiauCode).join(",")}`
  ).join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY manquante" }, { status: 500 });

    const { extraction, preferenceMateriau } = await req.json();
    if (!extraction) return NextResponse.json({ error: "extraction Hover requise" }, { status: 400 });

    const client = new Anthropic({ apiKey });

    // Charge en parallèle : règles métier dynamiques (DB), few-shot, projets similaires, corrections, documents de référence
    const [regles, exemples, feedbackHist, docs] = await Promise.all([
      reglesMetierDynamiques().catch(() => REGLES_METIER_VIKING),
      fewShotExemples(2).catch(() => ""),
      resumeFeedbackHistorique().catch(() => ""),
      documentsReferenceActifs().catch(() => ""),
    ]);

    const systemPrompt = `${SYSTEME.replace("{{CATALOGUE}}", catalogueResume()).replace("{{PRESETS}}", presetsResume())}

${regles}

${docs || ""}

${exemples ? `=== EXEMPLES DE SOUMISSIONS ACCEPTÉES — INSPIRE-TOI DE LEUR STRUCTURE ===\n${exemples}\n` : ""}
${feedbackHist || ""}
`.trim();

    // === ENRICHISSEMENT par bibliothèque de référence ===
    const surface = extraction?.mesures_globales?.parement_net_pi2 || extraction?.mesures_globales?.parement_total_pi2 || 0;
    const jobsRef = surface > 0 ? await jobsSimilaires(surface, preferenceMateriau, 3) : [];
    const refTexte = jobsRef.length > 0
      ? `\n\nJOBS SIMILAIRES PASSÉES DE FRÉDÉRIC (utilise comme calibration de prix et d'heures réelles) :\n${jobsRef.map((j) => `- ${j.adresse || "Sans adresse"} | ${j.type_materiau} | ${j.parement_pi2} pi² | Total: ${j.total_soumission}$ (${(j.total_soumission! / j.parement_pi2!).toFixed(2)}$/pi²) | H réelles: ${j.heures_reelles || "?"}h | Complexité: ${j.complexite} | Notes: ${j.notes_chantier || "—"}`).join("\n")}\n\nCalibre ton estimation en t'alignant sur les ratios $/pi² et heures/pi² de ces jobs similaires.`
      : "\n\n(Aucune job similaire dans la bibliothèque — utilise les barèmes standards)";

    const userMessage = `EXTRACTION DU PLAN/HOVER :
${JSON.stringify(extraction, null, 2)}

PRÉFÉRENCE MATÉRIAU : ${preferenceMateriau || "Aucune — choisis le plus pertinent selon le contexte"}
${refTexte}

Construis la soumission complète maintenant. Sélectionne les matériaux exacts du catalogue, calcule les quantités depuis les mesures, estime les heures, et CALIBRE par rapport aux jobs similaires si disponibles.`;

    const response = await client.messages.create({
      model: MODELES.construction,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
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
      return NextResponse.json({ error: "Réponse IA non parsable", raw: text }, { status: 500 });
    }

    // Étape 2 : recherche web automatique pour les items flagués "verifier_web" ou "items_a_verifier_prix_web"
    const aVerifier: { code: string; raison: string }[] = [];
    if (Array.isArray(data.lignes_generees)) {
      for (const l of data.lignes_generees) {
        if (l.verifier_web || l.confiance_prix === "basse") {
          aVerifier.push({ code: l.materiauCode, raison: "Prix incertain selon IA" });
        }
      }
    }
    if (Array.isArray(data.items_a_verifier_prix_web)) {
      for (const i of data.items_a_verifier_prix_web) aVerifier.push(i);
    }

    // Limiter à 3 pour pas exploser les coûts API
    const verifications = [];
    for (const v of aVerifier.slice(0, 3)) {
      const mat = MATERIAUX.find((m) => m.code === v.code);
      if (!mat) continue;
      try {
        const resp = await client.messages.create({
          model: MODELES.construction,
          max_tokens: 1024,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 } as any],
          messages: [
            {
              role: "user",
              content: `Cherche le prix actuel au Québec pour : ${mat.nom} (${mat.fournisseur}, code ${mat.code}). Prix coûtant interne actuel : ${mat.prixCoutantParUniteCalcul.toFixed(2)}$/${mat.uniteCalcul}.
Retourne UNIQUEMENT un JSON: {"code":"${mat.code}","prix_web_moyen":0,"source":"url","ecart_pct":0,"note":"..."}`,
            },
          ],
        });
        const t = resp.content.filter((c) => c.type === "text").map((c: any) => c.text).join("").replace(/^```json\s*|\s*```$/g, "").trim();
        try { verifications.push(JSON.parse(t)); } catch {}
      } catch {}
    }

    return NextResponse.json({ ok: true, ...data, verifications_web: verifications, jobs_reference_utilisees: jobsRef.length });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message || "Erreur serveur" }, { status: 500 });
  }
}

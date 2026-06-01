import { NextRequest, NextResponse } from "next/server";
import { db, initDb } from "@/lib/db";

const c: any = () => db();

// Valeurs par défaut Viking — seed si la table est vide
const DEFAULTS: Record<string, { valeur: string; label: string; description: string; type: string }> = {
  marge_plancher_pct: { valeur: "30", label: "Marge plancher (%)", description: "Si une soumission descend sous cette marge, l'app alerte. L'IA cherche à atteindre ou dépasser ce seuil.", type: "number" },
  frais_fixes_pct: { valeur: "15", label: "Frais fixes structurels (%)", description: "Admin, véhicules, RBQ, assurance, comptable, téléphone. Déduit du profit pour avoir le vrai net.", type: "number" },
  conditions_generales_pct: { valeur: "5", label: "Conditions générales (%)", description: "Mobilisation, supervision, etc. — entre 4 et 7% standard.", type: "number" },
  profit_admin_pct: { valeur: "7", label: "Profit et administration (%)", description: "Entre 6 et 8% standard.", type: "number" },
  taux_mo_interne: { valeur: "55", label: "Taux MO interne ($/h)", description: "Taux interne (Francis/Gabriel) pour le calcul du coûtant de la main-d'œuvre.", type: "number" },
  majoration_maibec: { valeur: "18", label: "Majoration Maibec / cèdre (%)", description: "Marge appliquée sur le prix coûtant brut Maibec.", type: "number" },
  majoration_canexel: { valeur: "22", label: "Majoration Canexel / Hardie (%)", description: "Marge appliquée sur Canexel et fibrociment.", type: "number" },
  majoration_vinyle: { valeur: "25", label: "Majoration vinyle / aluminium (%)", description: "Marge appliquée sur vinyle, aluminium.", type: "number" },
  majoration_quincaillerie: { valeur: "30", label: "Majoration quincaillerie (%)", description: "Marge sur vis, clous, calfeutrants, quincaillerie.", type: "number" },
  majoration_membrane: { valeur: "20", label: "Majoration membrane / isolant (%)", description: "Marge sur Tyvek, Typar, isolants rigides.", type: "number" },
  rendement_demolition: { valeur: "0.8", label: "Démolition (h / 100 pi²)", description: "Temps moyen pour démolir 100 pi² de revêtement existant.", type: "number" },
  rendement_pose_maibec: { valeur: "1.2", label: "Pose Maibec (h / 100 pi²)", description: "Temps moyen d'installation Maibec.", type: "number" },
  rendement_pose_canexel: { valeur: "1.5", label: "Pose Canexel/Hardie (h / 100 pi²)", description: "Temps moyen d'installation Canexel ou Hardie.", type: "number" },
  rendement_soffite_fascia: { valeur: "0.6", label: "Soffite/Fascia (h / pi lin)", description: "Temps moyen de pose soffite et fascia.", type: "number" },
  rendement_habillage: { valeur: "1.5", label: "Habillage porte/fenêtre (h / unité)", description: "Temps moyen d'habillage par ouverture.", type: "number" },
  acompte_signature_pct: { valeur: "30", label: "Acompte à la signature (%)", description: "Premier versement à la signature du contrat.", type: "number" },
  acompte_mi_projet_pct: { valeur: "40", label: "Acompte à mi-projet (%)", description: "Versement au milieu du chantier.", type: "number" },
  acompte_livraison_pct: { valeur: "30", label: "Solde à la livraison (%)", description: "Dernier versement à la fin du chantier.", type: "number" },
  validite_soumission_jours: { valeur: "30", label: "Validité soumission (jours)", description: "Période d'engagement du prix.", type: "number" },
  regles_libres: { valeur: "", label: "Règles métier additionnelles", description: "Texte libre — règles spécifiques à toi, exceptions, instructions à l'IA. Sera injecté tel quel dans le prompt.", type: "textarea" },
};

async function seed() {
  for (const [cle, def] of Object.entries(DEFAULTS)) {
    await c().execute({
      sql: "INSERT OR IGNORE INTO parametres_ia (cle, valeur, label, description, type, date_modif) VALUES (?,?,?,?,?,?)",
      args: [cle, def.valeur, def.label, def.description, def.type, new Date().toISOString()],
    }).catch(() => {});
  }
}

export async function GET() {
  await initDb();
  await seed();
  const r = await c().execute({ sql: "SELECT * FROM parametres_ia ORDER BY cle", args: [] });
  return NextResponse.json(r.rows);
}

export async function PATCH(req: NextRequest) {
  await initDb();
  const b = await req.json();
  // Accepte soit {cle, valeur} soit {parametres: [{cle, valeur}, ...]}
  const items = Array.isArray(b.parametres) ? b.parametres : [{ cle: b.cle, valeur: b.valeur }];
  for (const it of items) {
    if (!it.cle) continue;
    await c().execute({
      sql: "UPDATE parametres_ia SET valeur = ?, date_modif = ? WHERE cle = ?",
      args: [String(it.valeur ?? ""), new Date().toISOString(), it.cle],
    }).catch(() => {});
  }
  return NextResponse.json({ ok: true, n: items.length });
}

/** Helper interne (pas exposé) : lire tous les paramètres comme objet. */
export async function lireTousParametres(): Promise<Record<string, string>> {
  await initDb();
  await seed();
  const r = await c().execute({ sql: "SELECT cle, valeur FROM parametres_ia", args: [] }).catch(() => ({ rows: [] }));
  const out: Record<string, string> = {};
  for (const row of r.rows as any[]) out[row.cle] = row.valeur;
  return out;
}

import { NextRequest, NextResponse } from "next/server";
import { db as getDbClient } from "@/lib/db";

/** Dashboard enrichi : KPIs business agrégés pour la page d'accueil. */
export async function GET(_req: NextRequest) {
  try {
    const db: any = getDbClient();
    const moisDebut = new Date(); moisDebut.setDate(1); moisDebut.setHours(0, 0, 0, 0);
    const isoMoisDebut = moisDebut.toISOString().slice(0, 10);
    const aujourdhui = new Date().toISOString().slice(0, 10);

    // Revenu du mois (factures payées dans le mois)
    const rRevenu = await db.execute({ sql: `SELECT COALESCE(SUM(montant),0) AS total FROM factures_projet WHERE payee = 1 AND date >= ?`, args: [isoMoisDebut] }).catch(() => ({ rows: [{ total: 0 }] }));

    // Projets actifs avec leurs totaux pour calculer marge moyenne
    const rProjets = await db.execute({ sql: `SELECT id, prix_contrat, budget_estime, date_fin_prevue, statut FROM projets WHERE statut = 'actif'`, args: [] }).catch(() => ({ rows: [] }));
    let totalContrat = 0, totalMarge = 0, nbAvecMarge = 0, nbEnRetard = 0;
    for (const p of (rProjets.rows as any[])) {
      const prix = +p.prix_contrat || +p.budget_estime || 0;
      if (prix > 0) totalContrat += prix;
      // Marge approximative = on lit côté client à terme; ici on prend prix - coûts
      const rCouts = await db.execute({ sql: `SELECT COALESCE(SUM(montant),0) AS d FROM depenses_projet WHERE projet_id = ?`, args: [p.id] }).catch(() => ({ rows: [{ d: 0 }] }));
      const rHeures = await db.execute({ sql: `SELECT COALESCE(SUM(heures * COALESCE(taux_horaire, 35)), 0) AS m FROM heures_projet WHERE projet_id = ?`, args: [p.id] }).catch(() => ({ rows: [{ m: 0 }] }));
      const cout = (+(rCouts.rows[0] as any).d || 0) + (+(rHeures.rows[0] as any).m || 0);
      // Profit net = revenu − coût direct − 15% frais fixes structurels (admin, véhicules, assurance, etc.)
      const fraisFixes = prix * 0.15;
      if (prix > 0) { totalMarge += (prix - cout - fraisFixes); nbAvecMarge++; }
      if (p.date_fin_prevue && p.date_fin_prevue < aujourdhui) nbEnRetard++;
    }
    const margeMoyennePct = totalContrat > 0 ? (totalMarge / totalContrat) * 100 : 0;

    // Factures impayées (payee = 0)
    const rImpayees = await db.execute({
      sql: `SELECT COALESCE(SUM(montant), 0) AS total, COUNT(*) AS n FROM factures_projet WHERE payee = 0 OR payee IS NULL`,
      args: [],
    }).catch(() => ({ rows: [{ total: 0, n: 0 }] }));

    // Banque d'heures (somme des banque_solde des dernières paies par employé)
    const rBanque = await db.execute({
      sql: `SELECT COALESCE(SUM(banque_solde),0) AS total FROM (SELECT employe, banque_solde FROM paies_periodes WHERE id IN (SELECT MAX(id) FROM paies_periodes GROUP BY employe))`,
      args: [],
    }).catch(() => ({ rows: [{ total: 0 }] }));

    // Soumissions en attente de réponse (statut envoyee, > 7 jours)
    const il_y_a_7j = new Date(); il_y_a_7j.setDate(il_y_a_7j.getDate() - 7);
    const rRelances = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM soumissions WHERE statut = 'envoyee' AND date_envoi < ?`,
      args: [il_y_a_7j.toISOString().slice(0, 10)],
    }).catch(() => ({ rows: [{ n: 0 }] }));

    return NextResponse.json({
      revenu_mois: +(rRevenu.rows[0] as any).total || 0,
      marge_moyenne_pct: Math.round(margeMoyennePct * 10) / 10,
      marge_moyenne_montant: totalMarge,
      factures_impayees_montant: +(rImpayees.rows[0] as any).total || 0,
      factures_impayees_nb: +(rImpayees.rows[0] as any).n || 0,
      banque_heures: +(rBanque.rows[0] as any).total || 0,
      projets_en_retard: nbEnRetard,
      soumissions_a_relancer: +(rRelances.rows[0] as any).n || 0,
      projets_actifs: (rProjets.rows as any[]).length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db as getDbClient, listerProjets } from "@/lib/db";

/** Dashboard enrichi : KPIs business agrégés pour la page d'accueil.
 *  IMPORTANT : revenu et marge utilisent la MÊME logique que la page Finances /
 *  Projets (revenu reconnu à la complétion d'un projet, marge via calculerMargeProjet),
 *  pour que le tableau de bord reflète exactement les données saisies. */
export async function GET(_req: NextRequest) {
  try {
    const db: any = getDbClient();
    const moisCourant = new Date().toISOString().slice(0, 7); // YYYY-MM
    const aujourdhui = new Date().toISOString().slice(0, 10);

    // Projets avec totaux (marge déjà calculée par la logique centrale, taux réels).
    const projets = await listerProjets();

    // Revenu du mois = projets COMPLÉTÉS dont la complétion tombe ce mois-ci
    // (prix de contrat, sinon budget) — identique à la reconnaissance de la page Finances.
    let revenu_mois = 0;
    for (const p of projets) {
      if (p.statut !== "complete") continue;
      const finN = String(p.date_fin_reelle || p.date_fin_prevue || p.date_debut || p.date_creation || "").slice(0, 7);
      if (finN === moisCourant) revenu_mois += (+(p.prix_contrat as any) || +(p.budget_estime as any) || 0);
    }

    // Marge moyenne sur les projets ACTIFS (rentabilité en cours, avant taxes).
    const actifs = projets.filter((p) => p.statut === "actif");
    let totalMarge = 0, totalBase = 0, nbEnRetard = 0;
    for (const p of actifs) {
      totalMarge += p.marge || 0;
      totalBase += p.revenu_avant_taxes || 0;
      if (p.date_fin_prevue && p.date_fin_prevue < aujourdhui) nbEnRetard++;
    }
    const margeMoyennePct = totalBase > 0 ? (totalMarge / totalBase) * 100 : 0;

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
      revenu_mois,
      marge_moyenne_pct: Math.round(margeMoyennePct * 10) / 10,
      marge_moyenne_montant: Math.round(totalMarge),
      factures_impayees_montant: +(rImpayees.rows[0] as any).total || 0,
      factures_impayees_nb: +(rImpayees.rows[0] as any).n || 0,
      banque_heures: +(rBanque.rows[0] as any).total || 0,
      projets_en_retard: nbEnRetard,
      soumissions_a_relancer: +(rRelances.rows[0] as any).n || 0,
      projets_actifs: actifs.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

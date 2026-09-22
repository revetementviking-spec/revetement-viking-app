import { NextRequest, NextResponse } from "next/server";
import { db as getDbClient, listerProjets } from "@/lib/db";
import { estProjetActif } from "@/lib/statuts-projet";
import { aujourdhuiMontreal, jourMontreal } from "@/lib/date";

/** Dashboard enrichi : KPIs business agrégés pour la page d'accueil.
 *  IMPORTANT : revenu et marge utilisent la MÊME logique que la page Finances /
 *  Projets (revenu reconnu à la complétion d'un projet, marge via calculerMargeProjet),
 *  pour que le tableau de bord reflète exactement les données saisies. */
export async function GET(_req: NextRequest) {
  try {
    const db: any = getDbClient();
    // Jour et mois de MONTRÉAL : en UTC, le soir au Québec tombait déjà « demain » (et le
    // 1er du mois à 21 h était déjà le mois suivant — le revenu du mois sautait).
    const aujourdhui = aujourdhuiMontreal();
    const moisCourant = aujourdhui.slice(0, 7); // YYYY-MM

    // Projets avec totaux (marge déjà calculée par la logique centrale, taux réels).
    const projets = await listerProjets();

    // Revenu du mois = projets COMPLÉTÉS dont la complétion tombe ce mois-ci
    // (prix de contrat, sinon budget) — identique à la reconnaissance de la page Finances.
    let revenu_mois = 0;
    for (const p of projets) {
      if (p.statut !== "complete") continue;
      const finN = String(p.date_fin_reelle || p.date_fin_prevue || p.date_debut || p.date_creation || "").slice(0, 7);
      // Inclut les extras facturés — même règle que le CA mensuel de la page Finances.
      if (finN === moisCourant) revenu_mois += (+(p.prix_contrat as any) || +(p.budget_estime as any) || 0) + (+((p as any).extras_factures) || 0);
    }

    // Marge moyenne sur les projets ACTIFS (rentabilité en cours, avant taxes).
    const actifs = projets.filter((p) => estProjetActif(p.statut));
    let totalMarge = 0, totalBase = 0, nbEnRetard = 0;
    for (const p of actifs) {
      totalMarge += p.marge || 0;
      totalBase += p.revenu_avant_taxes || 0;
      if (p.date_fin_prevue && p.date_fin_prevue < aujourdhui) nbEnRetard++;
    }
    const margeMoyennePct = totalBase > 0 ? (totalMarge / totalBase) * 100 : 0;

    // Factures impayées (payee = 0). Les factures d'un projet ANNULÉ sont exclues : elles
    // ne seront jamais encaissées et gonflaient le « à encaisser » du tableau de bord.
    const rImpayees = await db.execute({
      sql: `SELECT COALESCE(SUM(fp.montant), 0) AS total, COUNT(*) AS n
            FROM factures_projet fp LEFT JOIN projets p ON p.id = fp.projet_id
            WHERE (fp.payee = 0 OR fp.payee IS NULL) AND COALESCE(p.statut, '') != 'annule'`,
      args: [],
    }).catch(() => ({ rows: [{ total: 0, n: 0 }] }));

    // Banque d'heures (somme des banque_solde des dernières paies par employé)
    const rBanque = await db.execute({
      // La DERNIÈRE période, c'est la plus récente par DATE — pas par id : les périodes
      // sont créées au fil de la découverte des heures, donc saisir une feuille de temps
      // oubliée crée une période ancienne avec un id plus élevé. Le tableau de bord
      // affichait alors un solde de banque périmé, différent de l'écran Paie.
      sql: `SELECT COALESCE(SUM(pp.banque_solde),0) AS total FROM paies_periodes pp
            JOIN (SELECT employe, MAX(debut) AS d FROM paies_periodes GROUP BY employe) m
              ON m.employe = pp.employe AND m.d = pp.debut`,
      args: [],
    }).catch(() => ({ rows: [{ total: 0 }] }));

    // Soumissions en attente de réponse (statut envoyee, > 7 jours) — seuil en jour de Montréal.
    const il_y_a_7j = jourMontreal(new Date(Date.now() - 7 * 86400000).toISOString());
    const rRelances = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM soumissions WHERE statut = 'envoyee' AND date_envoi < ?`,
      args: [il_y_a_7j],
    }).catch(() => ({ rows: [{ n: 0 }] }));

    return NextResponse.json({
      revenu_mois: Math.round(revenu_mois * 100) / 100,
      marge_moyenne_pct: Math.round(margeMoyennePct * 10) / 10,
      marge_moyenne_montant: Math.round(totalMarge),
      factures_impayees_montant: Math.round((+(rImpayees.rows[0] as any).total || 0) * 100) / 100,
      factures_impayees_nb: +(rImpayees.rows[0] as any).n || 0,
      banque_heures: +(rBanque.rows[0] as any).total || 0,
      projets_en_retard: nbEnRetard,
      soumissions_a_relancer: +(rRelances.rows[0] as any).n || 0,
      projets_actifs: actifs.length,
    });
  } catch (e: any) {
    console.error("[/api/dashboard]", e);
    return NextResponse.json({ error: "Tableau de bord indisponible — voir le journal serveur." }, { status: 500 });
  }
}

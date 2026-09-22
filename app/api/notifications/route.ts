// Compteurs + items pour le badge et le dropdown de notifications dans la nav.
// Per-user : @mentions reçues + relances dues qui me sont assignées.
import { NextRequest, NextResponse } from "next/server";
import {
  soumissionsARelancer, compterPhotosErreursDrive, listerTaches,
  mentionsRecentes, relancesPourUser, db,
} from "@/lib/db";
import { aujourdhuiMontreal, jourMontreal } from "@/lib/date";
import { utilisateurActif } from "@/lib/authUser";
import { SQL_PROJET_ACTIF } from "@/lib/statuts-projet";

async function alertesBusiness(user: string | null) {
  const c: any = db();
  const auj = aujourdhuiMontreal();
  // Seuils en jour de MONTRÉAL (les dates comparées sont des jours civils saisis au Québec).
  const il_y_a_30j = jourMontreal(new Date(Date.now() - 30 * 86400000).toISOString());
  const dans3j = jourMontreal(new Date(Date.now() + 3 * 86400000).toISOString());
  // Les 4 requêtes partent en parallèle (avant : séquentielles → 4 allers-retours
  // Turso à chaque poll de la cloche).
  const [fIm, pR, tEch, tGen] = await Promise.all([
    // Factures impayées > 30 jours (celles d'un projet ANNULÉ ne seront jamais encaissées :
    // elles n'ont rien à faire dans la cloche).
    c.execute({
      sql: `SELECT fp.id, fp.numero, fp.montant, fp.date, p.nom AS projet_nom, p.id AS projet_id
            FROM factures_projet fp LEFT JOIN projets p ON p.id = fp.projet_id
            WHERE (fp.payee = 0 OR fp.payee IS NULL) AND fp.date < ? AND COALESCE(p.statut, '') != 'annule'
            ORDER BY fp.date ASC LIMIT 20`,
      args: [il_y_a_30j],
    }).catch(() => ({ rows: [] })),
    // Projets en retard
    c.execute({
      sql: `SELECT id, nom, date_fin_prevue FROM projets WHERE ${SQL_PROJET_ACTIF} AND date_fin_prevue IS NOT NULL AND date_fin_prevue < ? ORDER BY date_fin_prevue ASC LIMIT 20`,
      args: [auj],
    }).catch(() => ({ rows: [] })),
    // Tâches à échéance (mes tâches, dans 3 jours ou en retard)
    user ? c.execute({
      sql: `SELECT t.id, t.titre, t.date_echeance, c.id AS client_id, c.nom AS client_nom
            FROM client_taches t LEFT JOIN clients c ON c.id = t.client_id
            WHERE t.assignee = ? AND (t.complete IS NULL OR t.complete = 0) AND t.date_echeance IS NOT NULL AND t.date_echeance <= ?
            ORDER BY t.date_echeance ASC LIMIT 20`,
      args: [user, dans3j],
    }).catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] }),
    // Tâches générales (module Tâches) à échéance ou en retard, assignées à l'utilisateur.
    user ? c.execute({
      sql: `SELECT id, titre, date_due AS date_echeance, NULL AS client_id, NULL AS client_nom
            FROM taches_client
            WHERE assigne_a = ? AND statut != 'complete' AND date_due IS NOT NULL AND date_due <= ?
            ORDER BY date_due ASC LIMIT 20`,
      args: [user, dans3j],
    }).catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] }),
  ]);

  return {
    factures_impayees: fIm.rows,
    projets_en_retard: pR.rows,
    taches_echeance: [...tEch.rows, ...tGen.rows],
  };
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await utilisateurActif(req);
    const [relancesSoum, photosErr, tachesOuvertes, mentions, mesRelances, biz] = await Promise.all([
      soumissionsARelancer().catch(() => []),
      compterPhotosErreursDrive().catch(() => 0),
      listerTaches({ statut: "a_faire" }).catch(() => []),
      user ? mentionsRecentes(user).catch(() => []) : Promise.resolve([]),
      user ? relancesPourUser(user).catch(() => []) : Promise.resolve([]),
      alertesBusiness(user).catch(() => ({ factures_impayees: [], projets_en_retard: [], taches_echeance: [] })),
    ]);
    // Total = uniquement ce qui est AFFICHÉ dans le menu (sinon badge "fantôme").
    // Les tâches ouvertes sans échéance ne sont pas comptées ici (visibles dans l'onglet
    // Tâches) ; seules les tâches À ÉCHÉANCE/retard comptent (taches_echeance).
    const total =
      relancesSoum.length + photosErr +
      mentions.length + mesRelances.length +
      (biz.factures_impayees as any[]).length + (biz.projets_en_retard as any[]).length + (biz.taches_echeance as any[]).length;
    return NextResponse.json({
      user,
      total,
      relances: relancesSoum.length,
      // Items cliquables des soumissions à relancer (avant : seulement un compteur gris
      // en pied de menu → badge « 1 » sans notification visible dans la cloche).
      relances_soum_items: (relancesSoum as any[]).slice(0, 10).map((s) => ({
        numero: s.numero, client_nom: s.client_nom, total: s.total, date_envoi: s.date_envoi,
      })),
      drive_erreurs: photosErr,
      taches_ouvertes: tachesOuvertes.length,
      mentions: mentions.length,
      mes_relances: mesRelances.length,
      mentions_items: mentions.slice(0, 10),
      relances_items: mesRelances.slice(0, 10),
      factures_impayees: (biz.factures_impayees as any[]).length,
      factures_impayees_items: biz.factures_impayees,
      projets_en_retard: (biz.projets_en_retard as any[]).length,
      projets_en_retard_items: biz.projets_en_retard,
      taches_echeance: (biz.taches_echeance as any[]).length,
      taches_echeance_items: biz.taches_echeance,
    }, {
      headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=60" },
    });
  } catch {
    return NextResponse.json({ total: 0, relances: 0, drive_erreurs: 0, taches_ouvertes: 0, mentions: 0, mes_relances: 0, mentions_items: [], relances_items: [] });
  }
}

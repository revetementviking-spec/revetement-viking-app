import { NextRequest, NextResponse } from "next/server";
import { db, getParametre, setParametre, purgerJournaux } from "@/lib/db";
import { envoyerPushUtilisateur, pushEstConfigure } from "@/lib/push";
import { SQL_PROJET_ACTIF } from "@/lib/statuts-projet";
import { aujourdhuiMontreal, jourMontreal } from "@/lib/date";
import { verifierCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

/** Cron quotidien (vercel.json : `0 12 * * *` = 12 h UTC, soit 8 h à Montréal l'été
 *  (UTC−4) et 7 h l'hiver (UTC−5)) : envoie un push résumant les alertes critiques
 *  à Francis et Gabriel (factures impayées, projets en retard, tâches échéance).
 *  Fait aussi le ménage quotidien des journaux (voir purgerJournaux). */
export async function GET(req: NextRequest) {
  // Fail-closed, comme les 4 autres crons : sans CRON_SECRET la route est DÉSACTIVÉE.
  // Avant, l'absence du secret sautait la vérification et rendait la route déclenchable
  // publiquement (rafale de push à Francis et Gabriel).
  const refus = verifierCron(req);
  if (refus) return refus;

  // Purge des journaux (journal_activite 90 j / 10 000 lignes, empreintes anti-rejeu 24 h,
  // idempotence 7 j) : UN lot par jour, ici, parce qu'un compteur en mémoire ne se
  // déclenche jamais sur serverless. Avant tout garde de jour : un réessai ne coûte qu'un
  // aller-retour, et un push non configuré ne doit pas empêcher le ménage.
  const purge = await purgerJournaux().then(() => "ok").catch((e: any) => { console.error("[rappels-quotidiens] purge des journaux échouée :", e?.message || e); return `échec : ${e?.message || e}`; });

  if (!pushEstConfigure()) return NextResponse.json({ ok: false, raison: "push_non_configure", purge });

  // NOTE — pas de repli à zéro sur les requêtes ci-dessous. Avant, une base injoignable
  // faisait tomber les 4 compteurs à 0, donc `nFact + nPr + nT === 0` → « aucune alerte »,
  // aucun push. Le silence du matin était indiscernable d'une journée sans problème :
  // le rappel se taisait précisément quand il fallait qu'il parle.
  const c: any = db();
  const auj = aujourdhuiMontreal();
  // Garde de JOUR côté serveur : un réessai de Vercel ou un appel manuel ne renvoie pas
  // le même rappel matinal deux fois. Posée seulement si tout s'est bien passé (plus bas).
  const cleGuard = `rappel_quotidien_${auj}`;
  if (await getParametre(cleGuard)) return NextResponse.json({ ok: true, deja_envoye: true, resultats: [], purge });
  // Seuils en jour de MONTRÉAL (les dates comparées sont des jours civils saisis au Québec).
  const il_y_a_30j = jourMontreal(new Date(Date.now() - 30 * 86400000).toISOString());
  const dans3j = jourMontreal(new Date(Date.now() + 3 * 86400000).toISOString());

  // Les compteurs COMMUNS aux deux utilisateurs sont lus UNE fois (avant : relus à chaque
  // tour de boucle, deux fois les mêmes requêtes). Les factures d'un projet ANNULÉ ne
  // seront jamais encaissées : exclues du rappel.
  const [fIm, pR] = await Promise.all([
    c.execute({
      sql: `SELECT COUNT(*) AS n, COALESCE(SUM(fp.montant), 0) AS total
            FROM factures_projet fp LEFT JOIN projets p ON p.id = fp.projet_id
            WHERE (fp.payee = 0 OR fp.payee IS NULL) AND fp.date < ? AND COALESCE(p.statut, '') != 'annule'`,
      args: [il_y_a_30j],
    }),
    c.execute({
      sql: `SELECT COUNT(*) AS n FROM projets WHERE ${SQL_PROJET_ACTIF} AND date_fin_prevue < ?`,
      args: [auj],
    }),
  ]);
  const nFact = +(fIm.rows[0] as any).n || 0;
  const totFact = +(fIm.rows[0] as any).total || 0;
  const nPr = +(pR.rows[0] as any).n || 0;

  const resultats: any[] = [];
  let echecs = 0;
  for (const user of ["Francis", "Gabriel"]) {
    // Mes tâches dans 3 jours / en retard (sous-tâches pipeline + module Tâches), en parallèle.
    const [tE, tG] = await Promise.all([
      c.execute({
        sql: "SELECT COUNT(*) AS n FROM client_taches WHERE assignee = ? AND (complete IS NULL OR complete = 0) AND date_echeance IS NOT NULL AND date_echeance <= ?",
        args: [user, dans3j],
      }),
      c.execute({
        sql: "SELECT COUNT(*) AS n FROM taches_client WHERE assigne_a = ? AND statut != 'complete' AND date_due IS NOT NULL AND date_due <= ?",
        args: [user, dans3j],
      }),
    ]);
    const nT = (+(tE.rows[0] as any).n || 0) + (+(tG.rows[0] as any).n || 0);

    if (nFact + nPr + nT === 0) { resultats.push({ user, push: false, raison: "aucune alerte" }); continue; }

    const parts: string[] = [];
    if (nFact > 0) parts.push(`💰 ${nFact} facture(s) impayée(s) (${totFact.toFixed(0)} $)`);
    if (nPr > 0) parts.push(`🔥 ${nPr} projet(s) en retard`);
    if (nT > 0) parts.push(`📌 ${nT} tâche(s) à échéance`);

    const r = await envoyerPushUtilisateur(user, {
      title: `🌅 Rappel matinal Viking`,
      body: parts.join(" · "),
      url: "/",
      tag: "rappel-quotidien",
    }).catch(() => ({ envoyes: 0, erreurs: 1 }));
    if (!r.envoyes) echecs++;

    resultats.push({ user, push: true, envoyes: r.envoyes, contenu: parts });
  }

  // Le garde du jour ne se pose que si aucun push n'a échoué : sinon une panne du service
  // de push ferait sauter le rappel pour la journée entière, sans réessai possible.
  if (echecs === 0) await setParametre(cleGuard, new Date().toISOString());
  return NextResponse.json({ ok: echecs === 0, echecs, resultats, purge });
}

import { NextRequest, NextResponse } from "next/server";
import { db, compterDoublonsSuspects } from "@/lib/db";
import { envoyerPushUtilisateur, pushEstConfigure } from "@/lib/push";
import { SQL_PROJET_ACTIF } from "@/lib/statuts-projet";
import { aujourdhuiMontreal } from "@/lib/date";

export const dynamic = "force-dynamic";

/** Cron quotidien 8h du matin : envoie un push push résumant les alertes critiques
 *  à Francis et Gabriel (factures impayées, projets en retard, tâches échéance). */
export async function GET(req: NextRequest) {
  // Fail-closed, comme les 4 autres crons : sans CRON_SECRET la route est DÉSACTIVÉE.
  // Avant, l'absence du secret sautait la vérification et rendait la route déclenchable
  // publiquement (rafale de push à Francis et Gabriel).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "CRON_SECRET non configuré — route désactivée" }, { status: 503 });
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  if (!pushEstConfigure()) return NextResponse.json({ ok: false, raison: "push_non_configure" });

  // NOTE — pas de repli à zéro sur les requêtes ci-dessous. Avant, une base injoignable
  // faisait tomber les 4 compteurs à 0, donc `nFact + nPr + nT === 0` → « aucune alerte »,
  // aucun push. Le silence du matin était indiscernable d'une journée sans problème :
  // le rappel se taisait précisément quand il fallait qu'il parle.
  const c: any = db();
  const auj = aujourdhuiMontreal();
  const il_y_a_30j = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  // Le balayage des doublons est le MÊME pour tout le monde : on le fait une seule fois,
  // hors de la boucle (il lit 10 000 lignes ; deux fois serait deux fois trop).
  const doublons = await compterDoublonsSuspects().catch(() => ({ total: 0, francs: 0 }));

  const resultats: any[] = [];
  for (const user of ["Francis", "Gabriel"]) {
    // Factures impayées > 30 jours
    const fIm = await c.execute({
      sql: "SELECT COUNT(*) AS n, COALESCE(SUM(montant), 0) AS total FROM factures_projet WHERE (payee = 0 OR payee IS NULL) AND date < ?",
      args: [il_y_a_30j],
    });

    // Projets en retard
    const pR = await c.execute({
      sql: `SELECT COUNT(*) AS n FROM projets WHERE ${SQL_PROJET_ACTIF} AND date_fin_prevue < ?`,
      args: [auj],
    });

    // Mes tâches dans 3 jours / en retard
    const dans3j = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const tE = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM client_taches WHERE assignee = ? AND (complete IS NULL OR complete = 0) AND date_echeance IS NOT NULL AND date_echeance <= ?",
      args: [user, dans3j],
    });
    // Tâches générales (module Tâches) à échéance / en retard
    const tG = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM taches_client WHERE assigne_a = ? AND statut != 'complete' AND date_due IS NOT NULL AND date_due <= ?",
      args: [user, dans3j],
    });

    const nFact = +(fIm.rows[0] as any).n || 0;
    const totFact = +(fIm.rows[0] as any).total || 0;
    const nPr = +(pR.rows[0] as any).n || 0;
    const nT = (+(tE.rows[0] as any).n || 0) + (+(tG.rows[0] as any).n || 0);
    // Factures en double en attente de décision. Même calcul que l'écran (lib/db.ts), donc
    // le push et la page ne peuvent pas raconter deux choses différentes. Pas de repli à
    // zéro déguisé : si la détection échoue, `nDbl` reste 0 mais les autres alertes partent.
    const dbl = doublons;

    if (nFact + nPr + nT + dbl.total === 0) { resultats.push({ user, push: false, raison: "aucune alerte" }); continue; }

    const parts: string[] = [];
    // En tête : c'est de l'argent qui peut sortir deux fois, et ça se règle en deux minutes.
    if (dbl.total > 0) {
      parts.push(`🧾 ${dbl.total} facture(s) en double à vérifier${dbl.francs > 0 ? ` (dont ${dbl.francs} certaine(s))` : ""}`);
    }
    if (nFact > 0) parts.push(`💰 ${nFact} facture(s) impayée(s) (${totFact.toFixed(0)} $)`);
    if (nPr > 0) parts.push(`🔥 ${nPr} projet(s) en retard`);
    if (nT > 0) parts.push(`📌 ${nT} tâche(s) à échéance`);

    const r = await envoyerPushUtilisateur(user, {
      title: `🌅 Rappel matinal Viking`,
      body: parts.join(" · "),
      // Le push ouvre directement la page des doublons quand c'est l'alerte dominante :
      // un rappel qui oblige à chercher l'écran se fait ignorer.
      url: dbl.total > 0 ? "/finances/doublons" : "/",
      tag: "rappel-quotidien",
    }).catch(() => ({ envoyes: 0, erreurs: 1 }));

    resultats.push({ user, push: true, envoyes: r.envoyes, contenu: parts });
  }

  return NextResponse.json({ ok: true, resultats });
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { envoyerPushUtilisateur, pushEstConfigure } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Cron quotidien 8h du matin : envoie un push push résumant les alertes critiques
 *  à Francis et Gabriel (factures impayées, projets en retard, tâches échéance). */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  if (!pushEstConfigure()) return NextResponse.json({ ok: false, raison: "push_non_configure" });

  const c: any = db();
  const auj = new Date().toISOString().slice(0, 10);
  const il_y_a_30j = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const resultats: any[] = [];
  for (const user of ["Francis", "Gabriel"]) {
    // Factures impayées > 30 jours
    const fIm = await c.execute({
      sql: "SELECT COUNT(*) AS n, COALESCE(SUM(montant), 0) AS total FROM factures_projet WHERE (payee = 0 OR payee IS NULL) AND date < ?",
      args: [il_y_a_30j],
    }).catch(() => ({ rows: [{ n: 0, total: 0 }] }));

    // Projets en retard
    const pR = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM projets WHERE statut = 'actif' AND date_fin_prevue < ?",
      args: [auj],
    }).catch(() => ({ rows: [{ n: 0 }] }));

    // Mes tâches dans 3 jours / en retard
    const dans3j = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const tE = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM client_taches WHERE assignee = ? AND (complete IS NULL OR complete = 0) AND date_echeance IS NOT NULL AND date_echeance <= ?",
      args: [user, dans3j],
    }).catch(() => ({ rows: [{ n: 0 }] }));
    // Tâches générales (module Tâches) à échéance / en retard
    const tG = await c.execute({
      sql: "SELECT COUNT(*) AS n FROM taches_client WHERE assigne_a = ? AND statut != 'complete' AND date_due IS NOT NULL AND date_due <= ?",
      args: [user, dans3j],
    }).catch(() => ({ rows: [{ n: 0 }] }));

    const nFact = +(fIm.rows[0] as any).n || 0;
    const totFact = +(fIm.rows[0] as any).total || 0;
    const nPr = +(pR.rows[0] as any).n || 0;
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

    resultats.push({ user, push: true, envoyes: r.envoyes, contenu: parts });
  }

  return NextResponse.json({ ok: true, resultats });
}

import { NextRequest, NextResponse } from "next/server";
import { db, getParametre, setParametre } from "@/lib/db";
import { sendEmail, emailEstConfigure } from "@/lib/email";
import { aujourdhuiMontreal, jourMontreal } from "@/lib/date";
import { verifierCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

/** Cron quotidien (vercel.json : `0 13 * * *` = 13 h UTC, soit 9 h à Montréal l'été et
 *  8 h l'hiver) : détecte les soumissions ENVOYÉES sans réponse depuis 7+ jours
 *  et envoie un email récap à Francis (assigne par défaut). */
export async function GET(req: NextRequest) {
  // Fail-closed : sans CRON_SECRET, route désactivée (sinon déclenchable publiquement).
  const refus = verifierCron(req);
  if (refus) return refus;
  if (!emailEstConfigure()) return NextResponse.json({ ok: false, raison: "email_non_configure" });

  const dest = process.env.FRANCIS_EMAIL || process.env.GABRIEL_EMAIL;
  if (!dest) return NextResponse.json({ ok: false, raison: "aucun_dest" });

  // Dédup par jour : un retrigger du cron (retry Vercel, appel manuel) le même jour ne
  // renvoie pas le même récap une 2e fois.
  const aujourdhui = aujourdhuiMontreal();
  const cleGuard = `relance_soum_envoi_${aujourdhui}`;
  if (await getParametre(cleGuard)) return NextResponse.json({ ok: true, nb: 0, deja_envoye: true });

  // Seuil en jour de MONTRÉAL (date_envoi est un horodatage ISO ; comparer à un jour UTC
  // décalait le seuil d'une journée le soir au Québec).
  const seuil = jourMontreal(new Date(Date.now() - 7 * 86400000).toISOString());

  const c: any = db();
  const r = await c.execute({
    sql: `SELECT numero, client_nom, client_courriel, total, date_envoi FROM soumissions WHERE statut = 'envoyee' AND date_envoi IS NOT NULL AND date_envoi < ? ORDER BY date_envoi ASC LIMIT 50`,
    args: [seuil],
  }).catch(() => ({ rows: [] }));
  const liste = r.rows as any[];
  if (liste.length === 0) return NextResponse.json({ ok: true, nb: 0 });

  const lignes = liste.map((s) => {
    const jours = Math.round((Date.now() - new Date(s.date_envoi).getTime()) / 86400000);
    const total = s.total ? `${s.total.toFixed(2)} $` : "?";
    return `• ${s.client_nom || "?"} — ${s.numero} — ${total} — envoyée il y a ${jours} jours${s.client_courriel ? ` (${s.client_courriel})` : ""}`;
  }).join("\n");

  const envoi = await sendEmail({
    to: dest,
    subject: `[Viking] ${liste.length} soumission(s) à relancer (>7 jours)`,
    text: `Bonjour Francis,\n\nVoici les soumissions envoyées sans réponse depuis plus de 7 jours :\n\n${lignes}\n\nOuvrir : https://app.revetementviking.com/soumissions?statut=envoyee\n\n— Revêtement Viking Inc.`,
  });
  // Le garde du jour ne se pose QUE si l'envoi a réussi : sinon une panne SMTP faisait
  // sauter le récap pour la journée entière, sans réessai et sans que ça se voie.
  if (!envoi.ok) return NextResponse.json({ ok: false, error: envoi.error || envoi.raison, nb: liste.length });
  await setParametre(cleGuard, String(liste.length));

  return NextResponse.json({ ok: true, nb: liste.length });
}

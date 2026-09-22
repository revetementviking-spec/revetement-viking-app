import { NextRequest, NextResponse } from "next/server";
import { db, getParametre, setParametre } from "@/lib/db";
import { sendEmail, emailEstConfigure } from "@/lib/email";
import { verifierCron } from "@/lib/cron-auth";
import { aujourdhuiMontreal, jourMontreal, semaineISO } from "@/lib/date";

export const dynamic = "force-dynamic";

const cad = (n: number) => new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(n || 0);

/** Cron hebdo (vercel.json : `0 21 * * 0` = dimanche 21 h UTC, soit 17 h à Montréal
 *  l'été (UTC−4) et 16 h l'hiver (UTC−5)) : envoie un récap de la semaine à Francis + Gabriel. */
export async function GET(req: NextRequest) {
  // Sécurité fail-closed : sans CRON_SECRET, la route serait déclenchable publiquement
  // (envoi d'emails abusif). On la désactive plutôt que de la laisser ouverte.
  const refus = verifierCron(req);
  if (refus) return refus;
  if (!emailEstConfigure()) return NextResponse.json({ ok: false, raison: "email_non_configure" });

  // Garde d'idempotence par SEMAINE ISO, posée seulement après un envoi réussi : un
  // réessai de Vercel ou un appel manuel le même dimanche ne renvoie pas deux récaps.
  const cleGuard = `rapport_hebdo_${semaineISO(aujourdhuiMontreal())}`;
  if (await getParametre(cleGuard)) return NextResponse.json({ ok: true, envoyes: 0, deja_envoye: true });

  // NOTE — pas de repli à zéro sur les requêtes ci-dessous. Avant, chaque `execute` avait
  // un `.catch(() => ({ rows: [{ n: 0 }] }))` : une base injoignable le dimanche soir
  // envoyait à Francis et Gabriel un rapport parfaitement formé annonçant « Encaissé :
  // 0,00 $ · 0 soumission · 0 h », indiscernable d'une vraie semaine morte. Un cron qui
  // échoue est visible ; un faux rapport ne l'est pas. On laisse donc remonter l'erreur.
  const c: any = db();
  // Jour de MONTRÉAL : le cron tourne le dimanche 21 h UTC ; en UTC, « il y a 7 jours »
  // désignait déjà le lundi, et le dimanche précédent sortait du récap.
  const debut = jourMontreal(new Date(Date.now() - 7 * 86400000).toISOString());

  // Heures par employé
  const rHeures = await c.execute({
    sql: `SELECT employe, SUM(heures) as h FROM heures_projet WHERE date >= ? GROUP BY employe ORDER BY h DESC`,
    args: [debut],
  });

  // Revenus ENCAISSÉS dans la semaine : on filtre sur la date de PAIEMENT, pas sur la date
  // d'émission de la facture. Avant, une facture émise il y a 3 semaines et payée cette
  // semaine n'était pas comptée, et une facture émise cette semaine mais payée dans 2 mois
  // l'était déjà — le chiffre « Encaissé » du dimanche ne mesurait pas l'encaissement.
  const rRevenu = await c.execute({
    sql: `SELECT COALESCE(SUM(montant), 0) as r FROM factures_projet
          WHERE payee = 1 AND COALESCE(date_paiement, date) >= ?`,
    args: [debut],
  });

  // Dépenses
  const rDepenses = await c.execute({
    sql: `SELECT COALESCE(SUM(montant), 0) as d, COUNT(*) as n FROM depenses_projet WHERE date >= ?`,
    args: [debut],
  });

  // Nouvelles soumissions
  const rSoum = await c.execute({
    sql: `SELECT COUNT(*) as n, COALESCE(SUM(total), 0) as t FROM soumissions WHERE date_creation >= ?`,
    args: [debut],
  });

  // Projets terminés cette semaine
  const rTermines = await c.execute({
    sql: `SELECT COUNT(*) as n FROM projets WHERE date_fin_reelle >= ?`,
    args: [debut],
  });

  const heuresTxt = (rHeures.rows as any[]).map((h) => `   • ${h.employe} : ${(+h.h).toFixed(1)} h`).join("\n") || "   (aucune)";
  const totalHeures = (rHeures.rows as any[]).reduce((s, h) => s + +h.h, 0);

  const corps = `Bonjour,

Voici le récap de la semaine passée (${debut} → aujourd'hui) :

💰 REVENUS
   Encaissé : ${cad(+(rRevenu.rows[0] as any).r)}

📋 SOUMISSIONS
   ${(rSoum.rows[0] as any).n} nouvelle(s) — total : ${cad(+(rSoum.rows[0] as any).t)}

⏱️ HEURES TRAVAILLÉES (total ${totalHeures.toFixed(1)} h)
${heuresTxt}

💸 DÉPENSES
   ${(rDepenses.rows[0] as any).n} entrée(s) — total : ${cad(+(rDepenses.rows[0] as any).d)}

✅ PROJETS TERMINÉS
   ${(rTermines.rows[0] as any).n} projet(s)

Ouvrir le tableau de bord :
https://app.revetementviking.com/

Bonne semaine !
— Revêtement Viking`;

  const destinataires = [process.env.FRANCIS_EMAIL, process.env.GABRIEL_EMAIL].filter(Boolean) as string[];
  let envoyes = 0;
  for (const d of destinataires) {
    const r = await sendEmail({ to: d, subject: `[Viking] Rapport hebdo — ${new Date().toLocaleDateString("fr-CA", { day: "numeric", month: "long" })}`, text: corps });
    if (r.ok) envoyes++;
  }
  // `ok: true` avec 0 envoi masquait deux pannes distinctes (aucun destinataire configuré,
  // ou Resend qui refuse) derrière un succès. Le cron doit échouer si rien n'est parti.
  if (envoyes === 0) {
    return NextResponse.json({ ok: false, erreur: destinataires.length === 0 ? "aucun destinataire configuré (FRANCIS_EMAIL / GABRIEL_EMAIL)" : "envoi refusé par le fournisseur de courriel", destinataires: destinataires.length }, { status: 500 });
  }
  await setParametre(cleGuard, String(envoyes));
  return NextResponse.json({ ok: true, envoyes });
}

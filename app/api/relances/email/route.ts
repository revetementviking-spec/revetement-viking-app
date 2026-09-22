import { NextRequest, NextResponse } from "next/server";
import { relancesDues, getParametre, setParametre } from "@/lib/db";
import { sendEmail, emailEstConfigure } from "@/lib/email";
import { aujourdhuiMontreal } from "@/lib/date";
import { dateISOLocale } from "@/lib/calculs";
import { verifierCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

const COURRIELS: Record<string, string | undefined> = {
  Gabriel: process.env.GABRIEL_EMAIL,
  Francis: process.env.FRANCIS_EMAIL,
};

// Cron quotidien (Vercel, `0 12 * * *` = 12 h UTC, soit 8 h à Montréal l'été et 7 h
// l'hiver) : groupe les relances par assignee et envoie un courriel résumé à chacun avec
// les clients à relancer aujourd'hui (ou en retard).
// Protection fail-closed : CRON_SECRET obligatoire, sinon la route est désactivée
// (sans secret, elle serait déclenchable publiquement → envoi d'emails aux clients).
export async function GET(req: NextRequest) {
  const refus = verifierCron(req);
  if (refus) return refus;
  if (!emailEstConfigure()) return NextResponse.json({ ok: false, raison: "email_non_configure" });

  const dus = await relancesDues();
  if (dus.length === 0) return NextResponse.json({ ok: true, envoyes: 0, relances: 0 });

  const today = aujourdhuiMontreal();
  const parUser = new Map<string, typeof dus>();
  for (const c of dus) {
    const u = c.assignee || "Gabriel"; // par défaut : Gabriel
    if (!parUser.has(u)) parUser.set(u, [] as any);
    (parUser.get(u) as any).push(c);
  }

  let envoyes = 0;
  let tentes = 0;
  const erreurs: string[] = [];
  for (const [user, liste] of parUser) {
    const dest = COURRIELS[user];
    if (!dest) continue;
    // Dédup par jour et par destinataire : un retrigger du cron (retry Vercel, appel manuel)
    // le même jour ne renvoie pas le même récap une 2e fois.
    const cleGuard = `relance_pipeline_envoi_${user}_${today}`;
    if (await getParametre(cleGuard)) continue;
    tentes++;
    const lignes = liste.map((c) => {
      const retard = c.date_relance < today ? ` (⚠️ en retard de ${joursDepuis(c.date_relance, today)} j)` : " (aujourd'hui)";
      const coords = [c.telephone, c.courriel].filter(Boolean).join(" · ");
      return `• ${c.nom}${c.adresse ? ` — ${c.adresse}` : ""} — relance le ${c.date_relance}${retard}${coords ? `\n  ${coords}` : ""}`;
    }).join("\n\n");
    const sujet = `[Pipeline Viking] ${liste.length} relance(s) pour toi aujourd'hui`;
    const corps = `Bonjour ${user},

Voici tes relances clients pour aujourd'hui :

${lignes}

Ouvre le pipeline :
https://app.revetementviking.com/clients

— Revêtement Viking Inc.`;
    const r = await sendEmail({ to: dest, subject: sujet, text: corps });
    if (r.ok) { envoyes++; await setParametre(cleGuard, String(liste.length)); }
    else erreurs.push(`${user} : ${r.error || r.raison || "?"}`);
  }
  // Des destinataires à servir et RIEN de parti : c'est une panne (fournisseur qui refuse,
  // RESEND_FROM absent…), pas un succès. Le cron doit le dire — comme rapport-hebdo.
  if (tentes > 0 && envoyes === 0) {
    return NextResponse.json({ ok: false, envoyes: 0, relances: dus.length, erreurs }, { status: 500 });
  }
  return NextResponse.json({ ok: true, envoyes, relances: dus.length, ...(erreurs.length ? { erreurs } : {}) });
}

/** Jours entiers entre deux dates AAAA-MM-JJ, lues en heure LOCALE : `new Date("AAAA-MM-JJ")`
 *  les lisait à minuit UTC et pouvait décaler le compte d'un jour au changement d'heure. */
function joursDepuis(debut: string, fin: string): number {
  const d = dateISOLocale(debut).getTime();
  const f = dateISOLocale(fin).getTime();
  return Math.max(0, Math.round((f - d) / 86400000));
}

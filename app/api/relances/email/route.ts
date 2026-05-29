import { NextRequest, NextResponse } from "next/server";
import { relancesDues } from "@/lib/db";
import { sendEmail, emailEstConfigure } from "@/lib/email";

export const dynamic = "force-dynamic";

const COURRIELS: Record<string, string | undefined> = {
  Gabriel: process.env.GABRIEL_EMAIL,
  Francis: process.env.FRANCIS_EMAIL,
};

// Cron quotidien (Vercel) : groupe les relances par assignee et envoie un courriel
// résumé à chacun avec les clients à relancer aujourd'hui (ou en retard).
// Protection : si CRON_SECRET est défini, le header Authorization doit le contenir.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  if (!emailEstConfigure()) return NextResponse.json({ ok: false, raison: "email_non_configure" });

  const dus = await relancesDues();
  if (dus.length === 0) return NextResponse.json({ ok: true, envoyes: 0, relances: 0 });

  const today = new Date().toISOString().slice(0, 10);
  const parUser = new Map<string, typeof dus>();
  for (const c of dus) {
    const u = c.assignee || "Gabriel"; // par défaut : Gabriel
    if (!parUser.has(u)) parUser.set(u, [] as any);
    (parUser.get(u) as any).push(c);
  }

  let envoyes = 0;
  for (const [user, liste] of parUser) {
    const dest = COURRIELS[user];
    if (!dest) continue;
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
    if (r.ok) envoyes++;
  }
  return NextResponse.json({ ok: true, envoyes, relances: dus.length });
}

function joursDepuis(debut: string, fin: string): number {
  const d = new Date(debut).getTime();
  const f = new Date(fin).getTime();
  return Math.max(0, Math.round((f - d) / 86400000));
}

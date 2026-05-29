import { NextRequest, NextResponse } from "next/server";
import { getContratPipelineParId, getClient, marquerContratEnvoye } from "@/lib/db";
import { sendEmail, emailEstConfigure } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const co = await getContratPipelineParId(+id);
  if (!co) return NextResponse.json({ error: "contrat introuvable" }, { status: 404 });
  if (co.statut === "signe") return NextResponse.json({ error: "déjà signé" }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const cl = await getClient(co.client_id);
  const destinataire = body.to || cl?.courriel;
  if (!destinataire) return NextResponse.json({ error: "courriel destinataire manquant" }, { status: 400 });

  if (!emailEstConfigure()) {
    return NextResponse.json({ ok: false, raison: "email_non_configure" });
  }

  const origin = req.headers.get("origin") || `https://${req.headers.get("host")}`;
  const lien = `${origin}/contrat/${co.token}`;
  const sujet = body.subject || `Contrat à signer — Revêtement Viking Inc. (${co.numero})`;
  const corps = body.text || `Bonjour ${cl?.nom || ""},

Voici votre contrat de rénovation. Cliquez sur le lien sécurisé ci-dessous pour le consulter et le signer électroniquement :

${lien}

Le contrat ${co.numero} contient tous les détails relatifs aux travaux et aux conditions. Prenez le temps de le lire avant de signer.

Une copie signée vous sera renvoyée immédiatement après votre signature.

Cordialement,

Revêtement Viking Inc.
RBQ 5811-4299-01
revetementviking@gmail.com
(438) 493-2041`;

  const html = body.html || `<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;margin:0;padding:24px;background:#f8fafc">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
<tr><td style="padding-bottom:20px;border-bottom:2px solid #1e3a5f">
<table cellpadding="0" cellspacing="0"><tr>
<td><span style="font-size:32px">⚓</span></td>
<td style="padding-left:12px"><strong style="font-size:18px;color:#1e3a5f">Revêtement Viking Inc.</strong><br><span style="font-size:11px;color:#64748b">RBQ 5811-4299-01</span></td>
</tr></table></td></tr>
<tr><td style="padding:20px 0">
<h2 style="margin:0 0 8px 0;color:#1e3a5f">Bonjour ${cl?.nom || ""},</h2>
<p>Voici votre <strong>contrat de rénovation ${co.numero}</strong> prêt à être signé électroniquement.</p>
<p style="text-align:center;margin:28px 0">
<a href="${lien}" style="background:#1e3a5f;color:white;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block">✍️ Consulter et signer le contrat</a>
</p>
<p style="font-size:13px;color:#475569">Le lien est <strong>personnel et sécurisé</strong>. Le contrat contient tous les détails relatifs aux travaux, à la portée et aux conditions. Prenez le temps de le lire avant de signer.</p>
<p style="font-size:13px;color:#475569">Une copie signée vous sera renvoyée immédiatement après votre signature.</p>
</td></tr>
<tr><td style="padding-top:20px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">
Revêtement Viking Inc. · 1634 Rue Joliette, Montréal H1W 3E9<br>
<a href="mailto:revetementviking@gmail.com" style="color:#1e3a5f">revetementviking@gmail.com</a> · (438) 493-2041
</td></tr></table></body></html>`;

  const r = await sendEmail({ to: destinataire, subject: sujet, text: corps, html });
  if (r.ok) {
    await marquerContratEnvoye(+id, destinataire, r.messageId);
    return NextResponse.json({ ok: true, messageId: r.messageId, destinataire });
  } else {
    await marquerContratEnvoye(+id, destinataire, undefined, r.error || r.raison);
    return NextResponse.json({ ok: false, error: r.error || r.raison });
  }
}

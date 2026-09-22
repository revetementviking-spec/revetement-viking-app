import { NextRequest, NextResponse } from "next/server";
import { marquerDossierSigneEnvoye } from "@/lib/db";
import { construireCertificat } from "@/lib/certificat";
import { genererCertificatBuffer } from "@/lib/pdf-certificat";
import { sendEmail, emailEstConfigure } from "@/lib/email";
import { publicOrigin } from "@/lib/origin";
import { journaliser } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Envoi au client du dossier complet une fois le contrat signé : le contrat signé + le
// certificat d'authentification, tous deux en pièces jointes. Route AUTHENTIFIÉE (le suffixe
// /envoyer-signe ne fait pas partie de l'allowlist publique de proxy.ts) : c'est un geste de
// Francis, jamais déclenché par le visiteur.
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const r = await construireCertificat(token);
  if (!r) return NextResponse.json({ error: "contrat introuvable" }, { status: 404 });
  if (r.contrat.statut !== "signe") {
    return NextResponse.json({ error: "le contrat n'est pas signé — rien à transmettre" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({} as any));
  const destinataire = body.to || r.data.client_courriel;
  if (!destinataire) return NextResponse.json({ error: "courriel du client manquant" }, { status: 400 });
  if (!emailEstConfigure()) return NextResponse.json({ ok: false, raison: "email_non_configure" });

  // Contrat signé (archivé en base) + certificat régénéré à l'instant
  const m = String(r.contrat.pdf_signe || "").match(/^data:[^;]+;base64,(.+)$/);
  if (!m) return NextResponse.json({ error: "PDF signé introuvable ou illisible" }, { status: 500 });
  const contratBuf = Buffer.from(m[1], "base64");

  let certificatBuf: Buffer;
  try {
    certificatBuf = await genererCertificatBuffer(r.data);
  } catch (e: any) {
    return NextResponse.json({ error: "échec de génération du certificat : " + (e?.message || "") }, { status: 500 });
  }

  const num = (r.data.numero || token).replace(/[^\w.-]/g, "_");
  const lienCertificat = `${publicOrigin(req)}/api/contrats-pipeline/${token}/certificat`;
  const nom = r.data.client_nom || "";

  const texte = `Bonjour ${nom},

Merci d'avoir signé votre contrat. Vous trouverez en pièces jointes :

  • Le contrat ${r.data.numero} signé, en PDF ;
  • Le certificat d'authentification de votre signature électronique.

Le certificat consigne l'historique complet du dossier (envoi, consultation, signature, avec
horodatage et adresse IP) ainsi que l'empreinte numérique du contrat, qui permet de démontrer
en tout temps que le document n'a pas été modifié depuis votre signature.

Vous pouvez aussi le consulter en ligne : ${lienCertificat}

Conservez ces deux documents. Nous en gardons également une copie.

Au plaisir de réaliser vos travaux,

Revêtement Viking Inc.
RBQ 5811-4299-01
revetementviking@gmail.com
(438) 493-2041`;

  const html = `<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;color:#0f172a;line-height:1.5;margin:0;padding:24px;background:#f8fafc">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;padding:24px">
<tr><td style="padding-bottom:20px;border-bottom:2px solid #1e3a5f">
<strong style="font-size:18px;color:#1e3a5f">Revêtement Viking Inc.</strong><br><span style="font-size:11px;color:#64748b">RBQ 5811-4299-01</span>
</td></tr>
<tr><td style="padding:20px 0">
<h2 style="margin:0 0 8px 0;color:#1e3a5f">Merci ${nom} !</h2>
<p>Votre <strong>contrat ${r.data.numero}</strong> est signé. Vous trouverez en pièces jointes :</p>
<ul style="padding-left:18px">
<li>Le <strong>contrat signé</strong> (PDF)</li>
<li>Le <strong>certificat d'authentification</strong> de votre signature électronique</li>
${/^data:/.test((r.data as any).annexe_data || "") ? "<li>Le <strong>devis</strong> joint au contrat</li>" : ""}
</ul>
<p style="font-size:13px;color:#475569">Le certificat consigne l'historique complet du dossier — envoi, consultation, signature, avec horodatage et adresse IP — ainsi que l'empreinte numérique du contrat, qui permet de démontrer en tout temps que le document n'a pas été modifié depuis votre signature.</p>
<p style="text-align:center;margin:24px 0">
<a href="${lienCertificat}" style="background:#1e3a5f;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:bold;display:inline-block">Consulter le certificat en ligne</a>
</p>
<p style="font-size:13px;color:#475569">Conservez ces deux documents. Nous en gardons également une copie.</p>
</td></tr>
<tr><td style="padding-top:20px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8">
Revêtement Viking Inc. · 1634 Rue Joliette, Montréal H1W 3E9<br>
<a href="mailto:revetementviking@gmail.com" style="color:#1e3a5f">revetementviking@gmail.com</a> · (438) 493-2041
</td></tr></table></body></html>`;

  // Le devis joint fait partie du dossier que le client vient d'accepter : il repart
  // avec, sans quoi il n'aurait plus qu'un lien à jeton pour le retrouver.
  const piecesJointes: any[] = [
    { filename: `contrat-${num}-signe.pdf`, content: contratBuf, contentType: "application/pdf" },
    { filename: `certificat-${num}.pdf`, content: certificatBuf, contentType: "application/pdf" },
  ];
  const brut: string = (r.data as any).annexe_data || "";
  const mAnnexe = /^data:([^;]+);base64,([\s\S]*)$/.exec(brut);
  if (mAnnexe) {
    piecesJointes.push({
      filename: (r.data as any).annexe_nom || `devis-${num}.pdf`,
      content: Buffer.from(mAnnexe[2], "base64"),
      contentType: (r.data as any).annexe_type || mAnnexe[1],
    });
  }

  const envoi = await sendEmail({
    to: destinataire,
    subject: `Votre contrat signé ${r.data.numero} + certificat d'authentification — Revêtement Viking Inc.`,
    text: texte,
    html,
    attachments: piecesJointes,
  });

  if (!envoi.ok) {
    // Un dossier signé qui ne part pas doit laisser une trace : Francis a cliqué, le
    // client n'a rien reçu, et sans cette ligne rien ne le disait six mois plus tard.
    journaliser("contrat.signe", {
      req, ref_type: "contrat", ref_id: r.data.numero,
      description: `ÉCHEC d'envoi du dossier signé à ${destinataire} : ${envoi.error || envoi.raison || "?"}`,
    }).catch(() => {});
    return NextResponse.json({ ok: false, error: envoi.error || envoi.raison });
  }

  await marquerDossierSigneEnvoye(token, destinataire);
  journaliser("contrat.signe", {
    req, ref_type: "contrat", ref_id: r.data.numero,
    description: `Dossier signé (contrat + certificat) transmis à ${destinataire} — intégrité ${r.data.verdict}`,
  }).catch(() => {});

  return NextResponse.json({ ok: true, destinataire, messageId: envoi.messageId, verdict: r.data.verdict });
}

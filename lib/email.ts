// Envoi d'email serveur via Gmail SMTP (nodemailer).
// Variables d'env requises :
//   GMAIL_USER          = revetementviking@gmail.com
//   GMAIL_APP_PASSWORD  = mot de passe d'application Google (16 car., 2FA requis)
// Si non configuré, sendEmail retourne { ok:false, raison:"non_configure" }
// → le client peut alors retomber sur mailto.
import nodemailer from "nodemailer";

export interface EmailResult { ok: boolean; raison?: string; messageId?: string; error?: string; }

export function emailEstConfigure(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export async function sendEmail(opts: { to: string; subject: string; text: string; replyTo?: string }): Promise<EmailResult> {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return { ok: false, raison: "non_configure" };
  if (!opts.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.to)) return { ok: false, error: "destinataire invalide" };

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
    const info = await transporter.sendMail({
      from: `"Revêtement Viking Inc." <${user}>`,
      to: opts.to,
      replyTo: opts.replyTo || user,
      subject: opts.subject,
      text: opts.text,
    });
    return { ok: true, messageId: info.messageId };
  } catch (e: any) {
    return { ok: false, error: e?.message || "erreur SMTP" };
  }
}

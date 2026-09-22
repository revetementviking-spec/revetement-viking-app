// Envoi d'email serveur — supporte 2 fournisseurs (premier configuré gagne) :
// 1. Resend (recommandé, pas de 2FA requise) : RESEND_API_KEY + RESEND_FROM (ex: contrats@revetementviking.com — domaine vérifié dans Resend, OU "onboarding@resend.dev" pour tester sans domaine)
// 2. Gmail SMTP (legacy, requiert App Password 2FA) : GMAIL_USER + GMAIL_APP_PASSWORD
// Toutes les communications sortantes sont brandées "Revêtement Viking Inc."
//
// Réglages facultatifs :
// - RESEND_API_URL      : viser un relais interne (ou un serveur d'essai) au lieu de Resend.
// - EMAIL_NOTIFICATIONS : boîte qui reçoit les AVIS INTERNES (chantier complété, etc.).
//                         Par défaut revetementviking@gmail.com — voir lib/notif-projet.ts.
import nodemailer from "nodemailer";
import { journaliser, type ActiviteType } from "@/lib/audit";

export interface EmailResult { ok: boolean; raison?: string; messageId?: string; error?: string; }
export interface EmailAttachment { filename: string; content: Buffer | string; contentType?: string }
export interface EmailOpts { to: string; subject: string; text: string; html?: string; replyTo?: string; attachments?: EmailAttachment[]; }

const NOM_EXPEDITEUR = "Revêtement Viking Inc.";
const REPLY_TO_DEFAUT = "revetementviking@gmail.com";

export function emailEstConfigure(): boolean {
  return !!(process.env.RESEND_API_KEY || (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD));
}

/** En production (Vercel ou NODE_ENV=production), l'expéditeur de test de Resend est
 *  interdit : un courriel parti de « onboarding@resend.dev » finit en pourriel ou est
 *  refusé, et personne ne le voit. Sans RESEND_FROM, on n'envoie PAS. */
export function enProduction(): boolean {
  return !!process.env.VERCEL || process.env.NODE_ENV === "production";
}

/** « m***@domaine.ca » : assez pour retrouver le destinataire dans le journal, sans y
 *  stocker l'adresse complète. */
export function masquerCourriel(courriel: string): string {
  const [local, domaine] = String(courriel || "").split("@");
  if (!domaine) return "***";
  return `${(local || "").slice(0, 1)}***@${domaine}`;
}

// Types « courriel.envoye » / « courriel.echec » : à ajouter à ActiviteType (lib/audit.ts,
// fichier d'un autre agent — demande écrite). Le cast tombera de lui-même ensuite.
const TYPE_ENVOYE = "courriel.envoye" as ActiviteType;
const TYPE_ECHEC = "courriel.echec" as ActiviteType;

/** Journalise l'issue d'un envoi — fire-and-forget, ne bloque ni ne lève. */
function journaliserEnvoi(opts: EmailOpts, r: EmailResult, fournisseur: string): void {
  const dest = masquerCourriel(opts.to);
  journaliser(r.ok ? TYPE_ENVOYE : TYPE_ECHEC, {
    ref_type: "courriel",
    ref_id: r.messageId || undefined,
    description: r.ok
      ? `${fournisseur} → ${dest} · « ${opts.subject.slice(0, 120)} » · id ${r.messageId}`
      : `${fournisseur} → ${dest} · « ${opts.subject.slice(0, 120)} » · ÉCHEC : ${r.error || r.raison || "?"}`,
  }).catch(() => {});
}

export async function sendEmail(opts: EmailOpts): Promise<EmailResult> {
  if (!opts.to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.to)) return { ok: false, error: "destinataire invalide" };
  const r = await envoyer(opts);
  journaliserEnvoi(opts, r.resultat, r.fournisseur);
  return r.resultat;
}

async function envoyer(opts: EmailOpts): Promise<{ resultat: EmailResult; fournisseur: string }> {
  // === Resend (pas de 2FA) ===
  if (process.env.RESEND_API_KEY) {
    if (!process.env.RESEND_FROM && enProduction()) {
      return { fournisseur: "resend", resultat: { ok: false, error: "RESEND_FROM non configuré" } };
    }
    const from = process.env.RESEND_FROM || "onboarding@resend.dev"; // hors production seulement
    try {
      const body: any = {
        from: `${NOM_EXPEDITEUR} <${from}>`,
        to: [opts.to],
        reply_to: opts.replyTo || REPLY_TO_DEFAUT,
        subject: opts.subject,
        text: opts.text,
        ...(opts.html ? { html: opts.html } : {}),
      };
      if (opts.attachments?.length) {
        body.attachments = opts.attachments.map((a) => ({
          filename: a.filename,
          content: typeof a.content === "string" ? a.content : a.content.toString("base64"),
        }));
      }
      // Borne de temps : sinon un Resend qui n'aboutit pas gèle l'envoi (et le cron).
      // RESEND_API_URL permet de viser un relais interne — ou un serveur d'essai, pour
      // vérifier un envoi de bout en bout sans écrire à un vrai destinataire.
      const r = await fetch(process.env.RESEND_API_URL || "https://api.resend.com/emails", {
        signal: AbortSignal.timeout(20_000),
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d: any = await r.json().catch(() => ({}));
      if (r.ok && d.id) return { fournisseur: "resend", resultat: { ok: true, messageId: d.id } };
      return { fournisseur: "resend", resultat: { ok: false, error: d.message || `Resend HTTP ${r.status}` } };
    } catch (e: any) {
      return { fournisseur: "resend", resultat: { ok: false, error: e?.message || "Resend erreur" } };
    }
  }

  // === Gmail SMTP (legacy) ===
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return { fournisseur: "aucun", resultat: { ok: false, raison: "non_configure" } };
  try {
    const transporter = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
    const info = await transporter.sendMail({
      from: `"${NOM_EXPEDITEUR}" <${user}>`,
      to: opts.to,
      replyTo: opts.replyTo || REPLY_TO_DEFAUT,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: typeof a.content === "string" ? Buffer.from(a.content, "base64") : a.content,
        contentType: a.contentType,
      })),
    });
    return { fournisseur: "gmail", resultat: { ok: true, messageId: info.messageId } };
  } catch (e: any) {
    return { fournisseur: "gmail", resultat: { ok: false, error: e?.message || "erreur SMTP" } };
  }
}

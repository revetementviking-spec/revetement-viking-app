// Demande d'avis Google après un chantier complété — logique PURE (texte et liens),
// partagée par la fiche projet (bouton) et par /api/email/review (envoi serveur).
//
// Pourquoi trois façons d'envoyer : l'envoi serveur exige RESEND_FROM en prod ; la
// composition Gmail web ne marche que sur ordinateur (sur téléphone, mail.google.com
// ignore les paramètres et ouvre la boîte de réception) ; le lien mailto: est ce qui
// ouvre l'app courriel du téléphone avec le message prérempli.

export const VIKING_EMAIL = "revetementviking@gmail.com";
export const VIKING_TELEPHONE = "(438) 493-2041";
export const LIEN_AVIS_GOOGLE = "https://g.page/r/CY_Ub0jeQKebEB0/review";
export const SUJET_DEMANDE_AVIS = "Travaux complétés — Revêtement Viking Inc.";

/** Premier mot du nom du client, pour le « Bonjour Julie ». */
export function prenomClient(nomClient?: string | null): string {
  return String(nomClient || "").trim().split(/\s+/)[0] || "";
}

export function messageDemandeAvis(nomClient?: string | null): string {
  const prenom = prenomClient(nomClient);
  return `Bonjour${prenom ? " " + prenom : ""},

Les travaux sont maintenant complets.

Si vous avez apprécié notre service vous pouvez nous laisser un avis sur notre page, c'est toujours grandement apprécié.

Voici le lien : ${LIEN_AVIS_GOOGLE}

Page Google : Revêtement Viking Inc.

Au plaisir de refaire affaire avec vous dans le futur.

Cordialement,

Revêtement Viking Inc.
${VIKING_EMAIL}
${VIKING_TELEPHONE}`;
}

/** Composition Gmail web (ordinateur seulement), compte Viking présélectionné. */
export function urlGmailDemandeAvis(courriel: string, nomClient?: string | null): string {
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(VIKING_EMAIL)}&view=cm&fs=1&to=${encodeURIComponent(courriel)}&su=${encodeURIComponent(SUJET_DEMANDE_AVIS)}&body=${encodeURIComponent(messageDemandeAvis(nomClient))}`;
}

/** Lien mailto: — ouvre l'app courriel de l'appareil (Gmail sur le téléphone). */
export function urlMailtoDemandeAvis(courriel: string, nomClient?: string | null): string {
  return `mailto:${encodeURIComponent(courriel)}?subject=${encodeURIComponent(SUJET_DEMANDE_AVIS)}&body=${encodeURIComponent(messageDemandeAvis(nomClient))}`;
}

/** Téléphone ou tablette : pas de composition Gmail web possible, on propose mailto: d'abord. */
export function estAppareilTactile(nav: { maxTouchPoints?: number; userAgent?: string } | undefined): boolean {
  if (!nav) return false;
  if ((nav.maxTouchPoints || 0) > 0 && /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || "")) return true;
  return false;
}

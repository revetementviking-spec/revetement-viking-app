// Envoi de notifications push Web (PWA) via VAPID + web-push.
// Variables d'env requises :
//   VAPID_PUBLIC_KEY    = clé publique (aussi exposée à la page de souscription)
//   VAPID_PRIVATE_KEY   = clé privée
//   VAPID_SUBJECT       = mailto:revetementviking@gmail.com (par défaut)

import webpush from "web-push";
import { listerPushSubscriptionsUser, supprimerPushSubscription } from "@/lib/db";

export function pushEstConfigure(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let _initialise = false;
function init() {
  if (_initialise) return;
  if (!pushEstConfigure()) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:revetementviking@gmail.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  _initialise = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;          // URL ouverte au clic
  icon?: string;         // par défaut /logo-viking.svg
  badge?: string;
  tag?: string;          // remplace une notification existante avec le même tag
}

/** Envoie une notification à toutes les souscriptions d'un utilisateur (multi-appareils). */
export async function envoyerPushUtilisateur(user: string, payload: PushPayload): Promise<{ envoyes: number; erreurs: number }> {
  init();
  if (!pushEstConfigure()) return { envoyes: 0, erreurs: 0 };
  const subs = await listerPushSubscriptionsUser(user);
  let envoyes = 0, erreurs = 0;
  const data = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
    icon: payload.icon || "/logo-viking.svg",
    badge: payload.badge || "/logo-viking.svg",
    tag: payload.tag || "viking-notif",
  });
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        data,
      );
      envoyes++;
    } catch (e: any) {
      erreurs++;
      // 410 Gone / 404 → désabonnement permanent, on nettoie
      if (e?.statusCode === 410 || e?.statusCode === 404) {
        await supprimerPushSubscription(s.endpoint).catch(() => {});
      }
    }
  }
  return { envoyes, erreurs };
}

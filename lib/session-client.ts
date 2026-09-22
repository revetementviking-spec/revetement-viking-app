// Profil et notifications partagés entre les montages de Navigation.
//
// Navigation n'est pas dans le layout : elle se remonte à CHAQUE navigation client, et
// chaque montage redemandait le profil (avatar) et les notifications au serveur — deux
// requêtes Turso par clic d'onglet, pour des données qui ne changent pas d'une page à
// l'autre. Ici, une promesse par chargement de page complet ; la déconnexion l'oublie.

export interface ProfilClient { username?: string; nom_affichage?: string; photo_data?: string }

let profilPromise: Promise<ProfilClient | null> | null = null;

export function chargerProfilPartage(): Promise<ProfilClient | null> {
  if (!profilPromise) {
    profilPromise = fetch("/api/auth/profil")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((p: ProfilClient | null) => {
        // Échec (401, réseau) : on ne garde pas un « null » à vie, la prochaine navigation réessaie.
        if (!p) profilPromise = null;
        return p;
      });
  }
  return profilPromise;
}

const FRAICHEUR_NOTIFS_MS = 30000;
let notifsCache: { t: number; promesse: Promise<any | null> } | null = null;

/** Notifications : réutilise la réponse de moins de 30 s (montage d'une nouvelle page) ;
 *  `force` pour la minuterie et le retour sur l'onglet. */
export function chargerNotifsPartage(force = false): Promise<any | null> {
  if (!force && notifsCache && Date.now() - notifsCache.t < FRAICHEUR_NOTIFS_MS) return notifsCache.promesse;
  const promesse = fetch("/api/notifications")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((d) => {
      // Une réponse invalide ne doit pas bloquer les 30 prochaines secondes.
      if (!d && notifsCache && notifsCache.promesse === promesse) notifsCache = null;
      return d;
    });
  notifsCache = { t: Date.now(), promesse };
  return promesse;
}

/** À la déconnexion : le prochain montage redemande tout (autre usager possible). */
export function oublierSessionClient(): void {
  profilPromise = null;
  notifsCache = null;
}

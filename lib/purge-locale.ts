// Purge de tout ce que l'app garde sur l'appareil, à la déconnexion.
//
// Avant, « Se déconnecter » ne supprimait que le cookie : le cache instantané du tableau
// de bord (chiffres de l'année, tâches), les brouillons de soumission, la file hors-ligne
// (heures et dépenses à rejouer !), IndexedDB et le cache API du service worker restaient
// lisibles par la personne suivante sur le même téléphone — et la file hors-ligne partait
// sous SON compte au retour du réseau.

import { effacerAbandons, memoriserUtilisateur, viderFileSansEnvoyer } from "./fileOffline";
import { oublierSessionClient } from "./session-client";

const PREFIXES = ["vk", "nouveautes"];
/** Clés historiques qui ne suivent pas le préfixe `vk` mais appartiennent à l'usager. */
const CLES_HISTORIQUES = ["soumission-xpress-draft"];
const BASE_INDEXEDDB = "vk-offline";
const CACHE_API_SW = /^viking-.*-api$/;

function purgerStockage(s: Storage | undefined): void {
  if (!s) return;
  try {
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i);
      if (!k) continue;
      if (PREFIXES.some((p) => k.startsWith(p)) || CLES_HISTORIQUES.includes(k)) s.removeItem(k);
    }
  } catch { /* stockage indisponible (mode privé, iframe) */ }
}

function avecDelai<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((res) => setTimeout(() => res(undefined), ms))]);
}

async function supprimerIndexedDB(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  // La connexion ouverte par offlineCache bloquerait la suppression : on la ferme d'abord.
  try { (await import("./offlineCache")).fermerCacheOffline(); } catch { /* module absent */ }
  await avecDelai(new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(BASE_INDEXEDDB);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch { resolve(); }
  }), 1500);
}

async function supprimerCachesApi(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const noms = await avecDelai(caches.keys(), 1500);
    await Promise.all((noms || []).filter((n) => CACHE_API_SW.test(n)).map((n) => caches.delete(n)));
  } catch { /* API Cache indisponible */ }
}

/** Efface les traces locales de l'usager. Ne lève jamais : à appeler juste avant de
 *  quitter vers /login, une fois la session serveur supprimée. */
export async function purgerLocal(): Promise<void> {
  try { viderFileSansEnvoyer(); } catch { /* ignore */ }
  try { effacerAbandons(); } catch { /* ignore */ }
  try { memoriserUtilisateur(null); } catch { /* ignore */ }
  try { oublierSessionClient(); } catch { /* ignore */ }
  if (typeof window !== "undefined") {
    purgerStockage(window.localStorage);
    purgerStockage(window.sessionStorage);
  }
  await Promise.all([supprimerIndexedDB(), supprimerCachesApi()]);
}

// Cache IndexedDB des données critiques pour mode hors-ligne complet.
// Sauvegarde clients, projets, soumissions, employés au moment où ils sont chargés,
// puis les sert si fetch échoue (perte réseau).
//
// Usage : await fetchAvecOffline("/api/projets") au lieu de fetch directe.

const NOM_DB = "vk-offline";
const VERSION = 1;
const STORES = ["projets", "clients", "soumissions", "categories", "employes"];

let dbPromise: Promise<IDBDatabase> | null = null;

function ouvrir(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB indisponible"));
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NOM_DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Ferme la connexion (purge de déconnexion : `deleteDatabase` reste bloqué tant qu'une
 *  connexion est ouverte). La prochaine lecture rouvrira. */
export function fermerCacheOffline(): void {
  const p = dbPromise;
  dbPromise = null;
  if (p) p.then((db) => { try { db.close(); } catch { /* déjà fermée */ } }).catch(() => {});
}

async function ecrire(store: string, cle: string, valeur: any): Promise<void> {
  try {
    const db = await ouvrir();
    if (!db.objectStoreNames.contains(store)) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put({ t: Date.now(), v: valeur }, cle);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

async function lire(store: string, cle: string): Promise<any | null> {
  try {
    const db = await ouvrir();
    if (!db.objectStoreNames.contains(store)) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(cle);
      req.onsuccess = () => resolve(req.result ? (req.result as any).v : null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

function detecterStore(url: string): { store: string; cle: string } | null {
  if (/^\/api\/projets/.test(url)) return { store: "projets", cle: url };
  if (/^\/api\/clients/.test(url)) return { store: "clients", cle: url };
  if (/^\/api\/soumissions/.test(url)) return { store: "soumissions", cle: url };
  if (/^\/api\/categories-depense/.test(url)) return { store: "categories", cle: url };
  if (/^\/api\/employes/.test(url)) return { store: "employes", cle: url };
  return null;
}

/** fetch + cache offline. Si online → fetch normal et met en cache.
 *  Si offline → essaie le cache. */
export async function fetchAvecOffline(url: string, init?: RequestInit): Promise<any> {
  const cible = detecterStore(url);
  try {
    const r = await fetch(url, init);
    const data = await r.json();
    if (cible && r.ok && (!init || (init.method || "GET").toUpperCase() === "GET")) {
      ecrire(cible.store, cible.cle, data);
    }
    return data;
  } catch (e) {
    if (cible) {
      const cache = await lire(cible.store, cible.cle);
      if (cache) return cache;
    }
    throw e;
  }
}

/** Précharge en arrière-plan toutes les données critiques (à appeler au boot de l'app). */
export async function prechargerCache(): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const cibles = ["/api/projets", "/api/clients", "/api/soumissions", "/api/categories-depense", "/api/employes"];
  for (const url of cibles) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        const c = detecterStore(url);
        if (c) ecrire(c.store, c.cle, data);
      }
    } catch {}
  }
}

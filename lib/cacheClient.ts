// Cache client "instantané" : affiche les dernières données connues tout de suite
// (depuis localStorage), puis va chercher le frais en arrière-plan et met à jour.
// Élimine le spinner d'attente sur cold start / réseau lent (chantier).

export function lireCacheLocal<T>(cle: string): T | null {
  if (typeof window === "undefined") return null;
  try { const v = localStorage.getItem("vk:" + cle); return v ? (JSON.parse(v) as T) : null; }
  catch { return null; }
}

export function ecrireCacheLocal(cle: string, data: any): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem("vk:" + cle, JSON.stringify(data)); }
  catch { /* quota plein / mode privé — on ignore */ }
}

/**
 * Affiche le cache local immédiatement (si présent), puis fetch le frais et met à jour.
 * @param url       endpoint à charger
 * @param appliquer setter d'état (reçoit les données)
 * @param opts.cle  clé de cache (défaut = url) — utiliser une clé stable
 * @param opts.transform  transforme la réponse brute avant application/cache
 */
export async function fetchInstantane<T>(
  url: string,
  appliquer: (d: T) => void,
  opts: { cle?: string; transform?: (raw: any) => T } = {},
): Promise<void> {
  const cle = opts.cle || url;
  const cache = lireCacheLocal<T>(cle);
  if (cache != null) appliquer(cache); // 1) instantané
  try {
    const raw = await fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    const d = opts.transform ? opts.transform(raw) : (raw as T);
    appliquer(d);            // 2) frais
    ecrireCacheLocal(cle, d); // 3) mémorise pour la prochaine ouverture
  } catch { /* réseau KO / 401 → on garde l'affichage du cache */ }
}

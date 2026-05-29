// Cache mémoire client (persiste pendant la navigation SPA) des données projet.
// Au survol/toucher d'une carte projet, on précharge /api/projets/[id]/full ;
// la page détail lit ce cache pour s'afficher instantanément (0 ms perçu).

type Entree = { t: number; data: any };
const cache = new Map<number, Entree>();
const enCours = new Set<number>();
const TTL = 30000; // 30 s

export function prefetchProjet(id: number) {
  if (!id) return;
  const e = cache.get(id);
  if (e && Date.now() - e.t < TTL) return; // déjà frais
  if (enCours.has(id)) return;             // déjà en vol
  enCours.add(id);
  fetch(`/api/projets/${id}/full`, { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => { if (data && !data.error) cache.set(id, { t: Date.now(), data }); })
    .catch(() => {})
    .finally(() => enCours.delete(id));
}

export function getProjetPrefetch(id: number): any | null {
  const e = cache.get(id);
  if (e && Date.now() - e.t < TTL) return e.data;
  return null;
}

export function setProjetPrefetch(id: number, data: any) {
  if (id && data) cache.set(id, { t: Date.now(), data });
}

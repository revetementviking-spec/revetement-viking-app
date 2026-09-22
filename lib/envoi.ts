// Envoi d'écriture avec filet — remplace le motif récurrent
//   const r = await fetch(...); if ((await r.json()).ok) { toast succès; }
// qui, en cas d'échec (400 de validation, 401 session expirée, 500, réseau coupé), ne
// disait RIEN : le geste semblait réussir alors que rien n'était enregistré.

/** `statut` : code HTTP de la réponse (0 si le réseau n'a pas répondu) — utile pour
 *  distinguer un 409 (conflit de version) d'un refus ordinaire. */
export interface ResultatEnvoi<T = any> { ok: boolean; data?: T; erreur?: string; statut?: number }

/** POST/PATCH/DELETE JSON. Ne lève jamais : renvoie toujours { ok, data?, erreur? }.
 *  `entetes` : en-têtes supplémentaires (ex. `X-Idempotence-Cle` sur une création). */
export async function envoyer<T = any>(
  url: string,
  options: { methode?: string; corps?: any; entetes?: Record<string, string> } = {}
): Promise<ResultatEnvoi<T>> {
  const { methode = "POST", corps, entetes } = options;
  try {
    const headers: Record<string, string> = { ...(entetes || {}) };
    if (corps !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(url, {
      method: methode,
      ...(Object.keys(headers).length ? { headers } : {}),
      ...(corps !== undefined ? { body: JSON.stringify(corps) } : {}),
    });
    // Une réponse d'erreur n'est pas toujours du JSON (page 401/413 de la plateforme) :
    // on lit d'abord en texte pour ne jamais lever sur un « Unexpected token ».
    const txt = await r.text();
    let data: any = undefined;
    try { data = txt ? JSON.parse(txt) : undefined; } catch { /* réponse non-JSON */ }
    if (!r.ok) {
      // 413 = la PLATEFORME (Vercel, 4,5 Mo par corps) a refusé avant notre code : le
      // message est du HTML, jamais du JSON. Dire « erreur 413 » n'aide personne.
      const parDefaut = r.status === 401 ? "session expirée — reconnecte-toi"
        : r.status === 413 ? "fichier trop volumineux pour le serveur (max 3 Mo) — compresse le PDF ou réduis la photo"
        : `erreur ${r.status}`;
      return { ok: false, erreur: data?.error || data?.message || parDefaut, statut: r.status, data };
    }
    if (data && data.ok === false) return { ok: false, erreur: data.error || "refusé par le serveur", statut: r.status, data };
    return { ok: true, data, statut: r.status };
  } catch (e: any) {
    return { ok: false, erreur: e?.message === "Failed to fetch" ? "réseau indisponible" : (e?.message || "erreur réseau"), statut: 0 };
  }
}

/**
 * Écriture avec signalement automatique de l'échec.
 *
 * Pour le motif « feu et oublie » : `await fetch(url, { method, body }); charger();`
 * qui, en cas de 401 (session expirée), de 400 (refus de validation) ou de réseau
 * coupé, rafraîchissait l'écran comme si de rien n'était — l'utilisateur voyait sa
 * modification disparaître au rechargement sans jamais savoir pourquoi. Trouvé à
 * 64 endroits d'un coup ; trois avaient déjà été attrapés un par un en direct.
 *
 * Retourne `true` si l'écriture a réussi. Sinon, signale l'erreur (toast, ou alert
 * sans fournisseur) et retourne `false` : l'appelant fait `if (!(await ecrire(…))) return;`
 * et ne rafraîchit ni ne ferme rien sur un échec.
 */
export async function ecrire(url: string, methode: string, corps?: any, contexte?: string, entetes?: Record<string, string>): Promise<boolean> {
  const r = await envoyer(url, { methode, corps, entetes });
  if (r.ok) return true;
  const { signaler } = await import("./toast-bus");
  signaler(`${contexte || "Enregistrement"} refusé : ${r.erreur}`, "error");
  return false;
}

export type ResultatLecture<T = any> =
  | { ok: true; data: T }
  | { ok: false; erreur: string; statut: number };

/**
 * Lecture JSON avec filet — remplace `fetch(url).then((r) => r.json()).then(setX)`.
 *
 * Ce motif, sur un 500, un 401 (session expirée) ou un réseau coupé, laissait l'écran
 * sur « Chargement... » pour toujours, ou faisait planter le rendu sur `undefined.map`
 * (un corps `{ error }` n'est pas un tableau). Ici : `r.ok` vérifié, parse en try/catch,
 * jamais de rejet. `statut` vaut 0 quand le réseau n'a pas répondu.
 *
 * Sur 401, on ne signale rien : Garde401 intercepte la réponse et redirige vers /login.
 * L'appelant garde son état d'erreur le temps de la redirection, sans toast.
 */
export async function lireJson<T = any>(url: string, opts: RequestInit = {}): Promise<ResultatLecture<T>> {
  try {
    const r = await fetch(url, { cache: "no-store", ...opts });
    const txt = await r.text();
    let data: any = undefined;
    try { data = txt ? JSON.parse(txt) : undefined; } catch { /* réponse non-JSON */ }
    if (!r.ok) {
      const parDefaut = r.status === 401 ? "session expirée — reconnecte-toi" : `erreur ${r.status}`;
      return { ok: false, erreur: data?.error || data?.message || parDefaut, statut: r.status };
    }
    if (data && typeof data === "object" && !Array.isArray(data) && data.ok === false) {
      return { ok: false, erreur: data.error || "refusé par le serveur", statut: r.status };
    }
    return { ok: true, data: data as T };
  } catch (e: any) {
    return { ok: false, erreur: e?.message === "Failed to fetch" ? "réseau indisponible" : (e?.message || "erreur réseau"), statut: 0 };
  }
}

/** Variante de `lireJson` pour une liste : garantit un TABLEAU en cas de succès.
 *  Un corps qui n'est pas un tableau (objet d'erreur, `null`) est traité comme un échec,
 *  pour ne jamais tomber sur `.map is not a function`. */
export async function lireListe<T = any>(url: string, opts: RequestInit = {}): Promise<ResultatLecture<T[]>> {
  const r = await lireJson<any>(url, opts);
  if (!r.ok) return r;
  if (!Array.isArray(r.data)) return { ok: false, erreur: "réponse inattendue du serveur", statut: 200 };
  return { ok: true, data: r.data as T[] };
}

// Implémentation unique et testée dans lib/calculs.ts (gère « 5 000,50 $ » : virgule
// décimale, espaces de milliers, symbole). Ré-exportée ici pour les écrans.
export { nombreSaisi } from "@/lib/calculs";

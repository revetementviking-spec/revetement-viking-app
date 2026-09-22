// File d'attente offline minimaliste : si un POST critique (heures / dépenses / extras)
// échoue par perte de réseau, on stocke dans localStorage et on retente au retour.
//
// Idempotence : la clé est générée AVANT le premier essai et envoyée dans l'en-tête
// `X-Idempotence-Cle` à chaque tentative (première et rejouées). Le serveur qui a déjà
// vu la clé renvoie sa réponse d'origine sans recréer la ligne — ainsi une requête
// partie mais dont la réponse s'est perdue (tunnel, toit, ascenseur) ne double rien.

const CLE = "vk-file-offline-v1";
const CLE_ABANDONS = "vk-file-abandons";
const CLE_UTILISATEUR = "vk-utilisateur";
const MAX_ABANDONS = 50;
const EN_TETE_IDEMPOTENCE = "X-Idempotence-Cle";

export interface Action {
  url: string; body: any; method: string; id: string; date: string; essais?: number;
  /** Utilisateur connecté au moment de la mise en file : on ne rejoue JAMAIS pour un autre. */
  utilisateur?: string | null;
}

export interface Abandon extends Action {
  /** Pourquoi la saisie a été abandonnée (« HTTP 400 : date invalide », « utilisateur différent »). */
  raison: string;
  date_abandon: string;
  /** Contenu lisible pour l'utilisateur : « Dépense 125,00 $ du 2026-09-20 ». */
  resume: string;
}

function lireListe<T>(cle: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(cle) || "[]");
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
/** Retourne false si l'écriture a échoué (quota plein, mode privé) : l'appelant NE doit
 *  PAS annoncer « sauvegardé sur l'appareil » quand rien ne l'est. */
function ecrireListe(cle: string, a: unknown[]): boolean {
  try { localStorage.setItem(cle, JSON.stringify(a)); return true; } catch { return false; }
}
function lire(): Action[] { return lireListe<Action>(CLE); }
function ecrire(a: Action[]): boolean { return ecrireListe(CLE, a); }

function nouvelleCle(): string {
  // ≤ 64 caractères, sans dépendre de crypto.randomUUID (absent hors HTTPS sur de vieux Android).
  const alea = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
  return `${Date.now().toString(36)}-${alea}`;
}

// === Utilisateur courant (M7) ===
// Navigation le mémorise quand le profil est chargé ; la purge de déconnexion l'efface.
export function memoriserUtilisateur(nom: string | null | undefined): void {
  try {
    if (nom) localStorage.setItem(CLE_UTILISATEUR, nom);
    else localStorage.removeItem(CLE_UTILISATEUR);
  } catch { /* stockage indisponible */ }
}
export function utilisateurMemorise(): string | null {
  try { return localStorage.getItem(CLE_UTILISATEUR); } catch { return null; }
}

// === Contenu lisible d'une action (pour les toasts et la liste des abandons) ===
const fmtMontant = (n: number) => new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2 }).format(n);
const fmtNombre = (n: number) => new Intl.NumberFormat("fr-CA", { maximumFractionDigits: 2 }).format(n);

/** « Dépense 125,00 $ du 2026-09-20 (Gentek) », « Heures 7,5 h du 2026-09-20 (Gabriel) ». */
export function decrireAction(a: Pick<Action, "url" | "body">): string {
  const b = a.body || {};
  const date = b.date ? ` du ${String(b.date).slice(0, 10)}` : "";
  const projet = b.projet_nom ? ` · ${b.projet_nom}` : "";
  if (/\/api\/depenses/.test(a.url)) {
    const m = Number(b.montant);
    return `Dépense${Number.isFinite(m) ? ` ${fmtMontant(m)}` : ""}${date}${b.fournisseur ? ` (${b.fournisseur})` : ""}${projet}`;
  }
  if (/\/api\/heures/.test(a.url)) {
    const h = Number(b.heures);
    return `Heures${Number.isFinite(h) ? ` ${fmtNombre(h)} h` : ""}${date}${b.employe ? ` (${b.employe})` : ""}${projet}`;
  }
  if (/\/api\/extras/.test(a.url)) {
    const m = Number(b.montant), h = Number(b.heures);
    const val = b.montant != null && b.montant !== "" && Number.isFinite(m) ? ` ${fmtMontant(m)}` : b.heures != null && b.heures !== "" && Number.isFinite(h) ? ` ${fmtNombre(h)} h` : "";
    return `Extra${val}${date}${b.description ? ` : ${String(b.description).slice(0, 40)}` : ""}${projet}`;
  }
  if (/\/api\/photos/.test(a.url)) return `Photo${date}${projet}`;
  return `Saisie ${a.url}${date}`;
}

// === Abandons consultables (C1c) ===
export function listerAbandons(): Abandon[] { return lireListe<Abandon>(CLE_ABANDONS); }
export function retirerAbandon(id: string): void {
  ecrireListe(CLE_ABANDONS, listerAbandons().filter((a) => a.id !== id));
}
export function effacerAbandons(): void { ecrireListe(CLE_ABANDONS, []); }
function abandonner(a: Action, raison: string): Abandon {
  const ab: Abandon = { ...a, raison, date_abandon: new Date().toISOString(), resume: decrireAction(a) };
  const liste = [ab, ...listerAbandons().filter((x) => x.id !== a.id)].slice(0, MAX_ABANDONS);
  ecrireListe(CLE_ABANDONS, liste);
  return ab;
}

/** Codes qui ne passeront JAMAIS en rejouant : validation, introuvable, conflit, trop gros. */
function estRefusDefinitif(status: number): boolean {
  return status === 400 || status === 404 || status === 409 || status === 413 || status === 422;
}

function entetes(cle: string): Record<string, string> {
  return { "Content-Type": "application/json", [EN_TETE_IDEMPOTENCE]: cle };
}

/** Envoie un POST normalement, ou file en cas d'erreur réseau.
 *  `offline: true` veut dire « pas encore enregistré au serveur » — l'appelant DOIT
 *  le dire à l'utilisateur autrement il croit que c'est parti. */
export async function postOuFile(url: string, body: any, method: string = "POST"): Promise<{ ok: boolean; offline?: boolean; data?: any; erreur?: string }> {
  const id = nouvelleCle();
  try {
    const r = await fetch(url, { method, headers: entetes(id), body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false) return { ok: false, data, erreur: data?.error || `HTTP ${r.status}` };
    return { ok: true, data };
  } catch {
    // hors-ligne ou serveur injoignable : on file avec la MÊME clé — si la requête est en
    // fait arrivée au serveur, le rejeu sera reconnu et ne créera rien.
    const f = lire();
    f.push({ url, body, method, id, date: new Date().toISOString(), essais: 0, utilisateur: utilisateurMemorise() });
    if (!ecrire(f)) {
      return { ok: false, erreur: "hors ligne et impossible de garder la saisie sur l'appareil (stockage plein) — réessaie avec du réseau" };
    }
    return { ok: true, offline: true };
  }
}

export function nbActionsEnAttente(): number { return lire().length; }

/** Vide la file locale sans rien envoyer (déconnexion : les saisies d'un utilisateur ne
 *  doivent pas partir sous le compte du suivant). */
export function viderFileSansEnvoyer(): void { ecrire([]); }

/** Retire UNE action de la file telle qu'elle est SUR LE DISQUE à cet instant (d'autres
 *  saisies ont pu s'ajouter pendant l'envoi : on ne réécrit jamais une copie périmée). */
function retirerDeLaFile(id: string, remplacement?: Action): void {
  const courante = lire();
  const i = courante.findIndex((a) => a.id === id);
  if (i < 0) return;
  if (remplacement) courante[i] = remplacement; else courante.splice(i, 1);
  ecrire(courante);
}

export interface BilanVidage { envoyees: number; restantes: number; abandonnees: number; abandons: Abandon[] }

// Verrou : sans lui, deux passages simultanés (événement « online » + minuterie, ou
// plusieurs moniteurs) lisent la MÊME file et postent chaque saisie deux fois.
let videEnCours = false;

/** Tente d'envoyer toutes les actions en file. À appeler au retour réseau. */
export async function viderFile(): Promise<BilanVidage> {
  if (videEnCours) return { envoyees: 0, restantes: nbActionsEnAttente(), abandonnees: 0, abandons: [] };
  const f = lire();
  if (f.length === 0) return { envoyees: 0, restantes: 0, abandonnees: 0, abandons: [] };
  videEnCours = true;
  let envoyees = 0;
  const abandons: Abandon[] = [];
  const utilisateur = utilisateurMemorise();
  try {
    for (const a of f) {
      // Une saisie faite par quelqu'un d'autre sur cet appareil ne part pas sous ce compte.
      if (a.utilisateur && utilisateur && a.utilisateur !== utilisateur) {
        abandons.push(abandonner(a, `saisie de ${a.utilisateur}, connecté : ${utilisateur}`));
        retirerDeLaFile(a.id);
        continue;
      }
      if (a.utilisateur && !utilisateur) continue; // on ne sait pas encore qui est connecté : on attend
      try {
        const r = await fetch(a.url, { method: a.method, headers: entetes(a.id), body: JSON.stringify(a.body) });
        if (r.ok) {
          // Retirée SEULEMENT après le 2xx. Avant, la file était vidée avant la boucle : un
          // onglet fermé pendant l'envoi perdait toutes les saisies suivantes.
          envoyees++;
          retirerDeLaFile(a.id);
          continue;
        }
        if (estRefusDefinitif(r.status)) {
          const d = await r.json().catch(() => ({} as any));
          abandons.push(abandonner(a, `HTTP ${r.status}${d?.error ? ` : ${d.error}` : ""}`));
          retirerDeLaFile(a.id);
          continue;
        }
        // 401 (session expirée), 408/429, 5xx : on garde et on réessaiera — sans jamais
        // abandonner. Avant, dix 401 de suite jetaient la saisie à la poubelle en silence.
        retirerDeLaFile(a.id, { ...a, essais: (a.essais || 0) + 1 });
      } catch {
        // Réseau toujours coupé : on garde, sans limite d'essais.
        retirerDeLaFile(a.id, { ...a, essais: (a.essais || 0) + 1 });
      }
    }
  } finally {
    videEnCours = false;
  }
  return { envoyees, restantes: nbActionsEnAttente(), abandonnees: abandons.length, abandons };
}

// Un seul moniteur par onglet, quoi qu'il arrive. `Navigation` n'est pas dans le layout :
// elle se remonte à CHAQUE navigation, et chaque montage posait un écouteur « online » et
// un setInterval de plus, jamais nettoyés. Au bout de dix pages visitées, dix moniteurs
// se déclenchaient ensemble au retour du réseau.
let moniteurActif = false;

/** Démarre le moniteur réseau. Retourne une fonction d'arrêt (à appeler au démontage). */
export function activerMoniteurOffline(onSync?: (info: BilanVidage) => void): () => void {
  if (typeof window === "undefined") return () => {};
  if (moniteurActif) return () => {};
  moniteurActif = true;

  const tenter = async () => {
    if (!navigator.onLine) return;
    if (nbActionsEnAttente() === 0) return;
    const r = await viderFile();
    if ((r.envoyees > 0 || r.abandonnees > 0) && onSync) onSync(r);
  };
  window.addEventListener("online", tenter);
  const timer = setInterval(tenter, 60000);
  return () => {
    window.removeEventListener("online", tenter);
    clearInterval(timer);
    moniteurActif = false;
  };
}

// Autosave dans localStorage - récupération auto au prochain chargement.
//
// UN brouillon PAR CONTEXTE : `vk-draft:<numero>` quand on modifie une soumission
// existante, `vk-draft:nouvelle` pour le parcours « nouvelle soumission ». Avant, une clé
// unique servait aux deux : ouvrir « nouvelle soumission » proposait de restaurer le
// brouillon d'une soumission existante (avec son numéro), et « Sauvegarder » ÉCRASAIT
// alors cette soumission-là avec ce qu'on croyait être une nouvelle.

const PREFIXE = "vk-draft:";
const CONTEXTE_NOUVELLE = "nouvelle";
/** Ancienne clé unique, gardée en lecture seulement le temps de la migration. */
const CLE_ANCIENNE = "soumission-xpress-draft";

export interface BrouillonAuto {
  timestamp: number;
  numero: string;
  client: any;
  lignes: any[];
  fraisActifs: any[];
  fraisGestion: number;
  appliquerTaxes: boolean;
  hoverExtraction?: any;
}

/** Nom lisible du contexte pour les messages : « la soumission XP-… » ou « nouvelle soumission ». */
export function libelleContexte(numero?: string | null): string {
  const n = (numero || "").trim();
  return n ? `la soumission ${n}` : "nouvelle soumission";
}

/** Clé de stockage : `vk-draft:<numero>` en modification, `vk-draft:nouvelle` en création. */
export function cleBrouillon(numero?: string | null): string {
  const n = (numero || "").trim();
  return PREFIXE + (n || CONTEXTE_NOUVELLE);
}

/** Un brouillon ne se restaure que dans SON contexte : le parcours « nouvelle » n'accepte
 *  JAMAIS un brouillon qui porte un numéro, et une modification n'accepte que le sien. */
export function brouillonAdmissible(draft: Partial<BrouillonAuto> | null | undefined, numero?: string | null): boolean {
  if (!draft || typeof draft !== "object") return false;
  const n = (numero || "").trim();
  const dn = (draft.numero || "").trim();
  return n ? dn === n : dn === "";
}

/** Vrai s'il y a quelque chose à restaurer (au moins une ligne ou un nom de client). */
export function brouillonNonVide(draft: Partial<BrouillonAuto> | null | undefined): boolean {
  return !!draft && ((Array.isArray(draft.lignes) && draft.lignes.length > 0) || !!draft.client?.nom);
}

export function sauvegarderBrouillon(data: Omit<BrouillonAuto, "timestamp">) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(cleBrouillon(data.numero), JSON.stringify({ ...data, timestamp: Date.now() }));
  } catch {}
}

function lireCle(cle: string): BrouillonAuto | null {
  try {
    const raw = localStorage.getItem(cle);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Brouillon du contexte demandé, ou null s'il n'y en a pas (ou s'il n'est pas admissible). */
export function chargerBrouillon(numero?: string | null): BrouillonAuto | null {
  if (typeof window === "undefined") return null;
  let draft = lireCle(cleBrouillon(numero));
  // Migration : l'ancienne clé unique ne vaut que pour le parcours « nouvelle », et
  // seulement si elle ne porte pas de numéro (sinon c'était justement le bogue).
  if (!draft && !(numero || "").trim()) {
    const ancien = lireCle(CLE_ANCIENNE);
    if (ancien && brouillonAdmissible(ancien, null)) draft = ancien;
    try { localStorage.removeItem(CLE_ANCIENNE); } catch {}
  }
  return brouillonAdmissible(draft, numero) ? draft : null;
}

export function effacerBrouillon(numero?: string | null) {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(cleBrouillon(numero));
    if (!(numero || "").trim()) localStorage.removeItem(CLE_ANCIENNE);
  } catch {}
}

// Détection de factures en double — logique PURE (sans DB), testée dans
// lib/doublons-factures.test.ts.
//
// Deux mondes qu'on ne mélange JAMAIS (ce sont des sens opposés de l'argent) :
//  - les factures de FOURNISSEURS, saisies comme dépenses (`depenses_projet`) — payer
//    deux fois la même, c'est de l'argent qui sort pour rien, et un coût de chantier faux ;
//  - les factures CLIENT émises (`factures_projet`) — en émettre deux fois, c'est le client
//    qui reçoit deux comptes, et un « à recevoir » gonflé.
// Une dépense n'est donc jamais comparée à une facture client.
//
// Réglage choisi par Francis (2026-09-21) : PRUDENT. Mieux vaut manquer un doublon tordu
// que crier au loup sur des achats répétitifs — une alerte à laquelle on ne croit plus ne
// sert plus à rien. D'où : montant identique AU CENT, fenêtre de 30 jours, et le numéro de
// facture répété traité à part (doublon franc, quelle que soit la date).

import { dateISOLocale } from "./calculs";

export type FamilleDoublon = "depense" | "facture";

export interface PieceDepense {
  id: number; fournisseur?: string | null; montant: number; date: string;
  projet_id?: number | null; description?: string | null;
}
export interface PieceFacture {
  id: number; numero?: string | null; montant: number; date: string;
  projet_id?: number | null; description?: string | null;
}

/** Une PAIRE suspecte. On raisonne par paires et non par groupes : la clé reste stable
 *  quand une troisième pièce apparaît, donc « ce n'est pas un doublon » le reste. */
export interface PaireSuspecte {
  famille: FamilleDoublon;
  /** Identité stable de la paire, utilisée pour l'ignorer : « depense:12+37 ». */
  cle: string;
  ids: [number, number];
  /** Ce qui rapproche les deux pièces, en français, pour l'écran et le push. */
  raison: string;
  /** « franc » = certitude (même numéro de facture) ; « probable » = même montant, dates proches. */
  certitude: "franc" | "probable";
  libelle: string;
  montant: number;
  dates: [string, string];
  ecart_jours: number;
}

/** Fenêtre de rapprochement, en jours (réglage prudent). */
export const FENETRE_JOURS = 30;

/** Normalise un nom de tiers pour comparer : « PATRICK MORIN  » ≡ « Patrick Morin ».
 *  Volontairement CONSERVATEUR : on retire les accents, la casse, la ponctuation et les
 *  espaces en trop, rien de plus. Retirer « inc. » ou « ltée » rapprocherait deux
 *  entreprises réellement différentes. */
export function normaliserTiers(s?: string | null): string {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Normalise un numéro de facture : « F-2026-017 » ≡ « f2026017 ». Ici on retire TOUT ce
 *  qui n'est pas alphanumérique : les séparateurs varient d'une saisie à l'autre. */
export function normaliserNumero(s?: string | null): string {
  return String(s || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/** Montant au CENT, en entier : évite que 88.10 + 0.20 ≠ 88.30 fasse rater un doublon. */
function cents(montant: number): number {
  return Math.round((Number(montant) || 0) * 100);
}

function ecartJours(a: string, b: string): number {
  const ta = dateISOLocale(String(a).slice(0, 10)).getTime();
  const tb = dateISOLocale(String(b).slice(0, 10)).getTime();
  if (!isFinite(ta) || !isFinite(tb)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((ta - tb) / 86400000));
}

/** Clé stable d'une paire : les ids sont TRIÉS, donc l'ordre de lecture ne la change pas. */
export function clePaire(famille: FamilleDoublon, a: number, b: number): string {
  const [x, y] = a <= b ? [a, b] : [b, a];
  return `${famille}:${x}+${y}`;
}

const jourLisible = (iso: string) =>
  dateISOLocale(String(iso).slice(0, 10)).toLocaleDateString("fr-CA", { day: "numeric", month: "short", year: "numeric" });

const argent = (m: number) =>
  (Number(m) || 0).toLocaleString("fr-CA", { style: "currency", currency: "CAD" });

/** Regroupe par clé, puis ne compare QUE dans le même seau : sans ça, 5 000 dépenses
 *  feraient 12,5 millions de comparaisons à chaque ouverture de l'écran. */
function parSeau<T>(pieces: T[], cle: (p: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const p of pieces) {
    const k = cle(p);
    if (k === null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(p);
  }
  return m;
}

/** Factures de FOURNISSEURS (dépenses) : même fournisseur + même montant + ≤ 30 jours.
 *  Les montants nuls ou négatifs sont écartés — une note de crédit de −100 $ et un
 *  remboursement de −100 $ sont deux gestes légitimes, pas un doublon. */
export function detecterDoublonsDepenses(pieces: PieceDepense[], fenetreJours = FENETRE_JOURS): PaireSuspecte[] {
  const out: PaireSuspecte[] = [];
  const seaux = parSeau(pieces, (d) => {
    const f = normaliserTiers(d.fournisseur);
    // Sans fournisseur, « même montant » ne veut rien dire : deux achats de 20 $ chez
    // deux places différentes se ressembleraient. On ne devine pas.
    if (!f) return null;
    if (cents(d.montant) <= 0) return null;
    return `${f}|${cents(d.montant)}`;
  });
  for (const [, liste] of seaux) {
    if (liste.length < 2) continue;
    const tri = [...liste].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (let i = 0; i < tri.length; i++) {
      for (let j = i + 1; j < tri.length; j++) {
        const e = ecartJours(tri[i].date, tri[j].date);
        if (e > fenetreJours) break; // trié par date : les suivantes sont encore plus loin
        out.push({
          famille: "depense",
          cle: clePaire("depense", tri[i].id, tri[j].id),
          ids: [tri[i].id, tri[j].id],
          certitude: "probable",
          libelle: String(tri[i].fournisseur || "").trim() || "Fournisseur inconnu",
          montant: tri[i].montant,
          dates: [String(tri[i].date).slice(0, 10), String(tri[j].date).slice(0, 10)],
          ecart_jours: e,
          raison:
            e === 0
              ? `Même fournisseur, même montant (${argent(tri[i].montant)}), même date (${jourLisible(tri[i].date)}).`
              : `Même fournisseur et même montant (${argent(tri[i].montant)}), à ${e} jour${e > 1 ? "s" : ""} d'écart (${jourLisible(tri[i].date)} et ${jourLisible(tri[j].date)}).`,
        });
      }
    }
  }
  return out;
}

/** Factures CLIENT : deux signaux.
 *  1. Même NUMÉRO — doublon franc, peu importe la date : un numéro de facture est unique.
 *  2. Même projet + même montant + ≤ 30 jours — probable.
 *  Une paire trouvée par le numéro n'est pas répétée par le second signal. */
export function detecterDoublonsFacturesClient(pieces: PieceFacture[], fenetreJours = FENETRE_JOURS): PaireSuspecte[] {
  const out: PaireSuspecte[] = [];
  const dejaVue = new Set<string>();

  const parNumero = parSeau(pieces, (f) => {
    const n = normaliserNumero(f.numero);
    return n ? `n|${n}` : null;
  });
  for (const [, liste] of parNumero) {
    if (liste.length < 2) continue;
    const tri = [...liste].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (let i = 0; i < tri.length; i++) {
      for (let j = i + 1; j < tri.length; j++) {
        const cle = clePaire("facture", tri[i].id, tri[j].id);
        dejaVue.add(cle);
        out.push({
          famille: "facture",
          cle,
          ids: [tri[i].id, tri[j].id],
          certitude: "franc",
          libelle: String(tri[i].numero || "").trim(),
          montant: tri[i].montant,
          dates: [String(tri[i].date).slice(0, 10), String(tri[j].date).slice(0, 10)],
          ecart_jours: ecartJours(tri[i].date, tri[j].date),
          raison: `Deux factures portent le même numéro « ${String(tri[i].numero || "").trim()} » (${argent(tri[i].montant)} et ${argent(tri[j].montant)}).`,
        });
      }
    }
  }

  const parProjetMontant = parSeau(pieces, (f) => {
    if (f.projet_id === null || f.projet_id === undefined) return null;
    if (cents(f.montant) <= 0) return null;
    return `p|${f.projet_id}|${cents(f.montant)}`;
  });
  for (const [, liste] of parProjetMontant) {
    if (liste.length < 2) continue;
    const tri = [...liste].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (let i = 0; i < tri.length; i++) {
      for (let j = i + 1; j < tri.length; j++) {
        const e = ecartJours(tri[i].date, tri[j].date);
        if (e > fenetreJours) break;
        const cle = clePaire("facture", tri[i].id, tri[j].id);
        if (dejaVue.has(cle)) continue; // déjà signalée par le numéro : ne pas la dire deux fois
        dejaVue.add(cle);
        out.push({
          famille: "facture",
          cle,
          ids: [tri[i].id, tri[j].id],
          certitude: "probable",
          libelle: String(tri[i].numero || "").trim() || `Facture #${tri[i].id}`,
          montant: tri[i].montant,
          dates: [String(tri[i].date).slice(0, 10), String(tri[j].date).slice(0, 10)],
          ecart_jours: e,
          raison:
            e === 0
              ? `Même chantier, même montant (${argent(tri[i].montant)}), même date (${jourLisible(tri[i].date)}).`
              : `Même chantier et même montant (${argent(tri[i].montant)}), à ${e} jour${e > 1 ? "s" : ""} d'écart (${jourLisible(tri[i].date)} et ${jourLisible(tri[j].date)}).`,
        });
      }
    }
  }
  return out;
}

/** Toutes les paires suspectes, moins celles marquées « ce n'est pas un doublon ».
 *  Les francs d'abord, puis les plus récentes : ce qui est certain se règle en premier. */
export function detecterDoublons(
  data: { depenses?: PieceDepense[]; factures?: PieceFacture[] },
  ignorees: Iterable<string> = [],
  fenetreJours = FENETRE_JOURS
): PaireSuspecte[] {
  const exclues = new Set(ignorees);
  const toutes = [
    ...detecterDoublonsDepenses(data.depenses || [], fenetreJours),
    ...detecterDoublonsFacturesClient(data.factures || [], fenetreJours),
  ].filter((p) => !exclues.has(p.cle));
  return toutes.sort((a, b) => {
    if (a.certitude !== b.certitude) return a.certitude === "franc" ? -1 : 1;
    return (b.dates[1] || "").localeCompare(a.dates[1] || "");
  });
}

/** Ce qu'une pièce NOUVELLE heurte, au moment de la saisie. `nouvelle` doit être présente
 *  dans `existantes` (ou pas) : on ne compare jamais une pièce à elle-même, via son id. */
export function doublonsDeLaPiece(
  famille: FamilleDoublon,
  nouvelleId: number,
  data: { depenses?: PieceDepense[]; factures?: PieceFacture[] },
  ignorees: Iterable<string> = [],
  fenetreJours = FENETRE_JOURS
): PaireSuspecte[] {
  return detecterDoublons(data, ignorees, fenetreJours).filter(
    (p) => p.famille === famille && p.ids.includes(nouvelleId)
  );
}

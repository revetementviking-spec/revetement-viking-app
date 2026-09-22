// Indemnité de jour férié — logique PURE (sans DB), testée dans lib/paie-feries.test.ts.
//
// Règle CNESST (LNT art. 62) : l'indemnité d'un jour férié vaut 1/20 du salaire gagné au
// cours des 4 SEMAINES COMPLÈTES de paie qui précèdent la SEMAINE du congé, heures
// supplémentaires exclues. En heures, « heures sup exclues » = chaque semaine de référence
// plafonnée à 40 h ; un temps plein tombe donc pile sur 8 h.
//
// Décisions de Francis (2026-09-21), pour Revêtement Viking :
//  - 8 jours payés (ceux de la LNT) : PAS le 2 janvier, PAS le Vendredi saint, PAS le
//    26 décembre — même liste que l'autre app. `lib/calendrier-quebec.ts` garde ses 11 jours
//    (l'échéancier des projets en dépend) ; la paie les filtre ici, elle ne les modifie pas.
//  - Le vrai calcul du 1/20, jamais un forfait de 8 h.
//  - L'indemnité COMPTE dans le seuil de 80 h de la quinzaine (LNT art. 53) : une quinzaine
//    de 80 h punchées + 8 h de férié se paie 80 h et met 8 h à la banque. C'est voulu.
//  - S'applique à partir du 12 octobre 2026 (Action de grâce). Les quinzaines antérieures
//    ont été payées sans indemnité et ne sont PAS recalculées.
//
// Ce module ne connaît ni la DB ni les montants : il rend des HEURES. Le taux, le brut et
// la banque restent l'affaire de listerPaiePeriodes (lib/db.ts).

import { joursFeriesQC } from "./calendrier-quebec";
import { dateISOLocale } from "./calculs";

export interface FeriePaye { date: string; nom: string; }
/** Un férié payé tombant dans une période de paie, avec l'indemnité qu'il vaut. */
export interface FeriePeriode extends FeriePaye { heures: number; }

/** Premier férié payé par Viking — Action de grâce 2026. Rien avant n'est recalculé. */
export const FERIES_PAYES_DEPUIS = "2026-10-12";

/** Nombre de semaines complètes servant de référence (CNESST). */
export const SEMAINES_REFERENCE = 4;
/** Plafond par semaine de référence : au-delà, c'est du temps supplémentaire, exclu. */
export const PLAFOND_HEURES_SEMAINE = 40;
/** Diviseur de la règle : 1/20. */
export const DIVISEUR_INDEMNITE = 20;

// Les 3 jours du calendrier CCQ que Viking ne paie PAS. On filtre par NOM et non par date :
// joursFeriesQC() calcule Pâques et les lundis mobiles, on ne redéveloppe pas ça ici.
const NON_PAYES = new Set(["Lendemain du Jour de l'An", "Vendredi saint", "Lendemain de Noël"]);
// Ces deux-là sont reportés au lundi quand ils tombent un dimanche (personne ne travaille le
// dimanche sur les chantiers : sans report, le congé serait perdu).
const REPORTABLES = new Set(["Fête nationale", "Fête du Canada"]);

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Ajoute n jours à une date ISO (minuit local — jamais UTC, sinon le jour glisse). */
function plusJours(iso: string, n: number): string {
  const d = dateISOLocale(iso);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Lundi de la semaine contenant `iso`. Les quinzaines de paie vont lundi → dimanche
 *  (ANCRE_PAIE), donc la « semaine » de la règle CNESST est lundi → dimanche elle aussi. */
export function lundiDeLaSemaine(iso: string): string {
  const d = dateISOLocale(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // dim=0 → recule de 6
  return ymd(d);
}

/** Les 8 jours fériés payés par Viking pour une année, report du dimanche inclus. */
export function feriesPayesQC(annee: number): FeriePaye[] {
  return joursFeriesQC(annee)
    .filter((f) => !NON_PAYES.has(f.nom))
    .map((f) => {
      if (REPORTABLES.has(f.nom) && dateISOLocale(f.date).getDay() === 0) {
        return { date: plusJours(f.date, 1), nom: `${f.nom} (reporté au lundi)` };
      }
      return { date: f.date, nom: f.nom };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Fériés payés tombant dans [debut, fin] — bornes incluses, et jamais avant
 *  FERIES_PAYES_DEPUIS. `depuis` n'est paramétrable que pour les tests. */
export function feriesPayesEntre(debutISO: string, finISO: string, depuis = FERIES_PAYES_DEPUIS): FeriePaye[] {
  if (!debutISO || !finISO || finISO < debutISO) return [];
  const out: FeriePaye[] = [];
  const a1 = Number(debutISO.slice(0, 4));
  const a2 = Number(finISO.slice(0, 4));
  for (let a = a1; a <= a2; a++) {
    for (const f of feriesPayesQC(a)) {
      if (f.date >= debutISO && f.date <= finISO && f.date >= depuis) out.push(f);
    }
  }
  return out;
}

/** Fenêtre de référence d'un férié : les 4 semaines COMPLÈTES (lundi → dimanche) qui
 *  précèdent la semaine du congé. La semaine du férié elle-même en est exclue. */
export function fenetreReference(ferieISO: string): { debut: string; fin: string } {
  const lundiSemaineFerie = lundiDeLaSemaine(ferieISO);
  return {
    debut: plusJours(lundiSemaineFerie, -7 * SEMAINES_REFERENCE),
    fin: plusJours(lundiSemaineFerie, -1), // dimanche qui précède
  };
}

/** Base de calcul, en heures : heures travaillées des 4 semaines de référence, chaque
 *  semaine plafonnée à 40 h (= « heures supplémentaires exclues »).
 *  Les heures reçues doivent être les heures PUNCHÉES de l'employé — jamais une indemnité
 *  de férié ni une sortie de banque, sinon un congé nourrirait le congé suivant. */
export function baseReferenceFerie(
  heures: { date: string; heures: number }[],
  ferieISO: string
): { base: number; debut: string; fin: string; parSemaine: number[] } {
  const { debut, fin } = fenetreReference(ferieISO);
  const parSemaine = new Array(SEMAINES_REFERENCE).fill(0) as number[];
  for (const h of heures) {
    const jour = String(h.date || "").slice(0, 10);
    if (!jour || jour < debut || jour > fin) continue;
    const idx = Math.floor((dateISOLocale(jour).getTime() - dateISOLocale(debut).getTime()) / (7 * 86400000));
    if (idx >= 0 && idx < SEMAINES_REFERENCE) parSemaine[idx] += h.heures || 0;
  }
  const base = parSemaine.reduce((s, h) => s + Math.min(h, PLAFOND_HEURES_SEMAINE), 0);
  return { base, debut, fin, parSemaine };
}

/** Indemnité d'UN férié, en heures : base / 20, arrondie au centième.
 *  Zéro heure travaillée dans les 4 semaines = zéro indemnité (aucun droit acquis). */
export function indemniteFerie(heures: { date: string; heures: number }[], ferieISO: string): number {
  const { base } = baseReferenceFerie(heures, ferieISO);
  return Math.round((base / DIVISEUR_INDEMNITE) * 100) / 100;
}

/** Fériés payés d'une période de paie et leur indemnité totale, en heures.
 *  `heures` = TOUTES les heures punchées de l'employé (la référence est ANTÉRIEURE à la
 *  période : lui passer les seules heures de la quinzaine donnerait toujours 0). */
export function feriesDeLaPeriode(
  heures: { date: string; heures: number }[],
  debutISO: string,
  finISO: string,
  depuis = FERIES_PAYES_DEPUIS
): { heures: number; detail: FeriePeriode[] } {
  const detail: FeriePeriode[] = [];
  for (const f of feriesPayesEntre(debutISO, finISO, depuis)) {
    const h = indemniteFerie(heures, f.date);
    if (h > 0) detail.push({ ...f, heures: h });
  }
  const total = Math.round(detail.reduce((s, f) => s + f.heures, 0) * 100) / 100;
  return { heures: total, detail };
}

/** Répartition d'une quinzaine quand une indemnité de férié s'y ajoute.
 *
 *  Décision de Francis (2026-09-21) : l'indemnité COMPTE dans le seuil de la période
 *  (LNT art. 53). Son exemple : 40 h travaillées + une indemnité, sur une semaine à 40 h,
 *  paient 40 h et mettent le reste à la banque. Chez Viking le seuil est la QUINZAINE à
 *  80 h — donc 80 h punchées + 8 h de férié = 80 h payées et 8 h reportées à la banque,
 *  et 70 h punchées + 8 h de férié = 78 h payées, rien en banque.
 *
 *  L'employé ne perd rien : ce qui dépasse est reporté, pas effacé. C'est le régime maison
 *  (aucune majoration, 1 h pour 1 h — voir la carte « Banque d'heures »). */
export function repartitionFerie(
  travaillees: number,
  heuresFerie: number,
  seuil: number
): { creditees: number; payeesDoffice: number; versBanque: number } {
  const creditees = Math.round(((travaillees || 0) + (heuresFerie || 0)) * 100) / 100;
  return {
    creditees,
    payeesDoffice: Math.min(creditees, seuil),
    versBanque: Math.max(0, Math.round((creditees - seuil) * 100) / 100),
  };
}

/** Résumé lisible pour le talon et l'écran : « Action de grâce (12 oct.) — 8,00 h ».
 *  Les heures s'écrivent avec la VIRGULE décimale : ce texte est remis à l'employé. */
export function resumeFeries(detail: FeriePeriode[]): string {
  const nf = new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return detail
    .map((f) => {
      const d = dateISOLocale(f.date);
      const jour = d.toLocaleDateString("fr-CA", { day: "numeric", month: "short" });
      return `${f.nom} (${jour}) — ${nf.format(f.heures)} h`;
    })
    .join(" · ");
}

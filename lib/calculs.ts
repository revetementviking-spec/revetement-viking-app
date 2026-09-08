import { aujourdhuiMontreal } from "./date";
// Logique métier PURE (sans DB) — testable unitairement.
// C'est le cœur business : paie (heures sup ×1.5, DAS), marges, périodes.
// Toute modification ici est couverte par lib/calculs.test.ts.

export const TAUX_SUP = 1.5;        // heures supplémentaires ×1.5
export const SEUIL_SUP_PERIODE = 80; // au-delà de 80h sur la quinzaine = supplémentaire
export const DAS_DEFAUT = 0.15;     // déductions à la source 15%

// Taxes Québec : TPS 5 % + TVQ 9,975 % = 14,975 %. Les montants de contrat sont
// gérés TAXES INCLUSES (affichage/facturation), mais la RENTABILITÉ (marge, profit)
// se calcule sur le revenu AVANT taxes — les taxes perçues ne sont pas un revenu.
export const TAUX_TAXES_QC = 0.05 + 0.09975;
/** Convertit un montant taxes incluses en montant avant taxes. */
export function revenuAvantTaxes(montantTaxesIncluses: number): number {
  return (montantTaxesIncluses || 0) / (1 + TAUX_TAXES_QC);
}

/** Dépenses « avant taxes » : on retire les taxes de la part taxable seulement.
 *  Les factures détaxées (sans TPS/TVQ) sont comptées telles quelles. */
export function depensesAvantTaxes(total: number, detaxe: number = 0): number {
  const t = total || 0;
  const d = detaxe || 0;
  let taxable = t - d;
  // `Math.max(0, …)` couvrait bien l'anomalie « plus de détaxé que de total », mais il
  // écrasait aussi les NOTES DE CRÉDIT. /api/depenses accepte volontairement un montant
  // négatif (remboursement fournisseur) ; il comptait dans le total taxes incluses mais
  // ressortait à 0 avant taxes — donc le remboursement ne réduisait JAMAIS les coûts
  // dans la marge, la rentabilité et /finances. On ne borne que le cas anormal, sur une
  // dépense positive ; le signe d'un crédit est conservé.
  if (t >= 0 && taxable < 0) taxable = 0;
  return revenuAvantTaxes(taxable) + d;
}

/** Avance une date ISO (yyyy-mm-dd) selon la récurrence, en heure locale. */
export function avancerDateRecurrence(iso: string | null, rec: string): string {
  const base = iso ? iso.slice(0, 10) : aujourdhuiMontreal();
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (rec === "quotidien") dt.setDate(dt.getDate() + 1);
  else if (rec === "hebdo") dt.setDate(dt.getDate() + 7);
  else if (rec === "2sem") dt.setDate(dt.getDate() + 14);
  else if (rec === "mensuel") {
    // Fin de mois : setMonth() seul déborde (31 janv + 1 mois = 3 MARS, février
    // sauté !). On borne au dernier jour du mois cible : 31 janv → 28/29 fév,
    // 31 mars → 30 avril, 15 déc → 15 janv.
    const jour = dt.getDate();
    dt.setDate(1);
    dt.setMonth(dt.getMonth() + 1);
    dt.setDate(Math.min(jour, new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate()));
  }
  else return base;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/** Marge d'un projet. `revenu` = prix contrat/budget + extras facturés (taxes incluses,
 *  pour l'affichage). La marge et le % sont calculés sur le revenu AVANT taxes (rentabilité réelle). */
export function calculerMargeProjet(input: {
  prix_contrat?: number | null; budget_estime?: number | null;
  cout_main_oeuvre?: number | null; total_depenses?: number | null;
  extras_factures?: number | null;
}) {
  // Le contrat (ou budget) + les extras FACTURÉS au client = revenu reconnu.
  const revenu = (input.prix_contrat || input.budget_estime || 0) + (input.extras_factures || 0); // taxes incluses
  const revenu_avant_taxes = revenuAvantTaxes(revenu);                  // base de rentabilité
  const cout_total = (input.cout_main_oeuvre || 0) + (input.total_depenses || 0);
  const marge = revenu_avant_taxes - cout_total;                       // profit AVANT taxes
  const marge_pct = revenu_avant_taxes ? (marge / revenu_avant_taxes) * 100 : 0;
  // Les deux côtés du ratio DOIVENT être dans la même base. `cout_total` est hors taxes
  // (la main-d'œuvre n'est pas taxée et les dépenses sont converties avant l'appel), donc on
  // le compare au revenu HORS TAXES. Avec le revenu taxes incluses, le ratio était minoré
  // d'environ 13 % : un projet à 100 % de son budget s'affichait à ~87 %, sous le seuil
  // d'alerte de 90 % — le dépassement était signalé trop tard.
  const pct_budget_consomme = revenu_avant_taxes ? Math.min(100, (cout_total / revenu_avant_taxes) * 100) : 0;
  return { revenu, revenu_avant_taxes, cout_total, marge, marge_pct, pct_budget_consomme };
}

/** Parse 'YYYY-MM-DD' comme MINUIT LOCAL (évite le décalage UTC qui change le jour). */
export function dateISOLocale(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// Ancrage des périodes de paie : LUNDI 18 mai 2026 (choisi par Gabriel).
// Les quinzaines vont donc lundi → dimanche 2 semaines plus tard
// (ex : 2026-05-18 → 2026-05-31, puis 2026-06-01 → 2026-06-14...).
export const ANCRE_PAIE = "2026-05-18";

/** Période bi-hebdo (14 jours) contenant une date, ancrée sur ANCRE_PAIE (lundi). */
export function periodeBiHebdo(dateStr: string, ancreISO = ANCRE_PAIE): { debut: string; fin: string } {
  const ancre = dateISOLocale(ancreISO);
  const d = dateISOLocale(dateStr);
  const diffJours = Math.floor((d.getTime() - ancre.getTime()) / 86400000);
  const numeroPeriode = Math.floor(diffJours / 14);
  const debut = new Date(ancre);
  debut.setDate(ancre.getDate() + numeroPeriode * 14);
  const fin = new Date(debut);
  fin.setDate(debut.getDate() + 13);
  const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { debut: fmt(debut), fin: fmt(fin) };
}

/** Heures supplémentaires = au-delà de 80h sur la QUINZAINE complète
 *  (et non 40h/semaine). debutISO conservé pour compat de signature. */
export function calculerHeuresPaye(heures: { date: string; heures: number }[], _debutISO: string): { normales: number; sup: number } {
  const total = heures.reduce((s, e) => s + (e.heures || 0), 0);
  const normales = Math.min(SEUIL_SUP_PERIODE, total);
  const sup = Math.max(0, total - SEUIL_SUP_PERIODE);
  return { normales, sup };
}

/** Heures d'une période DÉJÀ VERSÉE qui ne sont dans aucune paye : de l'argent dû.
 *  Seul l'écart SOUS le seuil compte — une feuille de temps saisie après le versement,
 *  qui n'a donc jamais atteint la paie.
 *  Le surplus au-delà du seuil n'est PAS dû : le régime maison l'accumule dans la banque
 *  d'heures (1 h pour 1 h), payable plus tard sur une quinzaine sous 80 h. Le compter ici
 *  affichait les mêmes heures deux fois — au crédit de l'employé dans la carte « Banque »,
 *  et comme dette envers lui dans le bandeau juste en dessous (30,5 h ainsi réclamées à
 *  tort en juin 2026 pour Gabriel et Maxime, cinq quinzaines à 80 h payées pile). */
export function heuresDuesPeriodePayee(travaillees: number, payees: number): number {
  const sousSeuil = Math.min(travaillees || 0, SEUIL_SUP_PERIODE);
  return Math.max(0, Math.round((sousSeuil - (payees || 0)) * 100) / 100);
}

/** Montant brut/DAS/net d'une paie. */
export function calculerPaye(normales: number, sup: number, taux: number, dasPct = DAS_DEFAUT) {
  const brut = normales * taux + sup * taux * TAUX_SUP;
  const das = brut * dasPct;
  const net = brut - das;
  return { brut, das, net };
}

/** Index 0-6 du jour (Lun=0 … Dim=6) pour une date ISO, en local. */
export function indexJourSemaine(iso: string): number {
  return (dateISOLocale(iso).getDay() + 6) % 7;
}

/** Convertit un montant/nombre SAISI À LA MAIN en nombre.
 *
 *  Au Québec on écrit « 5 000,50 $ » : virgule décimale, espace pour les milliers (souvent
 *  une espace insécable) et parfois le symbole. Les anciens parsers faisaient seulement
 *  `.replace(",", ".")`, donc `Number("5 000.50")` valait NaN et la saisie était refusée
 *  sans que rien ne l'explique — alors que le champ proposait « 5 000,00 » en exemple.
 *
 *  Renvoie NaN si la chaîne n'est pas un nombre, pour que l'appelant puisse refuser. */
export function nombreSaisi(v: any): number {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim();
  if (!s) return NaN;
  // Retire le symbole monétaire et TOUTES les espaces (normale, insécable, fine insécable)
  s = s.replace(/[$\s\u00A0\u202F\u2009]/g, "");
  const virgule = s.lastIndexOf(",");
  const point = s.lastIndexOf(".");
  if (virgule >= 0 && point >= 0) {
    // Les deux présents : le DERNIER est le séparateur décimal, l'autre marque les milliers.
    if (virgule > point) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (virgule >= 0) {
    // Une seule virgule = décimale ; plusieurs = séparateurs de milliers.
    s = s.split(",").length === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  return Number(s);
}

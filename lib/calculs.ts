import { aujourdhuiMontreal } from "./date";
// Logique métier PURE (sans DB) — testable unitairement.
// C'est le cœur business : paie (régime banque d'heures, DAS), marges, périodes.
// Toute modification ici est couverte par lib/calculs.test.ts.

// Régime de paie de Viking (décision de Francis) : AUCUNE majoration ×1,5. Au-delà de
// 80 h par quinzaine, le surplus part en banque d'heures, 1 h pour 1 h, et sert à
// compléter une quinzaine sous 80 h plus tard. La paie est versée au BRUT.
export const SEUIL_SUP_PERIODE = 80; // au-delà de 80h sur la quinzaine = banque d'heures
export const DAS_DEFAUT = 0.15;     // déductions à la source 15% (défaut de la fiche employé)

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

/** Une entrée d'heures telle que lue dans heures_projet, avec SON taux. */
export interface EntreeHeureQuinzaine { date?: string; heures: number; taux: number }

export interface GainParTaux { taux: number; heures: number; montant: number }

export interface PaieQuinzaine {
  /** Heures réellement travaillées dans la quinzaine. */
  travaillees: number;
  /** Taux moyen pondéré par les heures (= le taux unique dans le cas normal). */
  taux: number;
  /** Heures payées d'office (plafonnées au seuil). */
  base: number;
  /** Surplus au-delà du seuil : va en banque, 1 h pour 1 h. */
  surplus: number;
  /** Banque disponible AVANT cette quinzaine. */
  banque_dispo: number;
  /** Heures effectivement tirées de la banque pour combler la quinzaine. */
  banque_appliquee: number;
  /** Solde de banque APRÈS cette quinzaine. */
  banque_solde: number;
  /** Heures payées = base + banque appliquée. */
  payees: number;
  brut: number;
  das: number;
  net: number;
  /** Ventilation du brut par taux horaire (une seule entrée dans le cas normal).
   *  La somme des montants = brut. */
  gains_par_taux: GainParTaux[];
}

/**
 * Paie d'UNE quinzaine selon le régime maison — fonction pure, sans base.
 *
 * - Pas de prime ×1,5 : les heures au-delà du seuil (80 h) sont ACCUMULÉES en banque.
 * - `banqueAppliqueeDemandee` est un CHOIX de l'utilisateur (jamais automatique) : on
 *   le plafonne au manque (seuil − travaillées) et à la banque disponible. Sur une
 *   période déjà payée, on garde ce qui a été appliqué (borné à la dispo) : les montants
 *   versés ne bougent plus.
 * - Le taux est le taux MOYEN PONDÉRÉ par les heures : un employé peut avoir des taux
 *   différents dans la même quinzaine (augmentation en cours de période, ou taux distinct
 *   selon le chantier). 40 h à 50 $ + 40 h à 60 $ = 40×50 + 40×60, pas 80×60.
 * - La DAS vient de la fiche de l'employé (`dasPct`), défaut 15 %.
 */
export function calculerPaieQuinzaine(
  heures: EntreeHeureQuinzaine[],
  opts: { banqueAvant?: number; banqueAppliqueeDemandee?: number; paye?: boolean; dasPct?: number; seuil?: number } = {},
): PaieQuinzaine {
  const SEUIL = opts.seuil ?? SEUIL_SUP_PERIODE;
  const dasPct = Number.isFinite(Number(opts.dasPct)) && opts.dasPct != null ? Number(opts.dasPct) : DAS_DEFAUT;
  const travaillees = heures.reduce((s, e) => s + (e.heures || 0), 0);
  const montantHeures = heures.reduce((s, e) => s + (e.heures || 0) * (e.taux || 0), 0);
  const taux = travaillees > 0 ? montantHeures / travaillees : 0;
  const base = Math.min(travaillees, SEUIL);
  const surplus = Math.max(0, travaillees - SEUIL);
  const dispoAvant = opts.banqueAvant || 0;
  const demandee = opts.banqueAppliqueeDemandee || 0;

  let appliquee = 0;
  if (opts.paye) appliquee = Math.min(demandee, dispoAvant);
  else if (travaillees < SEUIL) appliquee = Math.min(demandee, SEUIL - travaillees, dispoAvant);

  const payees = base + appliquee;
  const banque = dispoAvant + surplus - appliquee;
  const brut = payees * taux;
  const das = brut * dasPct;
  const net = brut - das;

  // Ventilation par taux : chaque taux reçoit sa part d'heures, à l'échelle des heures
  // payées (payées / travaillées). Somme des montants = payées × taux moyen = brut.
  const facteur = travaillees > 0 ? payees / travaillees : 0;
  const parTaux = new Map<number, number>();
  for (const e of heures) {
    const t = e.taux || 0;
    parTaux.set(t, (parTaux.get(t) || 0) + (e.heures || 0));
  }
  const gains_par_taux: GainParTaux[] = Array.from(parTaux.entries())
    .filter(([, h]) => h > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([t, h]) => ({ taux: t, heures: h * facteur, montant: h * facteur * t }));

  return { travaillees, taux, base, surplus, banque_dispo: dispoAvant, banque_appliquee: appliquee, banque_solde: banque, payees, brut, das, net, gains_par_taux };
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

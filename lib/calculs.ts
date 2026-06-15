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

/** Marge d'un projet. `revenu` = prix contrat/budget (taxes incluses, pour l'affichage).
 *  La marge et le % sont calculés sur le revenu AVANT taxes (rentabilité réelle). */
export function calculerMargeProjet(input: {
  prix_contrat?: number | null; budget_estime?: number | null;
  cout_main_oeuvre?: number | null; total_depenses?: number | null;
}) {
  const revenu = input.prix_contrat || input.budget_estime || 0;        // taxes incluses
  const revenu_avant_taxes = revenuAvantTaxes(revenu);                  // base de rentabilité
  const cout_total = (input.cout_main_oeuvre || 0) + (input.total_depenses || 0);
  const marge = revenu_avant_taxes - cout_total;                       // profit AVANT taxes
  const marge_pct = revenu_avant_taxes ? (marge / revenu_avant_taxes) * 100 : 0;
  const pct_budget_consomme = revenu ? Math.min(100, (cout_total / revenu) * 100) : 0;
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

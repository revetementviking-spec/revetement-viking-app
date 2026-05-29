// Logique métier PURE (sans DB) — testable unitairement.
// C'est le cœur business : paie (heures sup ×1.5, DAS), marges, périodes.
// Toute modification ici est couverte par lib/calculs.test.ts.

export const TAUX_SUP = 1.5;       // heures supplémentaires ×1.5
export const SEUIL_SUP_SEMAINE = 40; // au-delà de 40h/semaine = supplémentaire
export const DAS_DEFAUT = 0.15;    // déductions à la source 15%

/** Marge d'un projet : revenu (prix contrat ou budget) − coûts (MO + dépenses). */
export function calculerMargeProjet(input: {
  prix_contrat?: number | null; budget_estime?: number | null;
  cout_main_oeuvre?: number | null; total_depenses?: number | null;
}) {
  const revenu = input.prix_contrat || input.budget_estime || 0;
  const cout_total = (input.cout_main_oeuvre || 0) + (input.total_depenses || 0);
  const marge = revenu - cout_total;
  const marge_pct = revenu ? (marge / revenu) * 100 : 0;
  const pct_budget_consomme = revenu ? Math.min(100, (cout_total / revenu) * 100) : 0;
  return { revenu, cout_total, marge, marge_pct, pct_budget_consomme };
}

/** Parse 'YYYY-MM-DD' comme MINUIT LOCAL (évite le décalage UTC qui change le jour). */
export function dateISOLocale(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Période bi-hebdo (14 jours) contenant une date, ancrée sur 2026-01-04 (dimanche). */
export function periodeBiHebdo(dateStr: string, ancreISO = "2026-01-04"): { debut: string; fin: string } {
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

/** Sépare heures normales / supplémentaires sur une période bi-hebdo (2 × seuil 40h). */
export function calculerHeuresPaye(heures: { date: string; heures: number }[], debutISO: string): { normales: number; sup: number } {
  const debut = dateISOLocale(debutISO);
  const sem1Fin = new Date(debut); sem1Fin.setDate(debut.getDate() + 6);
  const sem2Debut = new Date(debut); sem2Debut.setDate(debut.getDate() + 7);
  let h1 = 0, h2 = 0;
  for (const e of heures) {
    const d = dateISOLocale(e.date);
    if (d <= sem1Fin) h1 += e.heures;
    else if (d >= sem2Debut) h2 += e.heures;
  }
  const normales = Math.min(SEUIL_SUP_SEMAINE, h1) + Math.min(SEUIL_SUP_SEMAINE, h2);
  const sup = Math.max(0, h1 - SEUIL_SUP_SEMAINE) + Math.max(0, h2 - SEUIL_SUP_SEMAINE);
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

// Helpers de date sûrs timezone Montréal (America/Toronto)
// Vercel tourne en UTC → toISOString() décale d'une journée le soir au Québec.

/** Date du jour en heure de Montréal, format YYYY-MM-DD. */
export function aujourdhuiMontreal(): string {
  // Intl.DateTimeFormat avec timeZone garantit la date locale Montréal
  // peu importe la timezone du serveur.
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date()); // "2026-05-25"
}

/** Jour de Montréal d'un horodatage, format YYYY-MM-DD.
 *
 *  Le pendant d'`aujourdhuiMontreal()` côté AFFICHAGE. Les horodatages sont stockés en
 *  UTC (`new Date().toISOString()`), et les découper avec `.slice(0, 10)` rend la date
 *  UTC : un document déposé le 17 août à 20 h à Montréal s'affichait « 2026-08-18 ».
 *  Mesuré à l'écran sur la fiche d'un projet.
 *
 *  Accepte aussi une date déjà nue (« 2026-08-17 ») : elle est rendue telle quelle,
 *  sans être réinterprétée comme minuit UTC — sinon elle reculerait d'un jour.
 *  Une valeur vide ou illisible donne "" plutôt qu'une date inventée. */
export function jourMontreal(valeur: any): string {
  const s = String(valeur || "");
  if (!s) return "";
  if (RX_DATE_ISO.test(s)) return s; // déjà un jour civil : ne pas y toucher
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Semaine ISO 8601 d'un jour civil (« 2026-09-21 » → « 2026-W39 »). Les semaines
 *  commencent le lundi ; la semaine 1 est celle qui contient le premier jeudi de
 *  l'année, donc les 1er-3 janvier peuvent appartenir à l'année précédente et les
 *  29-31 décembre à la suivante. Sert de clé de garde aux crons hebdomadaires. */
export function semaineISO(jourISO: string): string {
  const [a, m, j] = jourISO.slice(0, 10).split("-").map(Number);
  const d = new Date(Date.UTC(a, (m || 1) - 1, j || 1));
  // Jeudi de la même semaine ISO (lundi = 1 … dimanche = 7)
  const jourSemaine = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - jourSemaine);
  const anneeISO = d.getUTCFullYear();
  const premierJanvier = Date.UTC(anneeISO, 0, 1);
  const semaine = Math.ceil(((d.getTime() - premierJanvier) / 86400000 + 1) / 7);
  return `${anneeISO}-W${String(semaine).padStart(2, "0")}`;
}

/** Vérifie qu'une chaîne est au format YYYY-MM-DD strict. */
export const RX_DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;
export function estDateISO(s: any): boolean {
  return typeof s === "string" && RX_DATE_ISO.test(s);
}

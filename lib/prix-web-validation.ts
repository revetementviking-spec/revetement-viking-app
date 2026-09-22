// Validation de la sortie de l'IA de /api/prix-web AVANT mise en cache.
//
// Le modèle cherche des prix sur le web : il peut se tromper d'unité (prix à la boîte
// pris pour un prix au pi²), inventer une source, ou renvoyer une note interminable. Le
// cache de 7 jours figeait ces erreurs pour toute l'équipe. On ne met en cache que ce
// qui passe ces bornes ; le reste est renvoyé à l'écran avec la raison, sans cache.
import { MATERIAUX } from "@/data/materiaux";

export const NOTE_MAX = 300;
export const RATIO_MIN = 0.5;
export const RATIO_MAX = 3;

export interface PrixWebValide {
  ok: boolean;
  raison?: string;
  prix_moyen_estime?: number;
  prix_trouves: any[];
  note: string;
  tendance?: string;
}

/** Prix coûtants du catalogue pour un code : à l'unité de calcul ET au format vendu
 *  (boîte, rouleau). Le web cite tantôt l'un, tantôt l'autre. */
export function prixCatalogue(code: string | undefined | null): number[] {
  const m = MATERIAUX.find((x) => x.code === code);
  if (!m) return [];
  return [m.prixCoutantParUniteCalcul, m.prixCoutantParFormat].filter((p) => Number.isFinite(p) && p > 0);
}

/** Vrai si `prix` est dans la bande [RATIO_MIN × p, RATIO_MAX × p] d'AU MOINS un prix de
 *  référence. Sans référence connue, on ne peut rien juger : accepté. */
export function prixPlausible(prix: number, references: number[]): boolean {
  if (!references.length) return true;
  return references.some((p) => prix >= p * RATIO_MIN && prix <= p * RATIO_MAX);
}

export function validerPrixWeb(data: any, code?: string | null): PrixWebValide {
  const note = String(data?.note ?? "").slice(0, NOTE_MAX);
  const trouves: any[] = Array.isArray(data?.prix_trouves) ? data.prix_trouves : [];
  const tendance = typeof data?.tendance === "string" ? data.tendance : undefined;
  const prix = Number(data?.prix_moyen_estime);
  const base = { prix_trouves: trouves, note, tendance };

  if (!Number.isFinite(prix) || prix <= 0) return { ok: false, raison: "aucun prix moyen", ...base };
  const avecUrl = trouves.some((t) => typeof t?.url === "string" && /^https?:\/\/\S+/i.test(t.url));
  if (!avecUrl) return { ok: false, raison: "aucune source (url) dans prix_trouves", prix_moyen_estime: prix, ...base };
  const refs = prixCatalogue(code);
  if (!prixPlausible(prix, refs)) {
    return {
      ok: false,
      raison: `prix ${prix} hors de la bande ${RATIO_MIN}× à ${RATIO_MAX}× du prix coûtant du catalogue (${refs.map((r) => r.toFixed(2)).join(" / ")})`,
      prix_moyen_estime: prix, ...base,
    };
  }
  return { ok: true, prix_moyen_estime: prix, ...base };
}

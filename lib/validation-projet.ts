// Validation et normalisation du corps d'un projet (POST/PATCH /api/projets).
//
// Avant, la route passait `body` tel quel à ajouterProjet()/modifierProjet() : un prix de
// contrat « 12 500,00 $ » (virgule québécoise) était stocké en TEXTE par SQLite, une date
// « demain » entrait dans date_fin_prevue et sortait de tous les filtres de période, un
// budget à 1e21 faisait exploser la marge. Mêmes bornes que les dépenses et les factures
// (lib/validation-argent.ts) ; la conversion se fait ICI, avant l'écriture.
// Import relatif : le harnais de tests ne résout pas l'alias « @/ ».
import { validerEcritureArgent } from "./validation-argent";
import { nombreSaisi } from "./calculs";

/** Champs « argent ou quantité » d'un projet : convertis en nombre avant l'écriture. */
export const CHAMPS_NOMBRE_PROJET = ["prix_contrat", "budget_estime", "heures_estimees", "duree_jours"] as const;
/** Champs date d'un projet : AAAA-MM-JJ réel exigé. */
export const CHAMPS_DATE_PROJET = ["date_debut", "date_fin_prevue", "date_fin_reelle"] as const;

/** Valide puis NORMALISE `body` en place (les nombres saisis deviennent des nombres, une
 *  chaîne vide devient null). Retourne un message d'erreur, ou null si tout est bon. */
export function validerEtNormaliserProjet(body: any): string | null {
  if (!body || typeof body !== "object") return "corps invalide";
  const erreur = validerEcritureArgent(body, {
    champsMontant: [...CHAMPS_NOMBRE_PROJET],
    champsDate: [...CHAMPS_DATE_PROJET],
    refuserNegatif: true,
  });
  if (erreur) return erreur;
  for (const c of CHAMPS_NOMBRE_PROJET) {
    if (body[c] === undefined) continue;
    if (body[c] === null || body[c] === "") { body[c] = null; continue; }
    const n = nombreSaisi(body[c]);
    if (!Number.isFinite(n)) return `${c} invalide`;
    body[c] = n;
  }
  for (const c of CHAMPS_DATE_PROJET) {
    if (body[c] === "") body[c] = null;
  }
  // Une fin prévue avant le début est une faute de frappe, pas un échéancier.
  if (body.date_debut && body.date_fin_prevue && String(body.date_fin_prevue) < String(body.date_debut)) {
    return "date_fin_prevue antérieure à date_debut";
  }
  return null;
}

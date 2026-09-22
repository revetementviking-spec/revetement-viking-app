// Échappement d'un terme de recherche destiné à un `LIKE ? ESCAPE '\'`.
// Sans lui, « % » ou « _ » saisis par l'utilisateur sont des jokers : « _ » seul renvoie
// toutes les lignes, « %%% » aussi — et une requête bien choisie pèse sur la base.
export const LIKE_ESCAPE = "\\";

/** Échappe \ % _ pour qu'ils soient pris au pied de la lettre dans un LIKE ... ESCAPE '\'. */
export function echapperLike(terme: string): string {
  return String(terme).replace(/[\\%_]/g, (c) => LIKE_ESCAPE + c);
}

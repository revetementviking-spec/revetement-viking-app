// Validation de la sortie de l'IA de /api/auto-estimateur, côté serveur.
//
// Le modèle renvoie des lignes de soumission « prêtes à appliquer ». Sans garde, une
// marge à 40 (au lieu de 0,40), un surplus à 1,5, une quantité NaN ou un code hors
// catalogue passaient tels quels dans le calculateur — et donc dans le prix envoyé au
// client. Fonction pure : chaque ligne est gardée, corrigée ou rejetée, et chaque
// rejet est renvoyé à l'écran comme avertissement.
import { MATERIAUX } from "@/data/materiaux";

export interface LigneEstimateur {
  materiauCode: string;
  quantite: number;
  surplus: number;
  margePct: number;
  couleur?: string;
  note?: string;
  confiance_prix?: string;
  verifier_web?: boolean;
}

export interface SortieEstimateurValidee {
  lignes_generees: LigneEstimateur[];
  avertissements: string[];
}

export const MARGE_MAX = 1;      // 0 ≤ margePct ≤ 1 (fraction, pas un pourcentage)
export const SURPLUS_MAX = 0.5;  // 0 ≤ surplus ≤ 0,5

const CODES_CATALOGUE: ReadonlySet<string> = new Set(MATERIAUX.map((m) => m.code));

export function validerSortieEstimateur(sortie: any, codesConnus: ReadonlySet<string> = CODES_CATALOGUE): SortieEstimateurValidee {
  const avertissements: string[] = [];
  const brutes: any[] = Array.isArray(sortie?.lignes_generees) ? sortie.lignes_generees : [];
  if (!Array.isArray(sortie?.lignes_generees)) avertissements.push("lignes_generees absent ou non tabulaire : aucune ligne appliquée");

  const lignes: LigneEstimateur[] = [];
  brutes.forEach((l, i) => {
    const ref = `ligne ${i + 1}`;
    const code = String(l?.materiauCode ?? "").trim();
    if (!code || !codesConnus.has(code)) {
      avertissements.push(`${ref} rejetée : code « ${code || "(vide)"} » absent du catalogue`);
      return;
    }
    const quantite = Number(l?.quantite);
    if (!Number.isFinite(quantite) || quantite < 0) {
      avertissements.push(`${ref} (${code}) rejetée : quantité invalide « ${l?.quantite} »`);
      return;
    }
    const surplus = Number(l?.surplus);
    if (!Number.isFinite(surplus) || surplus < 0 || surplus > SURPLUS_MAX) {
      avertissements.push(`${ref} (${code}) rejetée : surplus « ${l?.surplus} » hors de 0 à ${SURPLUS_MAX}`);
      return;
    }
    const margePct = Number(l?.margePct);
    if (!Number.isFinite(margePct) || margePct < 0 || margePct > MARGE_MAX) {
      avertissements.push(`${ref} (${code}) rejetée : marge « ${l?.margePct} » hors de 0 à ${MARGE_MAX} (fraction attendue, ex. 0,40)`);
      return;
    }
    lignes.push({
      materiauCode: code,
      quantite,
      surplus,
      margePct,
      ...(typeof l?.couleur === "string" ? { couleur: l.couleur.slice(0, 120) } : {}),
      ...(typeof l?.note === "string" ? { note: l.note.slice(0, 300) } : {}),
      ...(typeof l?.confiance_prix === "string" ? { confiance_prix: l.confiance_prix } : {}),
      ...(l?.verifier_web !== undefined ? { verifier_web: !!l.verifier_web } : {}),
    });
  });
  return { lignes_generees: lignes, avertissements };
}

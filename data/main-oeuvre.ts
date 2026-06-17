// Catalogue main-d'œuvre - Entreprises Xpress Inc.
// Taux horaire 90$/h (taux facturé client, vente directe)
// Temps standards basés sur moyennes industrie québécoise (APCHQ/Gentek-Kaycan)
// À ajuster selon expérience réelle de Francis.

import type { Categorie } from "./materiaux-gentek";

export const TAUX_HORAIRE_VENTE = 90; // $/h facturé au client

// Rendement par homme-heure pour 1 installateur expérimenté
// Quantité installée par heure de travail
export const RENDEMENT_HOMME_HEURE: Record<Categorie, number> = {
  soffite: 35, // pi²/h
  fascia: 18, // pi-lin/h (capping bois inclus)
  solin: 28, // pi-lin/h
  "parement-vinyle": 40, // pi²/h
  "parement-aluminium": 35, // pi²/h
  "parement-composite": 30, // pi²/h (Align, plus lourd)
  accessoire: 35, // pi-lin/h (coins, J)
  rouleau: 1, // rouleau ≈ 4h transformation/installation
  depart: 40, // pi-lin/h
};

// Frais forfaitaires généralement applicables à toute soumission
export interface FraisForfaitaire {
  id: string;
  libelle: string;
  heuresEstimees: number;
  obligatoire: boolean;
}

export const FRAIS_FORFAITAIRES: FraisForfaitaire[] = [
  {
    id: "mobilisation",
    libelle: "Mobilisation / démobilisation",
    heuresEstimees: 4,
    obligatoire: true,
  },
  {
    id: "echafaudage",
    libelle: "Montage / démontage échafaudage",
    heuresEstimees: 6,
    obligatoire: false,
  },
  {
    id: "nettoyage",
    libelle: "Nettoyage chantier final",
    heuresEstimees: 3,
    obligatoire: true,
  },
  {
    id: "permis",
    libelle: "Gestion documents / permis",
    heuresEstimees: 2,
    obligatoire: false,
  },
];

// Paramètres financiers par défaut
export const PARAMS_DEFAUT = {
  margeMateriauxDefaut: 0.40, // 40% sur prix coûtant
  fraisGestion: 0.15, // 15% sur sous-total
  tps: 0.05,
  tvq: 0.09975,
};

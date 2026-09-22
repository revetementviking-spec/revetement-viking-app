import { describe, it, expect } from "vitest";
import { validerPrixWeb, prixPlausible, prixCatalogue, NOTE_MAX } from "./prix-web-validation";
import { MATERIAUX } from "../data/materiaux";

const mat = MATERIAUX[0];
const src = (prix: number, url: any = "https://www.patrickmorin.com/produit") => ({ source: "Patrick Morin", url, prix, unite: "boite" });

describe("validerPrixWeb — ce qui a le droit d'entrer dans le cache de 7 jours", () => {
  it("accepte un prix plausible avec au moins une url", () => {
    const r = validerPrixWeb({ prix_moyen_estime: mat.prixCoutantParUniteCalcul * 1.2, prix_trouves: [src(1)], note: "ok" }, mat.code);
    expect(r.ok).toBe(true);
    expect(r.prix_moyen_estime).toBeCloseTo(mat.prixCoutantParUniteCalcul * 1.2, 6);
  });

  it("refuse sans url dans prix_trouves (source inventée ou absente)", () => {
    expect(validerPrixWeb({ prix_moyen_estime: mat.prixCoutantParUniteCalcul, prix_trouves: [src(1, null)] }, mat.code).ok).toBe(false);
    expect(validerPrixWeb({ prix_moyen_estime: mat.prixCoutantParUniteCalcul, prix_trouves: [{ source: "x", prix: 1 }] }, mat.code).ok).toBe(false);
    expect(validerPrixWeb({ prix_moyen_estime: mat.prixCoutantParUniteCalcul, prix_trouves: [src(1, "pas une url")] }, mat.code).ok).toBe(false);
    expect(validerPrixWeb({ prix_moyen_estime: mat.prixCoutantParUniteCalcul, prix_trouves: [] }, mat.code).ok).toBe(false);
  });

  it("refuse un prix < 0,5× ou > 3× le prix coûtant du catalogue", () => {
    const refs = prixCatalogue(mat.code);
    const tropBas = Math.min(...refs) * 0.4;
    const tropHaut = Math.max(...refs) * 3.5;
    expect(validerPrixWeb({ prix_moyen_estime: tropBas, prix_trouves: [src(tropBas)] }, mat.code).ok).toBe(false);
    expect(validerPrixWeb({ prix_moyen_estime: tropHaut, prix_trouves: [src(tropHaut)] }, mat.code).ok).toBe(false);
    expect(validerPrixWeb({ prix_moyen_estime: tropHaut, prix_trouves: [src(tropHaut)] }, mat.code).raison).toMatch(/hors de la bande/);
  });

  it("un prix au FORMAT (boîte) est accepté même si l'unité de calcul est le pi²", () => {
    if (mat.prixCoutantParFormat === mat.prixCoutantParUniteCalcul) return; // pas de distinction possible sur ce matériau
    const r = validerPrixWeb({ prix_moyen_estime: mat.prixCoutantParFormat, prix_trouves: [src(mat.prixCoutantParFormat)] }, mat.code);
    expect(r.ok).toBe(true);
  });

  it("code inconnu du catalogue : rien à comparer, on ne bloque pas sur le prix", () => {
    expect(prixCatalogue("N-EXISTE-PAS")).toEqual([]);
    expect(prixPlausible(999999, [])).toBe(true);
    expect(validerPrixWeb({ prix_moyen_estime: 42, prix_trouves: [src(42)] }, "N-EXISTE-PAS").ok).toBe(true);
  });

  it("refuse un prix moyen absent, nul ou non numérique", () => {
    for (const p of [0, -1, "abc", undefined, null]) {
      expect(validerPrixWeb({ prix_moyen_estime: p, prix_trouves: [src(1)] }, mat.code).ok).toBe(false);
    }
  });

  it("tronque la note à 300 caractères, dans les deux cas", () => {
    const longue = "x".repeat(1000);
    const ok = validerPrixWeb({ prix_moyen_estime: mat.prixCoutantParUniteCalcul, prix_trouves: [src(1)], note: longue }, mat.code);
    expect(ok.note).toHaveLength(NOTE_MAX);
    const ko = validerPrixWeb({ prix_moyen_estime: 0, prix_trouves: [], note: longue }, mat.code);
    expect(ko.note).toHaveLength(NOTE_MAX);
  });
});

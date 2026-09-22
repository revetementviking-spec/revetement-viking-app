import { describe, it, expect } from "vitest";
import { validerSortieEstimateur } from "./estimateur-validation";
import { MATERIAUX } from "../data/materiaux";

const CODE = MATERIAUX[0].code;
const bonne = { materiauCode: CODE, quantite: 2400, surplus: 0.1, margePct: 0.4, couleur: "Blanc", note: "Parement" };

describe("validerSortieEstimateur — garde-fou sur la sortie de l'IA", () => {
  it("garde une ligne conforme telle quelle", () => {
    const r = validerSortieEstimateur({ lignes_generees: [bonne] });
    expect(r.lignes_generees).toEqual([bonne]);
    expect(r.avertissements).toEqual([]);
  });

  it("rejette un code hors catalogue, avec un avertissement", () => {
    const r = validerSortieEstimateur({ lignes_generees: [{ ...bonne, materiauCode: "ZZZ-INCONNU" }, bonne] });
    expect(r.lignes_generees).toHaveLength(1);
    expect(r.avertissements[0]).toMatch(/ZZZ-INCONNU/);
  });

  it("rejette une marge hors de 0..1 (40 au lieu de 0,40) et un surplus > 0,5", () => {
    expect(validerSortieEstimateur({ lignes_generees: [{ ...bonne, margePct: 40 }] }).lignes_generees).toHaveLength(0);
    expect(validerSortieEstimateur({ lignes_generees: [{ ...bonne, margePct: -0.1 }] }).lignes_generees).toHaveLength(0);
    expect(validerSortieEstimateur({ lignes_generees: [{ ...bonne, surplus: 1.5 }] }).lignes_generees).toHaveLength(0);
    expect(validerSortieEstimateur({ lignes_generees: [{ ...bonne, margePct: 1, surplus: 0.5 }] }).lignes_generees).toHaveLength(1); // bornes inclusives
  });

  it("rejette une quantité non finie ou négative", () => {
    for (const q of [NaN, Infinity, -5, "abc", undefined]) {
      expect(validerSortieEstimateur({ lignes_generees: [{ ...bonne, quantite: q }] }).lignes_generees).toHaveLength(0);
    }
    expect(validerSortieEstimateur({ lignes_generees: [{ ...bonne, quantite: 0 }] }).lignes_generees).toHaveLength(1);
  });

  it("sortie sans lignes_generees : rien d'appliqué, un avertissement", () => {
    const r = validerSortieEstimateur({ resume_strategie: "x" });
    expect(r.lignes_generees).toEqual([]);
    expect(r.avertissements).toHaveLength(1);
    expect(validerSortieEstimateur(null).lignes_generees).toEqual([]);
  });

  it("borne les textes libres (couleur 120, note 300) et ne garde que des types propres", () => {
    const r = validerSortieEstimateur({ lignes_generees: [{ ...bonne, note: "n".repeat(1000), couleur: 42, verifier_web: "oui" }] });
    expect(r.lignes_generees[0].note).toHaveLength(300);
    expect(r.lignes_generees[0].couleur).toBeUndefined();
    expect(r.lignes_generees[0].verifier_web).toBe(true);
  });
});

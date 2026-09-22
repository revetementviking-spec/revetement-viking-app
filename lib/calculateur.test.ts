import { describe, it, expect } from "vitest";
import { calculerSoumission, auCent } from "./calculateur";
import { MATERIAUX } from "../data/materiaux";

describe("auCent", () => {
  it("arrondit au cent, y compris les .xx5 que Math.round(x*100) mange", () => {
    expect(auCent(1.005)).toBe(1.01);
    expect(auCent(2.675)).toBe(2.68);
    expect(auCent(123.456)).toBe(123.46);
    expect(auCent(0)).toBe(0);
  });
});

describe("calculerSoumission — taxes arrondies au cent, total = somme des arrondis", () => {
  it("123,45 $ avant taxes → TPS 6,17 + TVQ 12,31 = 141,93 (cas du constat)", () => {
    // Une seule ligne dont le sous-total vaut exactement 123,45 : on passe par les frais
    // forfaitaires (heures × 90 $) et un frais de gestion à 0 → 1,371666… h × 90 = 123,45.
    const r = calculerSoumission({ lignes: [], fraisActifs: [{ id: "x", heures: 123.45 / 90 }], fraisGestion: 0, appliquerTaxes: true });
    expect(r.sousTotalAvantTaxes).toBe(123.45);
    expect(r.tps).toBe(6.17);   // 6,1725 → 6,17
    expect(r.tvq).toBe(12.31);  // 12,3141… → 12,31
    expect(r.total).toBe(141.93);
    expect(auCent(r.sousTotalAvantTaxes + r.tps + r.tvq)).toBe(r.total);
  });

  it("le total imprimé est TOUJOURS sous-total + TPS + TVQ tels qu'affichés", () => {
    const codes = MATERIAUX.slice(0, 12).map((m) => m.code);
    for (let k = 1; k <= 25; k++) {
      const lignes = codes.map((code, i) => ({ materiauCode: code, quantite: 7 * k + i * 3.3, surplus: 0.1, margePct: 0.4 }));
      const r = calculerSoumission({ lignes, fraisActifs: [{ id: "mob", heures: 4 }], fraisGestion: 0.15, appliquerTaxes: true });
      expect(r.total).toBe(auCent(r.sousTotalAvantTaxes + r.tps + r.tvq));
      expect(r.tps).toBe(auCent(r.tps));
      expect(r.tvq).toBe(auCent(r.tvq));
      expect(r.sousTotalAvantTaxes).toBe(auCent(r.sousTotalAvantTaxes));
    }
  });

  it("sans taxes : TPS et TVQ à 0, total = sous-total", () => {
    const r = calculerSoumission({ lignes: [], fraisActifs: [{ id: "x", heures: 2 }], fraisGestion: 0.15, appliquerTaxes: false });
    expect(r.tps).toBe(0); expect(r.tvq).toBe(0);
    expect(r.total).toBe(r.sousTotalAvantTaxes);
    expect(r.total).toBe(auCent(180 * 1.15));
  });

  it("un code de matériau inconnu est ignoré sans casser le calcul", () => {
    const r = calculerSoumission({ lignes: [{ materiauCode: "N-EXISTE-PAS", quantite: 100, surplus: 0.1, margePct: 0.4 }], fraisActifs: [], fraisGestion: 0.15, appliquerTaxes: true });
    expect(r.lignes).toHaveLength(0);
    expect(r.total).toBe(0);
  });
});

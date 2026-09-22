import { describe, it, expect } from "vitest";
import { validerEtNormaliserProjet } from "./validation-projet";

describe("validerEtNormaliserProjet (bornes + conversion des saisies)", () => {
  it("convertit les montants québécois en nombres et vide → null", () => {
    const b: any = { nom: "Test", prix_contrat: "12 500,50 $", budget_estime: "", heures_estimees: "40", duree_jours: null };
    expect(validerEtNormaliserProjet(b)).toBeNull();
    expect(b.prix_contrat).toBe(12500.5);
    expect(b.budget_estime).toBeNull();
    expect(b.heures_estimees).toBe(40);
    expect(b.duree_jours).toBeNull();
  });

  it("refuse un montant illisible, négatif ou aberrant", () => {
    expect(validerEtNormaliserProjet({ prix_contrat: "abc" })).toMatch(/prix_contrat/);
    expect(validerEtNormaliserProjet({ budget_estime: -5 })).toMatch(/négatif/);
    expect(validerEtNormaliserProjet({ prix_contrat: 1e21 })).toMatch(/hors plage/);
  });

  it("refuse une date inexistante ou mal formée, accepte une date réelle", () => {
    expect(validerEtNormaliserProjet({ date_debut: "2026-02-31" })).toMatch(/inexistante/);
    expect(validerEtNormaliserProjet({ date_fin_prevue: "demain" })).toMatch(/AAAA-MM-JJ/);
    const b: any = { date_debut: "2026-09-01", date_fin_prevue: "2026-09-15", date_fin_reelle: "" };
    expect(validerEtNormaliserProjet(b)).toBeNull();
    expect(b.date_fin_reelle).toBeNull();
  });

  it("refuse une fin prévue avant le début", () => {
    expect(validerEtNormaliserProjet({ date_debut: "2026-09-15", date_fin_prevue: "2026-09-01" })).toMatch(/antérieure/);
  });

  it("ne touche pas aux champs absents (PATCH partiel)", () => {
    const b: any = { id: 3, statut: "complete" };
    expect(validerEtNormaliserProjet(b)).toBeNull();
    expect(b).toEqual({ id: 3, statut: "complete" });
  });
});

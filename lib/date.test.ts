import { describe, it, expect } from "vitest";
import { semaineISO, jourMontreal, estDateISO } from "./date";

describe("semaineISO (clé de garde des crons hebdomadaires)", () => {
  it("un dimanche et le lundi précédent sont dans la même semaine ISO", () => {
    expect(semaineISO("2026-09-21")).toBe("2026-W39"); // lundi
    expect(semaineISO("2026-09-27")).toBe("2026-W39"); // dimanche (soir du rapport hebdo)
    expect(semaineISO("2026-09-28")).toBe("2026-W40"); // lundi suivant
  });

  it("les premiers jours de janvier peuvent appartenir à l'année précédente", () => {
    expect(semaineISO("2027-01-01")).toBe("2026-W53"); // vendredi 1er janv. 2027 → S53 de 2026
    expect(semaineISO("2027-01-04")).toBe("2027-W01"); // lundi
  });

  it("fin décembre peut basculer sur la semaine 1 de l'année suivante", () => {
    expect(semaineISO("2024-12-30")).toBe("2025-W01");
  });

  it("deux rapports du même dimanche partagent la clé ; deux dimanches consécutifs non", () => {
    expect(semaineISO("2026-06-07")).toBe(semaineISO("2026-06-07"));
    expect(semaineISO("2026-06-07")).not.toBe(semaineISO("2026-06-14"));
  });
});

describe("jourMontreal / estDateISO", () => {
  it("un jour civil nu n'est pas réinterprété", () => {
    expect(jourMontreal("2026-08-17")).toBe("2026-08-17");
  });
  it("un horodatage UTC du soir donne le jour de Montréal, pas le lendemain UTC", () => {
    expect(jourMontreal("2026-08-18T00:30:00.000Z")).toBe("2026-08-17");
  });
  it("estDateISO", () => {
    expect(estDateISO("2026-02-03")).toBe(true);
    expect(estDateISO("2026-2-3")).toBe(false);
    expect(estDateISO(null)).toBe(false);
  });
});

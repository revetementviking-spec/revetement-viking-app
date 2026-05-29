import { describe, it, expect } from "vitest";
import {
  calculerMargeProjet, dateISOLocale, periodeBiHebdo,
  calculerHeuresPaye, calculerPaye, indexJourSemaine,
} from "./calculs";

describe("calculerMargeProjet", () => {
  it("calcule la marge à partir du prix de contrat", () => {
    const r = calculerMargeProjet({ prix_contrat: 36258.52, cout_main_oeuvre: 6641.25, total_depenses: 15702.15 });
    expect(r.revenu).toBe(36258.52);
    expect(r.cout_total).toBeCloseTo(22343.4, 2);
    expect(r.marge).toBeCloseTo(13915.12, 2);
    expect(r.marge_pct).toBeCloseTo(38.38, 1);
  });
  it("retombe sur budget_estime si pas de prix_contrat", () => {
    const r = calculerMargeProjet({ budget_estime: 10000, total_depenses: 4000 });
    expect(r.revenu).toBe(10000);
    expect(r.marge).toBe(6000);
    expect(r.marge_pct).toBe(60);
  });
  it("ne divise pas par zéro si aucun revenu", () => {
    const r = calculerMargeProjet({ total_depenses: 500 });
    expect(r.marge_pct).toBe(0);
    expect(r.marge).toBe(-500);
  });
  it("la marge BAISSE quand les dépenses augmentent (bug rapporté)", () => {
    const avant = calculerMargeProjet({ prix_contrat: 36258.52, cout_main_oeuvre: 6221.25, total_depenses: 15702.15 });
    const apres = calculerMargeProjet({ prix_contrat: 36258.52, cout_main_oeuvre: 6221.25, total_depenses: 16702.15 });
    expect(apres.marge).toBeLessThan(avant.marge);
    expect(apres.marge_pct).toBeLessThan(avant.marge_pct);
  });
});

describe("dateISOLocale (anti-bug timezone)", () => {
  it("parse le 25 mai comme un lundi local, pas le dimanche UTC", () => {
    const d = dateISOLocale("2026-05-25");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // mai = index 4
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(0);
  });
  it("indexJourSemaine : lundi=0, dimanche=6", () => {
    expect(indexJourSemaine("2026-05-25")).toBe(0); // lundi
    expect(indexJourSemaine("2026-05-26")).toBe(1); // mardi
    expect(indexJourSemaine("2026-05-31")).toBe(6); // dimanche
  });
});

describe("periodeBiHebdo (ancrage lundi 18 mai 2026)", () => {
  it("regroupe les 2 semaines de travail consécutives dans la MÊME période", () => {
    // Cas réel Gabriel : 19-23 mai (semaine 1) et 25-27 mai (semaine 2)
    const p1 = periodeBiHebdo("2026-05-19");
    const p2 = periodeBiHebdo("2026-05-27");
    expect(p1.debut).toBe("2026-05-18");
    expect(p1.fin).toBe("2026-05-31");
    expect(p2.debut).toBe(p1.debut); // même quinzaine
  });
  it("sépare la quinzaine suivante (1er juin)", () => {
    const p1 = periodeBiHebdo("2026-05-27");
    const p2 = periodeBiHebdo("2026-06-01");
    expect(p2.debut).toBe("2026-06-01");
    expect(p1.debut).not.toBe(p2.debut);
  });
});

describe("calculerHeuresPaye (heures sup ×1.5)", () => {
  it("aucune heure sup sous 40h/semaine", () => {
    const h = [{ date: "2026-01-05", heures: 8 }, { date: "2026-01-06", heures: 8 }];
    const r = calculerHeuresPaye(h, "2026-01-04");
    expect(r.normales).toBe(16);
    expect(r.sup).toBe(0);
  });
  it("compte les heures sup au-delà de 40h dans une semaine", () => {
    // semaine 1 : 45h → 40 normales + 5 sup
    const h = [
      { date: "2026-01-05", heures: 10 }, { date: "2026-01-06", heures: 10 },
      { date: "2026-01-07", heures: 10 }, { date: "2026-01-08", heures: 10 },
      { date: "2026-01-09", heures: 5 },
    ];
    const r = calculerHeuresPaye(h, "2026-01-04");
    expect(r.normales).toBe(40);
    expect(r.sup).toBe(5);
  });
  it("traite les 2 semaines séparément (pas de cumul 80h)", () => {
    // 45h semaine 1 + 45h semaine 2 = 80 normales? NON : 40+40 normales, 5+5 sup
    const sem1 = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"].map((d) => ({ date: d, heures: 9 })); // 45h
    const sem2 = ["2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"].map((d) => ({ date: d, heures: 9 })); // 45h
    const r = calculerHeuresPaye([...sem1, ...sem2], "2026-01-04");
    expect(r.normales).toBe(80);
    expect(r.sup).toBe(10);
  });
});

describe("calculerPaye (brut/DAS/net)", () => {
  it("Gabriel 40h normales à 45$ + 5h sup", () => {
    const r = calculerPaye(40, 5, 45);
    // brut = 40*45 + 5*45*1.5 = 1800 + 337.5 = 2137.5
    expect(r.brut).toBeCloseTo(2137.5, 2);
    // DAS 15% = 320.625 ; net = 1816.875
    expect(r.das).toBeCloseTo(320.625, 3);
    expect(r.net).toBeCloseTo(1816.875, 3);
  });
  it("Maxime 40h à 30$ sans sup, DAS 15%", () => {
    const r = calculerPaye(40, 0, 30);
    expect(r.brut).toBe(1200);
    expect(r.das).toBeCloseTo(180, 2);
    expect(r.net).toBeCloseTo(1020, 2);
  });
});

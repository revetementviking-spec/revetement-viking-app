import { describe, it, expect } from "vitest";
import {
  calculerMargeProjet, revenuAvantTaxes, depensesAvantTaxes, avancerDateRecurrence,
  dateISOLocale, periodeBiHebdo, calculerHeuresPaye, calculerPaye, indexJourSemaine,
} from "./calculs";

describe("calculerMargeProjet (rentabilité AVANT taxes)", () => {
  it("revenu reste taxes incluses, mais la marge se calcule avant taxes", () => {
    const r = calculerMargeProjet({ prix_contrat: 36258.52, cout_main_oeuvre: 6641.25, total_depenses: 15702.15 });
    expect(r.revenu).toBe(36258.52); // affichage = taxes incluses
    expect(r.revenu_avant_taxes).toBeCloseTo(36258.52 / 1.14975, 2);
    expect(r.cout_total).toBeCloseTo(22343.4, 2);
    expect(r.marge).toBeCloseTo(36258.52 / 1.14975 - 22343.4, 2); // profit avant taxes
    expect(r.marge).toBeLessThan(36258.52 - 22343.4); // < marge taxes incluses (corrigé)
    expect(r.marge_pct).toBeCloseTo((r.marge / r.revenu_avant_taxes) * 100, 2);
  });
  it("retombe sur budget_estime si pas de prix_contrat", () => {
    const r = calculerMargeProjet({ budget_estime: 11497.5, total_depenses: 4000 });
    expect(r.revenu).toBe(11497.5);
    expect(r.revenu_avant_taxes).toBeCloseTo(10000, 0); // 11497.5 / 1.14975 ≈ 10000
    expect(r.marge).toBeCloseTo(6000, 0); // 10000 − 4000
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
  it("revenuAvantTaxes retire bien TPS+TVQ", () => {
    expect(revenuAvantTaxes(1149.75)).toBeCloseTo(1000, 4);
  });
});

describe("calculerMargeProjet — extras facturés comme revenu", () => {
  it("un extra facturé s'ajoute au revenu (avant division par les taxes)", () => {
    const sans = calculerMargeProjet({ prix_contrat: 11497.5, total_depenses: 4000 });
    const avec = calculerMargeProjet({ prix_contrat: 11497.5, total_depenses: 4000, extras_factures: 1149.75 });
    // revenu = contrat + extras (taxes incluses)
    expect(avec.revenu).toBeCloseTo(11497.5 + 1149.75, 2);
    // l'extra ajoute 1149.75/1.14975 = 1000 avant taxes à la marge
    expect(avec.marge - sans.marge).toBeCloseTo(1000, 6);
    expect(avec.marge).toBeGreaterThan(sans.marge);
  });
  it("extras absent/0 → identique à avant (rétrocompatible)", () => {
    const a = calculerMargeProjet({ prix_contrat: 20000, total_depenses: 5000 });
    const b = calculerMargeProjet({ prix_contrat: 20000, total_depenses: 5000, extras_factures: 0 });
    expect(a.marge).toBe(b.marge);
    expect(a.revenu).toBe(b.revenu);
  });
  it("extras seuls (sans contrat) comptent quand même comme revenu", () => {
    const r = calculerMargeProjet({ budget_estime: 0, total_depenses: 0, extras_factures: 1149.75 });
    expect(r.revenu).toBeCloseTo(1149.75, 2);
    expect(r.marge).toBeCloseTo(1000, 6);
  });
});

describe("depensesAvantTaxes — factures détaxées", () => {
  it("dépense normale : on retire les taxes", () => {
    expect(depensesAvantTaxes(1149.75, 0)).toBeCloseTo(1000, 6);
  });
  it("dépense entièrement détaxée : comptée telle quelle", () => {
    expect(depensesAvantTaxes(1149.75, 1149.75)).toBeCloseTo(1149.75, 6);
  });
  it("mixte : seule la part taxable est ramenée avant taxes", () => {
    // 1149.75 taxable → 1000 ; + 500 détaxé au pair = 1500
    expect(depensesAvantTaxes(1649.75, 500)).toBeCloseTo(1500, 6);
  });
  it("détaxé > 0 réduit toujours la déduction de taxes (marge plus juste)", () => {
    expect(depensesAvantTaxes(1000, 1000)).toBeGreaterThan(depensesAvantTaxes(1000, 0));
  });
});

describe("avancerDateRecurrence", () => {
  it("quotidien : +1 jour", () => { expect(avancerDateRecurrence("2026-06-20", "quotidien")).toBe("2026-06-21"); });
  it("hebdo : +7 jours", () => { expect(avancerDateRecurrence("2026-06-20", "hebdo")).toBe("2026-06-27"); });
  it("2sem : +14 jours", () => { expect(avancerDateRecurrence("2026-06-20", "2sem")).toBe("2026-07-04"); });
  it("mensuel : +1 mois", () => { expect(avancerDateRecurrence("2026-06-20", "mensuel")).toBe("2026-07-20"); });
  it("hebdo traverse la fin de mois", () => { expect(avancerDateRecurrence("2026-06-28", "hebdo")).toBe("2026-07-05"); });
  it("mensuel traverse la fin d'année", () => { expect(avancerDateRecurrence("2026-12-15", "mensuel")).toBe("2027-01-15"); });
  it("récurrence inconnue/vide → date inchangée", () => { expect(avancerDateRecurrence("2026-06-20", "")).toBe("2026-06-20"); });
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

describe("calculerHeuresPaye (sup = >80h sur la quinzaine)", () => {
  it("aucune heure sup sous 80h sur la quinzaine", () => {
    const h = [{ date: "2026-05-19", heures: 45 }, { date: "2026-05-26", heures: 30 }]; // 75h
    const r = calculerHeuresPaye(h, "2026-05-18");
    expect(r.normales).toBe(75);
    expect(r.sup).toBe(0);
  });
  it("45h une semaine + 30h l'autre = 75h → 0 sup (avant: aurait donné 5 sup)", () => {
    const h = [{ date: "2026-05-19", heures: 45 }, { date: "2026-05-26", heures: 30 }];
    const r = calculerHeuresPaye(h, "2026-05-18");
    expect(r.sup).toBe(0);
  });
  it("compte les heures sup au-delà de 80h sur la quinzaine", () => {
    // 50h + 40h = 90h → 80 normales + 10 sup
    const h = [{ date: "2026-05-19", heures: 50 }, { date: "2026-05-26", heures: 40 }];
    const r = calculerHeuresPaye(h, "2026-05-18");
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

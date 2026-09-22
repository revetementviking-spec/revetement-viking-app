import { describe, it, expect } from "vitest";
import {
  calculerMargeProjet, revenuAvantTaxes, depensesAvantTaxes, avancerDateRecurrence, nombreSaisi,
  dateISOLocale, periodeBiHebdo, calculerPaieQuinzaine, indexJourSemaine,
  heuresDuesPeriodePayee, SEUIL_SUP_PERIODE,
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
  // Le % de budget comparait un coût HORS taxes à un revenu TAXES INCLUSES : il était
  // minoré d'environ 13 %, donc l'alerte de dépassement se déclenchait trop tard.
  it("le % de budget compare deux montants HORS taxes", () => {
    // Budget 11 497,50 $ taxes incluses = 10 000 $ hors taxes. Coût réel : 10 000 $ hors
    // taxes → le budget est consommé à 100 %, pas à 87 %.
    const r = calculerMargeProjet({ budget_estime: 11497.5, total_depenses: 10000 });
    expect(r.pct_budget_consomme).toBeCloseTo(100, 1);
  });
  it("le % de budget franchit bien le seuil d'alerte de 90 %", () => {
    // 9 200 $ de coût sur 10 000 $ hors taxes = 92 % → doit alerter.
    const r = calculerMargeProjet({ budget_estime: 11497.5, total_depenses: 9200 });
    expect(r.pct_budget_consomme).toBeGreaterThanOrEqual(90);
  });
  it("un projet à mi-budget affiche bien ~50 %", () => {
    const r = calculerMargeProjet({ budget_estime: 11497.5, total_depenses: 5000 });
    expect(r.pct_budget_consomme).toBeCloseTo(50, 1);
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

  it("détaxé supérieur au total (donnée incohérente) ne fabrique pas de montant négatif", () => {
    // Peut arriver si un montant est modifié après coup sans décocher « détaxé ».
    // La part taxable est bornée à 0, donc on retombe sur le détaxé seul.
    expect(depensesAvantTaxes(500, 800)).toBeCloseTo(800, 6);
    expect(depensesAvantTaxes(500, 800)).toBeGreaterThan(0);
  });

  it("note de crédit (montant négatif) reste négative — sinon un remboursement gonflerait les coûts", () => {
    expect(depensesAvantTaxes(-1149.75, 0)).toBeCloseTo(-1000, 6);
  });

  it("aucune dépense = 0, pas NaN", () => {
    expect(depensesAvantTaxes(0, 0)).toBe(0);
    expect(depensesAvantTaxes(undefined as any, undefined as any)).toBe(0);
  });

  it("scénario complet vérifié en direct sur l'app", () => {
    // 1 149,75 $ taxable + 500 $ détaxé, contrat 50 000 $ taxes incluses, 10 h × 40 $
    const depAvantTaxes = depensesAvantTaxes(1649.75, 500);
    const revAvantTaxes = revenuAvantTaxes(50000);
    expect(depAvantTaxes).toBeCloseTo(1500, 6);
    expect(revAvantTaxes).toBeCloseTo(43487.71, 2);
    expect(revAvantTaxes - depAvantTaxes - 400).toBeCloseTo(41587.71, 2);
  });
});

describe("nombreSaisi sur les montants de dépense (saisie québécoise)", () => {
  it("lit les formats réellement tapés à l'écran", () => {
    expect(nombreSaisi("1 149,75")).toBeCloseTo(1149.75, 6);
    expect(nombreSaisi("1149,75")).toBeCloseTo(1149.75, 6);
    expect(nombreSaisi("1 149,75 $")).toBeCloseTo(1149.75, 6);
    expect(nombreSaisi("1,149.75")).toBeCloseTo(1149.75, 6);  // format anglais collé du web
    expect(nombreSaisi("88,50")).toBeCloseTo(88.5, 6);
  });
  it("un champ vidé ne doit pas valoir 0 (c'est ce qui ramenait une dépense à zéro)", () => {
    expect(Number.isNaN(nombreSaisi(""))).toBe(true);
    expect(Number.isNaN(nombreSaisi("   "))).toBe(true);
    // `+""` valait 0 — d'où le garde-fou serveur qui refuse maintenant un montant à 0.
    expect(+"").toBe(0);
  });
});

describe("avancerDateRecurrence", () => {
  it("quotidien : +1 jour", () => { expect(avancerDateRecurrence("2026-06-20", "quotidien")).toBe("2026-06-21"); });
  it("hebdo : +7 jours", () => { expect(avancerDateRecurrence("2026-06-20", "hebdo")).toBe("2026-06-27"); });
  it("2sem : +14 jours", () => { expect(avancerDateRecurrence("2026-06-20", "2sem")).toBe("2026-07-04"); });
  it("mensuel fin de mois : borné au dernier jour (pas de débordement)", () => {
    expect(avancerDateRecurrence("2026-01-31", "mensuel")).toBe("2026-02-28"); // pas 3 mars !
    expect(avancerDateRecurrence("2028-01-31", "mensuel")).toBe("2028-02-29"); // bissextile
    expect(avancerDateRecurrence("2026-03-31", "mensuel")).toBe("2026-04-30");
    expect(avancerDateRecurrence("2026-08-31", "mensuel")).toBe("2026-09-30");
  });
  it("mensuel jour normal : même jour le mois suivant", () => {
    expect(avancerDateRecurrence("2026-12-15", "mensuel")).toBe("2027-01-15"); // passage d'année
  });
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

// Régime maison (décision de Francis) : AUCUNE majoration ×1,5. Le surplus au-delà de
// 80 h par quinzaine va en banque, 1 h pour 1 h. Ces tests FIGENT les résultats que
// listerPaiePeriodes (lib/db.ts) produisait avant d'être branché sur cette fonction pure :
// mêmes heures, mêmes montants, même solde de banque.
describe("calculerPaieQuinzaine (régime banque d'heures, 1 h pour 1 h, sans ×1,5)", () => {
  it("sous 80 h : tout est payé au taux, rien en banque", () => {
    const r = calculerPaieQuinzaine([{ heures: 45, taux: 45 }, { heures: 30, taux: 45 }]);
    expect(r.travaillees).toBe(75);
    expect(r.payees).toBe(75);
    expect(r.surplus).toBe(0);
    expect(r.banque_solde).toBe(0);
    expect(r.brut).toBe(75 * 45);
    expect(r.das).toBeCloseTo(75 * 45 * 0.15, 6);
    expect(r.net).toBeCloseTo(75 * 45 * 0.85, 6);
  });

  it("Gabriel 84,5 h à 45 $ : 80 h payées, 4,5 h en banque, AUCUNE prime", () => {
    const r = calculerPaieQuinzaine([{ heures: 50, taux: 45 }, { heures: 34.5, taux: 45 }]);
    expect(r.base).toBe(80);
    expect(r.surplus).toBeCloseTo(4.5, 6);
    expect(r.payees).toBe(80);
    expect(r.brut).toBe(3600);              // 80 × 45 — pas 80×45 + 4,5×45×1,5
    expect(r.banque_solde).toBeCloseTo(4.5, 6);
  });

  it("Maxime 40 h à 30 $ : brut 1 200, DAS 180, net 1 020", () => {
    const r = calculerPaieQuinzaine([{ heures: 40, taux: 30 }]);
    expect(r.brut).toBe(1200);
    expect(r.das).toBeCloseTo(180, 6);
    expect(r.net).toBeCloseTo(1020, 6);
  });

  it("deux taux dans la même quinzaine : 40 h @ 50 $ + 40 h @ 60 $ = 4 400 $, taux moyen 55 $", () => {
    const r = calculerPaieQuinzaine([{ heures: 40, taux: 50 }, { heures: 40, taux: 60 }]);
    expect(r.taux).toBe(55);
    expect(r.brut).toBe(4400);
    expect(r.gains_par_taux).toEqual([
      { taux: 50, heures: 40, montant: 2000 },
      { taux: 60, heures: 40, montant: 2400 },
    ]);
  });

  it("un seul taux → une seule ligne de ventilation, égale au brut", () => {
    const r = calculerPaieQuinzaine([{ heures: 30, taux: 45 }, { heures: 20, taux: 45 }]);
    expect(r.gains_par_taux).toHaveLength(1);
    expect(r.gains_par_taux[0].montant).toBe(r.brut);
  });

  it("deux taux ET surplus : la ventilation est ramenée aux heures payées, sa somme = brut", () => {
    const r = calculerPaieQuinzaine([{ heures: 60, taux: 50 }, { heures: 40, taux: 60 }]); // 100 h
    expect(r.payees).toBe(80);
    const somme = r.gains_par_taux.reduce((s, g) => s + g.montant, 0);
    expect(somme).toBeCloseTo(r.brut, 6);
    expect(r.gains_par_taux.reduce((s, g) => s + g.heures, 0)).toBeCloseTo(80, 6);
  });

  it("la banque comble une quinzaine courte — plafonnée au manque et à la dispo", () => {
    const r = calculerPaieQuinzaine([{ heures: 70, taux: 45 }], { banqueAvant: 4.5, banqueAppliqueeDemandee: 20 });
    expect(r.banque_appliquee).toBeCloseTo(4.5, 6);   // dispo < manque (10)
    expect(r.payees).toBeCloseTo(74.5, 6);
    expect(r.banque_solde).toBe(0);
    const r2 = calculerPaieQuinzaine([{ heures: 70, taux: 45 }], { banqueAvant: 30, banqueAppliqueeDemandee: 20 });
    expect(r2.banque_appliquee).toBe(10);              // manque (80 − 70) < demandé
    expect(r2.banque_solde).toBe(20);
  });

  it("la banque n'est jamais appliquée automatiquement (aucune demande = 0)", () => {
    const r = calculerPaieQuinzaine([{ heures: 70, taux: 45 }], { banqueAvant: 30 });
    expect(r.banque_appliquee).toBe(0);
    expect(r.banque_solde).toBe(30);
  });

  it("période payée : l'appliqué reste ce qui a été versé (borné à la dispo)", () => {
    const r = calculerPaieQuinzaine([{ heures: 85, taux: 45 }], { banqueAvant: 3, banqueAppliqueeDemandee: 8, paye: true });
    expect(r.banque_appliquee).toBe(3);
    expect(r.payees).toBe(83);
  });

  it("DAS de la fiche employé (pas 15 % codé en dur)", () => {
    const r = calculerPaieQuinzaine([{ heures: 80, taux: 45 }], { dasPct: 0.2 });
    expect(r.das).toBeCloseTo(720, 6);
    expect(calculerPaieQuinzaine([{ heures: 80, taux: 45 }], { dasPct: null as any }).das).toBeCloseTo(540, 6);
  });

  it("chaîne de quinzaines : le solde de l'une est la dispo de la suivante (cas juin 2026)", () => {
    let banque = 0;
    const totaux: number[] = [];
    for (const h of [84.5, 91.5, 84.25]) {
      const r = calculerPaieQuinzaine([{ heures: h, taux: 45 }], { banqueAvant: banque });
      totaux.push(r.brut);
      banque = r.banque_solde;
    }
    expect(totaux).toEqual([3600, 3600, 3600]);
    expect(banque).toBeCloseTo(4.5 + 11.5 + 4.25, 6);
  });

  it("aucune heure : tout à zéro, pas de NaN", () => {
    const r = calculerPaieQuinzaine([]);
    expect(r.taux).toBe(0); expect(r.brut).toBe(0); expect(r.gains_par_taux).toEqual([]);
    expect(SEUIL_SUP_PERIODE).toBe(80);
  });
});

// Le bandeau « X h travaillées ne sont dans aucune paye » réclamait le surplus de banque
// comme une dette : cinq quinzaines à 80 h payées pile (Gabriel 84,5 / 91,5 / 84,25 ;
// Maxime 89,25 / 81) totalisaient 30,5 h « dues » ≈ 1 218,75 $, alors que ces mêmes heures
// s'affichaient déjà au crédit des employés dans la carte « Banque d'heures » juste au-dessus.
describe("heuresDuesPeriodePayee (dette réelle vs surplus de banque)", () => {
  it("surplus au-delà de 80h = banque, rien de dû", () => {
    expect(heuresDuesPeriodePayee(84.5, 80)).toBe(0);
    expect(heuresDuesPeriodePayee(91.5, 80)).toBe(0);
    expect(heuresDuesPeriodePayee(89.25, 80)).toBe(0);
    expect(heuresDuesPeriodePayee(81, 80)).toBe(0);
  });
  it("les cinq quinzaines de juin 2026 ne doivent plus rien totaliser", () => {
    const cas: [number, number][] = [[84.5, 80], [91.5, 80], [89.25, 80], [84.25, 80], [81, 80]];
    const total = cas.reduce((s, [t, p]) => s + heuresDuesPeriodePayee(t, p), 0);
    expect(total).toBe(0);
  });
  it("feuille de temps saisie APRÈS le versement = vraie dette (le cas visé)", () => {
    // Versée à 45 h, 8 h oubliées saisies ensuite : elles n'atteignent aucune paye.
    expect(heuresDuesPeriodePayee(53, 45)).toBe(8);
  });
  it("saisie tardive ET surplus : seule la part sous 80h est due, le reste va en banque", () => {
    expect(heuresDuesPeriodePayee(91, 45)).toBe(35); // 80 - 45 dû ; 11 h en banque
  });
  it("période comblée par la banque (payées > travaillées) ne doit rien", () => {
    expect(heuresDuesPeriodePayee(70, 80)).toBe(0);
  });
  it("arrondi au centième, jamais négatif", () => {
    expect(heuresDuesPeriodePayee(45.333, 45)).toBe(0.33);
    expect(heuresDuesPeriodePayee(0, 0)).toBe(0);
  });
});

// Saisie de montants au Québec : virgule décimale ET espace de milliers. Un parser qui
// ne faisait que `.replace(",", ".")` refusait « 5 000,50 » (Number("5 000.50") = NaN),
// alors que c'est exactement le format proposé en exemple dans les champs.
describe("nombreSaisi — montants saisis à la main", () => {
  it("accepte la virgule décimale", () => {
    expect(nombreSaisi("88,50")).toBeCloseTo(88.5, 6);
  });
  it("accepte l'espace des milliers (le cas qui échouait)", () => {
    expect(nombreSaisi("5 000,50")).toBeCloseTo(5000.5, 6);
  });
  it("accepte l'espace insécable produite par un copier-coller", () => {
    expect(nombreSaisi("1\u00A0234,56")).toBeCloseTo(1234.56, 6);
    expect(nombreSaisi("1\u202F234,56")).toBeCloseTo(1234.56, 6);
  });
  it("accepte le symbole de dollar", () => {
    expect(nombreSaisi("1 234,56 $")).toBeCloseTo(1234.56, 6);
  });
  it("accepte le format anglais avec virgule de milliers", () => {
    expect(nombreSaisi("1,234.56")).toBeCloseTo(1234.56, 6);
  });
  it("accepte le point décimal simple et un nombre déjà numérique", () => {
    expect(nombreSaisi("88.50")).toBeCloseTo(88.5, 6);
    expect(nombreSaisi(88.5)).toBeCloseTo(88.5, 6);
  });
  it("accepte un négatif (note de crédit)", () => {
    expect(nombreSaisi("-1 500,25")).toBeCloseTo(-1500.25, 6);
  });
  it("refuse ce qui n'est pas un nombre", () => {
    expect(Number.isNaN(nombreSaisi("abc"))).toBe(true);
    expect(Number.isNaN(nombreSaisi(""))).toBe(true);
    expect(Number.isNaN(nombreSaisi(null))).toBe(true);
  });
  it("zéro reste zéro (et non NaN)", () => {
    expect(nombreSaisi("0")).toBe(0);
  });
});

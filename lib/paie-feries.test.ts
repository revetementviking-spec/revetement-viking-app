import { describe, it, expect } from "vitest";
import {
  FERIES_PAYES_DEPUIS, feriesPayesQC, feriesPayesEntre, fenetreReference,
  baseReferenceFerie, indemniteFerie, feriesDeLaPeriode, lundiDeLaSemaine, resumeFeries,
  repartitionFerie,
} from "./paie-feries";
import { SEUIL_SUP_PERIODE } from "./calculs";

// Une semaine de 5 jours × 10 h, à partir d'un lundi.
function semaine(lundiISO: string, heuresParJour: number, jours = 5) {
  const [y, m, d] = lundiISO.split("-").map(Number);
  const out: { date: string; heures: number }[] = [];
  for (let i = 0; i < jours; i++) {
    const dt = new Date(y, m - 1, d + i);
    out.push({
      date: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
      heures: heuresParJour,
    });
  }
  return out;
}
// Les 4 semaines de référence de l'Action de grâce 2026 (14 sept → 11 oct).
function quatreSemaines(heuresParJour: number, jours = 5) {
  return [
    ...semaine("2026-09-14", heuresParJour, jours),
    ...semaine("2026-09-21", heuresParJour, jours),
    ...semaine("2026-09-28", heuresParJour, jours),
    ...semaine("2026-10-05", heuresParJour, jours),
  ];
}

describe("feriesPayesQC (les 8 de la LNT, pas les 11 du calendrier CCQ)", () => {
  const noms2026 = feriesPayesQC(2026).map((f) => f.nom);
  it("paie 8 jours", () => {
    expect(feriesPayesQC(2026)).toHaveLength(8);
  });
  it("exclut le 2 janvier, le Vendredi saint et le 26 décembre", () => {
    // lib/calendrier-quebec.ts en garde 11 pour l'échéancier des projets : la paie filtre,
    // elle ne touche pas au calendrier. Décision de Francis (2026-09-21).
    expect(noms2026).not.toContain("Lendemain du Jour de l'An");
    expect(noms2026).not.toContain("Vendredi saint");
    expect(noms2026).not.toContain("Lendemain de Noël");
  });
  it("garde le lundi de Pâques", () => {
    expect(noms2026).toContain("Lundi de Pâques");
  });
  it("Action de grâce 2026 = lundi 12 octobre", () => {
    expect(feriesPayesQC(2026).find((f) => f.nom === "Action de grâce")?.date).toBe("2026-10-12");
  });
  it("reporte au lundi un férié qui tombe un dimanche (24 juin et 1er juillet 2029)", () => {
    const f2029 = feriesPayesQC(2029);
    expect(f2029.find((f) => f.nom.startsWith("Fête nationale"))?.date).toBe("2029-06-25");
    expect(f2029.find((f) => f.nom.startsWith("Fête du Canada"))?.date).toBe("2029-07-02");
  });
});

describe("feriesPayesEntre (rien avant le 12 octobre 2026)", () => {
  it("la fête du Travail 2026 n'est PAS payée — elle précède la date d'application", () => {
    // Les quinzaines de l'été 2026 ont été versées sans indemnité ; on ne les recalcule pas.
    expect(FERIES_PAYES_DEPUIS).toBe("2026-10-12");
    expect(feriesPayesEntre("2026-08-24", "2026-09-20")).toEqual([]);
  });
  it("trouve l'Action de grâce dans la quinzaine du 5 au 18 octobre 2026", () => {
    const f = feriesPayesEntre("2026-10-05", "2026-10-18");
    expect(f).toHaveLength(1);
    expect(f[0].nom).toBe("Action de grâce");
  });
  it("une quinzaine sans férié ne rend rien", () => {
    expect(feriesPayesEntre("2026-10-19", "2026-11-01")).toEqual([]);
  });
  it("traverse le 31 décembre (Noël et le Jour de l'An dans la même fenêtre)", () => {
    const f = feriesPayesEntre("2026-12-21", "2027-01-03");
    expect(f.map((x) => x.date)).toEqual(["2026-12-25", "2027-01-01"]);
  });
});

describe("fenetreReference (4 semaines COMPLÈTES avant la semaine du congé)", () => {
  it("Action de grâce du 12 octobre → 14 septembre au 11 octobre", () => {
    expect(fenetreReference("2026-10-12")).toEqual({ debut: "2026-09-14", fin: "2026-10-11" });
  });
  it("la semaine du férié est exclue, même pour un férié en milieu de semaine", () => {
    // Noël 2026 tombe un vendredi : la référence s'arrête au dimanche d'avant (20 déc).
    expect(fenetreReference("2026-12-25")).toEqual({ debut: "2026-11-23", fin: "2026-12-20" });
  });
  it("lundiDeLaSemaine ramène un dimanche au lundi qui le précède", () => {
    expect(lundiDeLaSemaine("2026-10-18")).toBe("2026-10-12"); // dimanche
    expect(lundiDeLaSemaine("2026-10-12")).toBe("2026-10-12"); // lundi
  });
});

describe("indemniteFerie (le vrai 1/20, jamais un forfait de 8 h)", () => {
  it("temps plein 40 h/semaine → 8,00 h", () => {
    expect(indemniteFerie(quatreSemaines(8), "2026-10-12")).toBe(8);
  });
  it("50 h/semaine → 8,00 h quand même : la base est plafonnée à 40 h/semaine", () => {
    // « Heures supplémentaires exclues » (LNT art. 62). Sans le plafond, l'employé qui fait
    // 50 h aurait 10 h de férié et un temps plein 8 h — deux indemnités différentes pour le
    // même congé, et le surplus de banque nourrirait le congé.
    const r = baseReferenceFerie(quatreSemaines(10), "2026-10-12");
    expect(r.parSemaine).toEqual([50, 50, 50, 50]);
    expect(r.base).toBe(160);
    expect(indemniteFerie(quatreSemaines(10), "2026-10-12")).toBe(8);
  });
  it("temps partiel 24 h/semaine → 4,80 h", () => {
    expect(indemniteFerie(quatreSemaines(8, 3), "2026-10-12")).toBe(4.8);
  });
  it("rend un nombre à deux décimales, jamais arrondi à l'heure", () => {
    // Cas mesuré dans l'autre app : Youva, 6,88 h pour la fête du Travail 2026.
    const h = [
      ...semaine("2026-09-14", 6.9), ...semaine("2026-09-21", 6.9),
      ...semaine("2026-09-28", 6.9), ...semaine("2026-10-05", 6.9),
    ];
    expect(indemniteFerie(h, "2026-10-12")).toBe(6.9);
  });
  it("aucune heure dans les 4 semaines = aucun droit → 0 h", () => {
    expect(indemniteFerie([], "2026-10-12")).toBe(0);
    // Des heures uniquement APRÈS le férié ne créent pas de droit rétroactif.
    expect(indemniteFerie(semaine("2026-10-12", 10), "2026-10-12")).toBe(0);
  });
  it("ignore les heures de la semaine du férié elle-même", () => {
    const h = [...quatreSemaines(8), ...semaine("2026-10-12", 10)];
    expect(indemniteFerie(h, "2026-10-12")).toBe(8); // pas plus : la semaine du congé est hors base
  });
  it("une seule semaine travaillée sur quatre → 1/20 de cette semaine", () => {
    expect(indemniteFerie(semaine("2026-09-28", 8), "2026-10-12")).toBe(2); // 40/20
  });
});

describe("feriesDeLaPeriode (ce que la quinzaine doit créditer)", () => {
  const heures = quatreSemaines(8);
  it("crédite 8 h dans la quinzaine du 5 au 18 octobre 2026", () => {
    const r = feriesDeLaPeriode(heures, "2026-10-05", "2026-10-18");
    expect(r.heures).toBe(8);
    expect(r.detail).toHaveLength(1);
    expect(r.detail[0]).toMatchObject({ date: "2026-10-12", nom: "Action de grâce", heures: 8 });
  });
  it("ne crédite rien dans une quinzaine sans férié", () => {
    expect(feriesDeLaPeriode(heures, "2026-10-19", "2026-11-01").heures).toBe(0);
  });
  it("additionne DEUX fériés dans la même quinzaine (Noël + Jour de l'An)", () => {
    const h = [
      ...semaine("2026-11-23", 8), ...semaine("2026-11-30", 8),
      ...semaine("2026-12-07", 8), ...semaine("2026-12-14", 8),
    ];
    const r = feriesDeLaPeriode(h, "2026-12-21", "2027-01-03");
    expect(r.detail.map((f) => f.date)).toEqual(["2026-12-25", "2027-01-01"]);
    // Noël (ven. 25 déc) : référence 23 nov → 20 déc, 4 semaines pleines → 8 h.
    // Jour de l'An (ven. 1er janv) : SA référence est 30 nov → 27 déc, et la semaine du
    // 21 décembre est déjà celle du congé de Noël — aucune heure punchée. Base 120 h → 6 h.
    // Ce n'est pas un bug : le 1/20 porte sur le salaire RÉELLEMENT gagné, donc deux congés
    // rapprochés font baisser le second. Total 14 h, pas 16.
    expect(r.detail.map((f) => f.heures)).toEqual([8, 6]);
    expect(r.heures).toBe(14);
  });
  it("un employé sans droit acquis n'apparaît pas dans le détail", () => {
    const r = feriesDeLaPeriode([], "2026-10-05", "2026-10-18");
    expect(r.heures).toBe(0);
    expect(r.detail).toEqual([]);
  });
  it("une quinzaine SANS heure punchée reçoit quand même son férié (congé des Fêtes)", () => {
    // Le cas qui se perdait tout seul : personne ne travaille entre Noël et le Jour de l'An,
    // donc aucune période de paie n'existait — et l'indemnité avec elle.
    const h = [
      ...semaine("2026-11-23", 8), ...semaine("2026-11-30", 8),
      ...semaine("2026-12-07", 8), ...semaine("2026-12-14", 8),
    ];
    expect(feriesDeLaPeriode(h, "2026-12-21", "2027-01-03").heures).toBeGreaterThan(0);
  });
  it("resumeFeries écrit une ligne lisible pour le talon", () => {
    const r = feriesDeLaPeriode(heures, "2026-10-05", "2026-10-18");
    expect(resumeFeries(r.detail)).toContain("Action de grâce");
    expect(resumeFeries(r.detail)).toContain("8,00 h");
  });
});

// La règle que Francis a tranchée : l'indemnité compte dans le seuil, donc c'est elle qui
// peut pousser des heures en banque. Sans cette barrière, la règle ne vivait que dans une
// ligne de lib/db.ts, non testable — et un « petit nettoyage » l'aurait effacée.
describe("repartitionFerie (l'indemnité compte dans les 80 h de la quinzaine)", () => {
  it("80 h punchées + 8 h de férié = 80 h payées, 8 h à la banque", () => {
    const r = repartitionFerie(80, 8, SEUIL_SUP_PERIODE);
    expect(r.creditees).toBe(88);
    expect(r.payeesDoffice).toBe(80);
    expect(r.versBanque).toBe(8);
  });
  it("70 h punchées + 8 h de férié = 78 h payées, rien en banque", () => {
    const r = repartitionFerie(70, 8, SEUIL_SUP_PERIODE);
    expect(r.payeesDoffice).toBe(78);
    expect(r.versBanque).toBe(0);
  });
  it("le seuil s'atteint pile : 72 h + 8 h = 80 h payées, rien en banque", () => {
    const r = repartitionFerie(72, 8, SEUIL_SUP_PERIODE);
    expect(r.payeesDoffice).toBe(80);
    expect(r.versBanque).toBe(0);
  });
  it("sans férié, le comportement d'avant est intact (surplus = banque)", () => {
    expect(repartitionFerie(84.5, 0, SEUIL_SUP_PERIODE)).toEqual({ creditees: 84.5, payeesDoffice: 80, versBanque: 4.5 });
    expect(repartitionFerie(75, 0, SEUIL_SUP_PERIODE)).toEqual({ creditees: 75, payeesDoffice: 75, versBanque: 0 });
  });
  it("aucune heure punchée, seulement le férié (congé complet) : tout est payé", () => {
    const r = repartitionFerie(0, 6.9, SEUIL_SUP_PERIODE);
    expect(r.payeesDoffice).toBe(6.9);
    expect(r.versBanque).toBe(0);
  });
  it("ne traîne pas d'erreur de virgule flottante", () => {
    // 79,9 + 8,2 = 88,100000000000001 en flottant : la banque afficherait 8,100000000000001.
    expect(repartitionFerie(79.9, 8.2, SEUIL_SUP_PERIODE).versBanque).toBe(8.1);
  });
});

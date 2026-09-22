import { describe, it, expect } from "vitest";
import {
  normaliserTiers, normaliserNumero, clePaire, FENETRE_JOURS,
  detecterDoublonsDepenses, detecterDoublonsFacturesClient, detecterDoublons, doublonsDeLaPiece,
} from "./doublons-factures";

const dep = (id: number, fournisseur: string | null, montant: number, date: string, projet_id: number | null = 1) =>
  ({ id, fournisseur, montant, date, projet_id });
const fac = (id: number, numero: string | null, montant: number, date: string, projet_id: number | null = 1) =>
  ({ id, numero, montant, date, projet_id });

describe("normalisation des tiers et des numéros", () => {
  it("ignore la casse, les accents et les espaces en trop", () => {
    expect(normaliserTiers("  PATRICK  MORIN ")).toBe(normaliserTiers("Patrick Morin"));
    expect(normaliserTiers("Éco-Centre")).toBe(normaliserTiers("eco centre"));
  });
  it("ne rapproche PAS deux entreprises réellement différentes", () => {
    // « inc. » et « ltée » ne sont pas retirés : « Toiture Morin inc. » n'est pas
    // « Toiture Morin ltée ». Un détecteur prudent préfère manquer que confondre.
    expect(normaliserTiers("Toiture Morin inc.")).not.toBe(normaliserTiers("Toiture Morin ltée"));
    expect(normaliserTiers("BMR")).not.toBe(normaliserTiers("BMR Express"));
  });
  it("un numéro de facture se compare sans ses séparateurs", () => {
    expect(normaliserNumero("F-2026-017")).toBe(normaliserNumero("f2026017"));
    expect(normaliserNumero(null)).toBe("");
  });
  it("la clé d'une paire ne dépend pas de l'ordre de lecture", () => {
    expect(clePaire("depense", 37, 12)).toBe(clePaire("depense", 12, 37));
    expect(clePaire("depense", 12, 37)).toBe("depense:12+37");
    // Deux familles ne partagent jamais une clé, même à ids égaux.
    expect(clePaire("facture", 12, 37)).not.toBe(clePaire("depense", 12, 37));
  });
});

describe("factures de fournisseurs (dépenses)", () => {
  it("attrape la même facture saisie deux fois (à la main puis par photo)", () => {
    const r = detecterDoublonsDepenses([
      dep(1, "Patrick Morin", 842.35, "2026-09-10"),
      dep(2, "PATRICK MORIN", 842.35, "2026-09-12"),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].cle).toBe("depense:1+2");
    expect(r[0].ecart_jours).toBe(2);
    expect(r[0].raison).toContain("842,35");
  });
  it("ne dit rien quand le montant diffère, même d'un cent", () => {
    expect(detecterDoublonsDepenses([
      dep(1, "BMR", 100.00, "2026-09-10"),
      dep(2, "BMR", 100.01, "2026-09-10"),
    ])).toEqual([]);
  });
  it("ne dit rien au-delà de la fenêtre de 30 jours (achat mensuel récurrent)", () => {
    expect(detecterDoublonsDepenses([
      dep(1, "Bell", 189.99, "2026-08-01"),
      dep(2, "Bell", 189.99, "2026-09-05"),
    ])).toEqual([]);
    expect(FENETRE_JOURS).toBe(30);
  });
  it("sans fournisseur, on ne devine pas : deux achats de 20 $ ne sont pas un doublon", () => {
    expect(detecterDoublonsDepenses([
      dep(1, null, 20, "2026-09-10"),
      dep(2, "", 20, "2026-09-10"),
    ])).toEqual([]);
  });
  it("laisse tranquille les notes de crédit et les montants nuls", () => {
    expect(detecterDoublonsDepenses([
      dep(1, "BMR", -100, "2026-09-10"),
      dep(2, "BMR", -100, "2026-09-11"),
    ])).toEqual([]);
    expect(detecterDoublonsDepenses([
      dep(1, "BMR", 0, "2026-09-10"),
      dep(2, "BMR", 0, "2026-09-11"),
    ])).toEqual([]);
  });
  it("trois saisies identiques donnent trois paires — chacune se règle à part", () => {
    const r = detecterDoublonsDepenses([
      dep(1, "Éco-centre", 75, "2026-09-10"),
      dep(2, "Éco-centre", 75, "2026-09-11"),
      dep(3, "Éco-centre", 75, "2026-09-12"),
    ]);
    expect(r.map((p) => p.cle).sort()).toEqual(["depense:1+2", "depense:1+3", "depense:2+3"]);
  });
  it("un même fournisseur avec des montants variés ne déclenche rien", () => {
    expect(detecterDoublonsDepenses([
      dep(1, "Essence Shell", 80, "2026-09-10"),
      dep(2, "Essence Shell", 95.5, "2026-09-11"),
      dep(3, "Essence Shell", 72.25, "2026-09-12"),
    ])).toEqual([]);
  });
});

describe("factures client", () => {
  it("deux factures avec le MÊME NUMÉRO = doublon franc, peu importe la date", () => {
    const r = detecterDoublonsFacturesClient([
      fac(1, "F-2026-017", 12000, "2026-03-01"),
      fac(2, "f2026017", 8000, "2026-09-01"), // 6 mois plus tard, montant différent
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].certitude).toBe("franc");
    expect(r[0].raison).toContain("même numéro");
  });
  it("même chantier + même montant + dates proches = probable", () => {
    const r = detecterDoublonsFacturesClient([
      fac(1, "F-2026-020", 5000, "2026-09-10", 7),
      fac(2, "F-2026-021", 5000, "2026-09-15", 7),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].certitude).toBe("probable");
    expect(r[0].ecart_jours).toBe(5);
  });
  it("le même montant sur DEUX chantiers différents n'est pas un doublon", () => {
    expect(detecterDoublonsFacturesClient([
      fac(1, "F-1", 5000, "2026-09-10", 7),
      fac(2, "F-2", 5000, "2026-09-11", 9),
    ])).toEqual([]);
  });
  it("une paire déjà signalée par le numéro n'est pas répétée", () => {
    const r = detecterDoublonsFacturesClient([
      fac(1, "F-2026-030", 5000, "2026-09-10", 7),
      fac(2, "F-2026-030", 5000, "2026-09-12", 7),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].certitude).toBe("franc");
  });
  it("des versements d'un contrat, montants différents, ne déclenchent rien", () => {
    expect(detecterDoublonsFacturesClient([
      fac(1, "F-1", 10000, "2026-09-01", 3),
      fac(2, "F-2", 15000, "2026-09-15", 3),
      fac(3, "F-3", 5000, "2026-09-28", 3),
    ])).toEqual([]);
  });
});

describe("detecterDoublons (les deux mondes ensemble)", () => {
  const data = {
    depenses: [dep(1, "BMR", 500, "2026-09-10"), dep(2, "BMR", 500, "2026-09-11")],
    factures: [fac(10, "F-9", 500, "2026-09-10", 4), fac(11, "F-9", 500, "2026-09-10", 4)],
  };
  it("ne compare JAMAIS une dépense avec une facture client", () => {
    // Même montant, même date, mais ce sont deux sens opposés de l'argent.
    const r = detecterDoublons(data);
    expect(r).toHaveLength(2);
    for (const p of r) {
      expect(p.ids.every((id) => (p.famille === "depense" ? id < 10 : id >= 10))).toBe(true);
    }
  });
  it("met les doublons FRANCS en premier", () => {
    expect(detecterDoublons(data)[0].certitude).toBe("franc");
  });
  it("« ce n'est pas un doublon » fait taire la paire, et elle seule", () => {
    const r = detecterDoublons(data, ["depense:1+2"]);
    expect(r.map((p) => p.cle)).toEqual(["facture:10+11"]);
  });
  it("une paire ignorée le reste quand une TROISIÈME pièce arrive", () => {
    // C'est pour ça qu'on raisonne par paires : un groupe aurait changé d'identité, et
    // le « pas un doublon » d'hier serait revenu hanter l'écran aujourd'hui.
    const avec3 = { depenses: [...data.depenses, dep(3, "BMR", 500, "2026-09-12")], factures: [] };
    const cles = detecterDoublons(avec3, ["depense:1+2"]).map((p) => p.cle);
    expect(cles).not.toContain("depense:1+2");
    expect(cles.sort()).toEqual(["depense:1+3", "depense:2+3"]);
  });
});

describe("doublonsDeLaPiece (l'alerte au moment de la saisie)", () => {
  it("ne remonte que ce que la pièce qu'on vient d'entrer heurte", () => {
    const data = {
      depenses: [
        dep(1, "BMR", 500, "2026-09-10"),
        dep(2, "BMR", 500, "2026-09-11"),
        dep(3, "Patrick Morin", 300, "2026-09-10"),
        dep(4, "Patrick Morin", 300, "2026-09-10"),
      ],
      factures: [],
    };
    const r = doublonsDeLaPiece("depense", 4, data);
    expect(r).toHaveLength(1);
    expect(r[0].ids).toContain(4);
    expect(r[0].ids).toContain(3);
  });
  it("une pièce sans jumelle ne déclenche rien", () => {
    expect(doublonsDeLaPiece("depense", 1, { depenses: [dep(1, "BMR", 500, "2026-09-10")] })).toEqual([]);
  });
});

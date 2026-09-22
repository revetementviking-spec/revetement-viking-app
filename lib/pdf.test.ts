// Rendu RÉEL des PDF (contrat, soumission) côté serveur, sur des cas limites, et
// vérification de ce qui est écrit dedans. Un PDF qui « ne plante pas » ne suffit pas :
// on lit les flux de texte pour retrouver les montants attendus.
import { describe, it, expect, vi } from "vitest";
import React from "react";

// Un rendu réel prend 2 à 4 s seul, et dépasse les 5 s par défaut quand toute la suite
// tourne en parallèle sur une machine chargée (vu le 2026-09-05 : 3 « échecs » qui
// n'étaient que des délais). Le rendu reste couvert ; seul le chronomètre change.
vi.setConfig({ testTimeout: 30_000 });
import { renderToBuffer } from "@react-pdf/renderer";
import { inflateSync } from "node:zlib";
import { ContratPDF, type ContratData } from "./pdf-contrat";
import { SoumissionPDF } from "./pdf-soumission";
import { calculerSoumission } from "./calculateur";
import { MATERIAUX } from "../data/materiaux";

/** Texte des opérateurs Tj / TJ de tous les flux (dégonflés), sans les réglages de crénage.
 *  Les chaînes PDF sont entre parenthèses ; les parenthèses échappées « \( » sont gardées. */
function texteDuPdf(buf: Buffer): string {
  const src = buf.toString("latin1");
  let flux = "";
  const rx = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(src))) {
    const brut = Buffer.from(m[1], "latin1");
    try { flux += inflateSync(brut).toString("latin1") + "\n"; } catch { flux += m[1] + "\n"; }
  }
  // pdfkit (sous react-pdf) écrit les chaînes en HEXADÉCIMAL, octets WinAnsi :
  // [<52> 0 <4556ca54> …] TJ  → « R », « EVÊT »… On décode chaque <…> en latin1.
  let texte = "";
  const rxOp = /\[((?:[^\]])*)\]\s*TJ|<([0-9a-fA-F]+)>\s*Tj|\(((?:[^)\\]|\\.)*)\)\s*Tj/g;
  const hex = (h: string) => Buffer.from(h, "hex").toString("latin1");
  while ((m = rxOp.exec(flux))) {
    if (m[1] !== undefined) {
      const rxStr = /<([0-9a-fA-F]+)>|\(((?:[^)\\]|\\.)*)\)/g;
      let s: RegExpExecArray | null;
      while ((s = rxStr.exec(m[1]))) texte += s[1] !== undefined ? hex(s[1]) : s[2];
    } else if (m[2] !== undefined) texte += hex(m[2]);
    else texte += m[3];
    texte += " ";
  }
  return texte.replace(/\\\(/g, "(").replace(/\\\)/g, ")");
}
/** Ne garde que les chiffres : insensible aux espaces insécables, virgules et symboles. */
const chiffres = (s: string) => s.replace(/[^0-9]/g, "");
const nbPages = (buf: Buffer) => (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;

const CONTRAT: ContratData = {
  numero: "C-2026-017",
  charge_projet: "Francis Quinchon",
  client_nom: "Marie-Ève Côté — succession Lévesque & Fils",
  client_adresse: "1234, rue de l'Église, app. 12",
  client_ville: "Saint-Jean-sur-Richelieu",
  client_province: "Québec",
  client_code_postal: "J3B 1A1",
  client_telephone: "450-123-4567",
  client_courriel: "marie-eve.cote@exemple.ca",
  adresse_travaux: "5678, chemin du Rivage",
  ville_travaux: "Chambly",
  code_postal_travaux: "J3L 2B2",
  province_travaux: "Québec",
  date_debut_travaux: "2026-09-15",
  prix_total: 14372.45,
  notes_travaux: "Remplacement du déclin de vinyle (façade nord et est), soffites et fascias en aluminium blanc. ".repeat(40),
  signature_entrepreneur: { nom: "Francis Quinchon", date: "2026-09-04" },
};

describe("PDF du contrat (rendu réel)", () => {
  it("se rend avec accents, tiret cadratin, nom long et notes de 3 000 caractères", async () => {
    const buf = await renderToBuffer(React.createElement(ContratPDF, { c: CONTRAT }) as any);
    if (process.env.PDF_DEBUG) (await import("node:fs")).writeFileSync("./contrat-tmp.pdf", buf);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(nbPages(buf)).toBeGreaterThanOrEqual(2); // couverture + contenu (les notes débordent)
    const t = texteDuPdf(buf);
    expect(t).toContain("C-2026-017");
    expect(t).toContain("Chambly");
  });

  it("écrit trois versements qui, additionnés, redonnent EXACTEMENT le prix du contrat", async () => {
    // Règle du PDF : chaque versement = arrondi au cent de (total × % affiché), et le DERNIER
    // absorbe le reste. Avec 33,3333 % : 4 790,81 + 4 790,81 + 4 790,83 = 14 372,45.
    // (Mesuré au premier passage : j'attendais 4 790,82 — c'était mon calcul qui prenait un
    // tiers exact au lieu du pourcentage imprimé. Le PDF, lui, est cohérent avec ce qu'il
    // affiche, et c'est ça qui compte pour le client qui refait le calcul.)
    const cent = (n: number) => Math.round(n * 100) / 100;
    const pct = 33.3333;
    const v1 = cent(CONTRAT.prix_total * pct / 100), v2 = v1;
    const v3 = cent(CONTRAT.prix_total - v1 - v2);
    expect(cent(v1 + v2 + v3)).toBe(CONTRAT.prix_total);
    const buf = await renderToBuffer(React.createElement(ContratPDF, { c: CONTRAT }) as any);
    const c = chiffres(texteDuPdf(buf));
    expect(c).toContain(chiffres(CONTRAT.prix_total.toFixed(2)));
    expect(c).toContain(chiffres(v1.toFixed(2)));
    expect(c).toContain(chiffres(v3.toFixed(2)));
  });

  it("tient debout sur un contrat presque vide (prix 0, aucun champ optionnel)", async () => {
    const vide: ContratData = { numero: "", charge_projet: "", client_nom: "", date_debut_travaux: "2026-01-01", prix_total: 0 };
    const buf = await renderToBuffer(React.createElement(ContratPDF, { c: vide }) as any);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(nbPages(buf)).toBeGreaterThanOrEqual(1);
  });
});

describe("PDF du talon de paie (rendu réel)", () => {
  it("affiche le BRUT comme salaire à payer (versement au brut, DAS informative) et le montant est celui de la paie", async () => {
    const { TalonPaiePDF } = await import("./pdf-talon-paie");
    const talon = { employe: "Gabriel Quinchon", debut: "2026-08-17", fin: "2026-08-30", heures_normales: 80, heures_sup: 0,
      taux_horaire: 45, das_pct: 0.15, montant_brut: 3600, das_montant: 540, montant_net: 3060, date_paiement: "2026-09-04" };
    const buf = await renderToBuffer(React.createElement(TalonPaiePDF, { talon }) as any);
    const t = texteDuPdf(buf);
    const c = chiffres(t);
    expect(t).toContain("Salaire à payer");
    expect(c).toContain("360000");        // 3 600,00 $ : le brut, deux fois (gains + à payer)
    expect(c).not.toContain("306000");    // le NET ne doit PAS apparaître : on verse le brut
    expect(t).not.toMatch(/DAS|déduction|retenue/i);
  });
});

describe("PDF de soumission (rendu réel)", () => {
  const client = { nom: "Jean-François Bélanger", adresse: "99, rue Principale, Beloeil", telephone: "450-555-0199", courriel: "jf@exemple.ca", projet: "Revêtement complet — 2 étages" };

  it("60 lignes : plusieurs pages, et les totaux du calculateur sont ceux écrits dans le PDF", async () => {
    const codes = MATERIAUX.slice(0, 20).map((m) => m.code);
    const lignes = Array.from({ length: 60 }, (_, i) => ({ materiauCode: codes[i % codes.length], quantite: 10 + i, surplus: 10, margePct: 30 }));
    const calcul = calculerSoumission({ lignes, fraisActifs: [], fraisGestion: 0.15, appliquerTaxes: true });
    expect(calcul.total).toBeGreaterThan(0);
    // cohérence taxes Québec : tps = 5 %, tvq = 9,975 % du sous-total avant taxes
    expect(calcul.tps).toBeCloseTo(calcul.sousTotalAvantTaxes * 0.05, 2);
    expect(calcul.tvq).toBeCloseTo(calcul.sousTotalAvantTaxes * 0.09975, 2);
    expect(calcul.total).toBeCloseTo(calcul.sousTotalAvantTaxes + calcul.tps + calcul.tvq, 2);

    const buf = await renderToBuffer(React.createElement(SoumissionPDF, { client, numeroSoumission: "XP-20260904-001", date: "2026-09-04", calcul }) as any);
    expect(nbPages(buf)).toBeGreaterThanOrEqual(2);
    const c = chiffres(texteDuPdf(buf));
    expect(c).toContain(chiffres(calcul.total.toFixed(2)));
    expect(c).toContain(chiffres(calcul.tps.toFixed(2)));
    expect(c).toContain(chiffres(calcul.tvq.toFixed(2)));
  });

  it("0 ligne : se rend, total 0", async () => {
    const calcul = calculerSoumission({ lignes: [], fraisActifs: [], fraisGestion: 0.15, appliquerTaxes: true });
    expect(calcul.total).toBe(0);
    const buf = await renderToBuffer(React.createElement(SoumissionPDF, { client, numeroSoumission: "XP-VIDE", date: "2026-09-04", calcul }) as any);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

// ============================================================================
// Talon de paie avec indemnité de jour férié
// ============================================================================
// Le talon est le seul papier que l'employé reçoit. Depuis les fériés payés, les heures
// PAYÉES contiennent une indemnité qu'il n'a pas punchée : si le talon ne la nomme pas,
// l'employé qui recompte ses punchs ne retrouve pas son total et doute de sa paie.
// On vérifie donc ce qui est ÉCRIT dedans, pas seulement qu'il se rende.
describe("Talon de paie (rendu réel) — indemnité de jour férié", () => {
  it("sépare les heures travaillées de l'indemnité, et les deux montants redonnent le brut", async () => {
    const { TalonPaiePDF } = await import("./pdf-talon-paie");
    // Le cas de Francis : 80 h punchées + 8 h de férié = 80 h payées, 8 h à la banque.
    const buf = await renderToBuffer(
      React.createElement(TalonPaiePDF, {
        talon: {
          employe: "Maxime Tremblay", debut: "2026-10-05", fin: "2026-10-18",
          heures_normales: 80, heures_sup: 0, taux_horaire: 45, das_pct: 0.15,
          montant_brut: 3600, das_montant: 540, montant_net: 3060,
          date_paiement: "2026-10-23",
          heures_ferie: 8,
          feries_detail: JSON.stringify([{ date: "2026-10-12", nom: "Action de grâce", heures: 8 }]),
          banque_solde: 8,
        },
      }) as any
    );
    const t = texteDuPdf(buf);
    expect(t).toContain("Indemnité jour férié");
    expect(t).toContain("Action de grâce");
    // 72 h de travail + 8 h d'indemnité = les 80 h payées, et 3 240 $ + 360 $ = 3 600 $.
    expect(chiffres(t)).toContain(chiffres("72,00"));
    expect(chiffres(t)).toContain(chiffres("3 240,00"));
    expect(chiffres(t)).toContain(chiffres("360,00"));
    expect(chiffres(t)).toContain(chiffres("3 600,00"));
    // La banque doit être dite : sinon l'employé croit avoir perdu ces 8 heures.
    expect(t).toContain("Banque d'heures");
  });
  it("un talon sans férié ne parle pas de férié (paie ordinaire inchangée)", async () => {
    const { TalonPaiePDF } = await import("./pdf-talon-paie");
    const buf = await renderToBuffer(
      React.createElement(TalonPaiePDF, {
        talon: {
          employe: "Maxime Tremblay", debut: "2026-09-21", fin: "2026-10-04",
          heures_normales: 70, heures_sup: 0, taux_horaire: 45, das_pct: 0.15,
          montant_brut: 3150, das_montant: 472.5, montant_net: 2677.5,
        },
      }) as any
    );
    const t = texteDuPdf(buf);
    expect(t).not.toContain("Indemnité");
    expect(chiffres(t)).toContain(chiffres("70,00"));
    expect(chiffres(t)).toContain(chiffres("3 150,00"));
  });
});

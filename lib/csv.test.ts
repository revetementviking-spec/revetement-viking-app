import { describe, it, expect } from "vitest";
import { celluleCSV, neutraliserFormule, toCSV } from "./csv";

describe("CSV — injection de formule neutralisée", () => {
  it("une cellule commençant par = + - @ tab ou CR est préfixée d'une apostrophe", () => {
    expect(neutraliserFormule("=HYPERLINK(\"http://x\",\"a\")")).toBe("'=HYPERLINK(\"http://x\",\"a\")");
    expect(neutraliserFormule("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(neutraliserFormule("-1+1")).toBe("'-1+1");
    expect(neutraliserFormule("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(neutraliserFormule("\tx")).toBe("'\tx");
    expect(neutraliserFormule("\rx")).toBe("'\rx");
  });

  it("un texte ordinaire ou un nombre passe tel quel", () => {
    expect(neutraliserFormule("Pose de revêtement")).toBe("Pose de revêtement");
    expect(celluleCSV(-12.5)).toBe("-12.5");
    expect(celluleCSV(0)).toBe("0");
    expect(celluleCSV(null)).toBe("");
    expect(celluleCSV(undefined)).toBe("");
  });

  it("la neutralisation précède la mise entre guillemets (RFC 4180)", () => {
    expect(celluleCSV('=1+1,"x"')).toBe('"\'=1+1,""x"""');
    expect(celluleCSV("a,b")).toBe('"a,b"');
  });

  it("toCSV applique la règle à toutes les cellules, en-tête compris", () => {
    const csv = toCSV([{ nom: "=cmd", n: 3 }], ["nom", "n"]);
    expect(csv).toBe("﻿nom,n\r\n'=cmd,3");
  });
});

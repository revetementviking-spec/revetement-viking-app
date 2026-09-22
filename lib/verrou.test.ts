import { describe, it, expect } from "vitest";
import { creerVerrou } from "./verrou";

describe("creerVerrou — anti-double-soumission", () => {
  it("laisse passer une action seule et la marque terminée", async () => {
    const etats: boolean[] = [];
    const v = creerVerrou((o) => etats.push(o));
    let appels = 0;
    const ok = await v.executer(async () => { appels++; });
    expect(ok).toBe(true);
    expect(appels).toBe(1);
    expect(v.estOccupe()).toBe(false);
    expect(etats).toEqual([true, false]);
  });

  it("ignore le second clic tiré dans le même instant", async () => {
    const v = creerVerrou();
    let appels = 0;
    let liberer!: () => void;
    const lente = new Promise<void>((res) => { liberer = res; });
    const p1 = v.executer(async () => { appels++; await lente; });
    // Second geste AVANT que le premier ne soit terminé : refusé, action jamais lancée.
    const p2 = v.executer(async () => { appels++; });
    expect(v.estOccupe()).toBe(true);
    liberer();
    expect(await p1).toBe(true);
    expect(await p2).toBe(false);
    expect(appels).toBe(1);
  });

  it("libère le verrou même si l'action lève", async () => {
    const v = creerVerrou();
    await expect(v.executer(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(v.estOccupe()).toBe(false);
    // Le geste suivant repasse.
    expect(await v.executer(() => {})).toBe(true);
  });
});

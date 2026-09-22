import { describe, it, expect, beforeEach } from "vitest";
import {
  cleBrouillon, brouillonAdmissible, brouillonNonVide, libelleContexte,
  sauvegarderBrouillon, chargerBrouillon, effacerBrouillon,
} from "./autosave";

function installerStockage() {
  const mem = new Map<string, string>();
  const stockage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => { mem.set(k, v); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
  (globalThis as any).localStorage = stockage;
  (globalThis as any).window = { localStorage: stockage };
  return mem;
}

const base = { client: { nom: "Tremblay" }, lignes: [{ materiauCode: "X", quantite: 1 }], fraisActifs: [], fraisGestion: 0.1, appliquerTaxes: true };

describe("clé de brouillon par contexte", () => {
  it("nouvelle soumission et modification n'écrivent PAS au même endroit", () => {
    expect(cleBrouillon()).toBe("vk-draft:nouvelle");
    expect(cleBrouillon("")).toBe("vk-draft:nouvelle");
    expect(cleBrouillon("  ")).toBe("vk-draft:nouvelle");
    expect(cleBrouillon("XP-20260920-001")).toBe("vk-draft:XP-20260920-001");
  });

  it("le parcours « nouvelle » n'admet JAMAIS un brouillon qui porte un numéro", () => {
    expect(brouillonAdmissible({ numero: "XP-1" }, null)).toBe(false);
    expect(brouillonAdmissible({ numero: "" }, null)).toBe(true);
    expect(brouillonAdmissible({}, null)).toBe(true);
  });

  it("une modification n'admet que le brouillon de SON numéro", () => {
    expect(brouillonAdmissible({ numero: "XP-1" }, "XP-1")).toBe(true);
    expect(brouillonAdmissible({ numero: "XP-2" }, "XP-1")).toBe(false);
    expect(brouillonAdmissible({ numero: "" }, "XP-1")).toBe(false);
    expect(brouillonAdmissible(null, "XP-1")).toBe(false);
  });

  it("libellé pour le confirm", () => {
    expect(libelleContexte(null)).toBe("nouvelle soumission");
    expect(libelleContexte("XP-1")).toBe("la soumission XP-1");
  });

  it("brouillonNonVide : au moins une ligne ou un nom de client", () => {
    expect(brouillonNonVide({ lignes: [], client: { nom: "" } })).toBe(false);
    expect(brouillonNonVide({ lignes: [{}], client: { nom: "" } })).toBe(true);
    expect(brouillonNonVide({ lignes: [], client: { nom: "Roy" } })).toBe(true);
  });
});

describe("sauvegarde / chargement", () => {
  beforeEach(() => { installerStockage(); });

  it("un brouillon de modification n'apparaît pas dans « nouvelle », et inversement", () => {
    sauvegarderBrouillon({ ...base, numero: "XP-1" });
    expect(chargerBrouillon(null)).toBeNull();
    expect(chargerBrouillon("XP-1")?.numero).toBe("XP-1");
    expect(chargerBrouillon("XP-2")).toBeNull();

    sauvegarderBrouillon({ ...base, numero: "", client: { nom: "Nouveau" } });
    expect(chargerBrouillon(null)?.client.nom).toBe("Nouveau");
    // Les deux coexistent : sauver l'un n'a pas écrasé l'autre.
    expect(chargerBrouillon("XP-1")?.client.nom).toBe("Tremblay");
  });

  it("effacer ne touche que le contexte demandé", () => {
    sauvegarderBrouillon({ ...base, numero: "XP-1" });
    sauvegarderBrouillon({ ...base, numero: "" });
    effacerBrouillon("XP-1");
    expect(chargerBrouillon("XP-1")).toBeNull();
    expect(chargerBrouillon(null)).not.toBeNull();
    effacerBrouillon(null);
    expect(chargerBrouillon(null)).toBeNull();
  });

  it("ancienne clé unique : reprise en « nouvelle » seulement sans numéro, puis retirée", () => {
    const mem = installerStockage();
    // Le cas du bogue : l'ancien brouillon portait le numéro d'une soumission existante.
    mem.set("soumission-xpress-draft", JSON.stringify({ ...base, numero: "XP-9", timestamp: 1 }));
    expect(chargerBrouillon(null)).toBeNull();
    expect(mem.has("soumission-xpress-draft")).toBe(false);

    mem.set("soumission-xpress-draft", JSON.stringify({ ...base, numero: "", timestamp: 1 }));
    expect(chargerBrouillon(null)?.client.nom).toBe("Tremblay");
    expect(mem.has("soumission-xpress-draft")).toBe(false);
  });
});

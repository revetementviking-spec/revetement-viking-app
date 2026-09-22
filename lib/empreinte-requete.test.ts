import { describe, it, expect } from "vitest";
import { empreinteRequete } from "./empreinte-requete";

describe("empreinteRequete — anti-rejeu des formulaires web", () => {
  it("stable : même contenu → même empreinte, quel que soit l'ordre des clés", () => {
    const a = empreinteRequete({ nom: "Julie", courriel: "j@x.ca", message: "Bonjour" });
    const b = empreinteRequete({ message: "Bonjour", courriel: "j@x.ca", nom: "Julie" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("insensible à la casse, aux espaces et aux champs vides", () => {
    const a = empreinteRequete({ nom: "  Julie ", courriel: "J@X.CA", adresse: "", sujet: null, message: "Bonjour\n\n  toi" });
    const b = empreinteRequete({ nom: "julie", courriel: "j@x.ca", message: "bonjour toi" });
    expect(a).toBe(b);
  });

  it("un contenu différent donne une empreinte différente", () => {
    expect(empreinteRequete({ nom: "Julie", message: "Bonjour" })).not.toBe(empreinteRequete({ nom: "Julie", message: "Bonjour !" }));
    expect(empreinteRequete({ nom: "Julie" })).not.toBe(empreinteRequete({ courriel: "Julie" }));
  });
});

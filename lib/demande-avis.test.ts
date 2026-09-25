import { describe, it, expect } from "vitest";
import {
  messageDemandeAvis, prenomClient, urlGmailDemandeAvis, urlMailtoDemandeAvis, estAppareilTactile,
  LIEN_AVIS_GOOGLE, SUJET_DEMANDE_AVIS, VIKING_EMAIL,
} from "./demande-avis";

describe("demande d'avis Google", () => {
  it("salue le client par son prénom, ou sans nom", () => {
    expect(prenomClient("Julie Tremblay")).toBe("Julie");
    expect(prenomClient("  ")).toBe("");
    expect(messageDemandeAvis("Julie Tremblay").startsWith("Bonjour Julie,")).toBe(true);
    expect(messageDemandeAvis(null).startsWith("Bonjour,")).toBe(true);
  });

  it("le message porte le lien Google, le courriel et le téléphone Viking", () => {
    const m = messageDemandeAvis("Marc");
    expect(m).toContain(LIEN_AVIS_GOOGLE);
    expect(m).toContain(VIKING_EMAIL);
    expect(m).toContain("(438) 493-2041");
    expect(m).not.toContain("entreprisesxpress");
  });

  it("le lien mailto: ouvre l'app courriel avec destinataire, sujet et corps", () => {
    const u = urlMailtoDemandeAvis("client@exemple.ca", "Julie Tremblay");
    expect(u.startsWith("mailto:client%40exemple.ca?subject=")).toBe(true);
    expect(decodeURIComponent(u)).toContain(SUJET_DEMANDE_AVIS);
    expect(decodeURIComponent(u)).toContain("Bonjour Julie,");
  });

  it("la composition Gmail présélectionne le compte Viking et le destinataire", () => {
    const u = new URL(urlGmailDemandeAvis("client@exemple.ca", "Julie"));
    expect(u.hostname).toBe("mail.google.com");
    expect(u.searchParams.get("authuser")).toBe(VIKING_EMAIL);
    expect(u.searchParams.get("to")).toBe("client@exemple.ca");
    expect(u.searchParams.get("view")).toBe("cm");
    expect(u.searchParams.get("body")).toContain(LIEN_AVIS_GOOGLE);
  });

  it("reconnaît un téléphone (tactile + agent mobile), pas un portable tactile Windows", () => {
    expect(estAppareilTactile({ maxTouchPoints: 5, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe(true);
    expect(estAppareilTactile({ maxTouchPoints: 5, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile" })).toBe(true);
    expect(estAppareilTactile({ maxTouchPoints: 10, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(false);
    expect(estAppareilTactile({ maxTouchPoints: 0, userAgent: "Mozilla/5.0 (Macintosh)" })).toBe(false);
    expect(estAppareilTactile(undefined)).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { creerCookie, utilisateurDuCookie, authConfiguree, DUREE_SESSION_MS, signerValeur, verifierValeur, comparaisonConstante } from "./session";

const OLD_ENV = { ...process.env };

function resetEnv() {
  delete process.env.APP_PASSWORD;
  delete process.env.FRANCIS_PASSWORD;
  delete process.env.GABRIEL_PASSWORD;
  delete process.env.SESSION_SECRET;
  (process.env as any).NODE_ENV ="test";
}

beforeEach(resetEnv);
afterEach(() => { process.env = { ...OLD_ENV }; vi.useRealTimers(); });

describe("session — cookies v2 (expiration + signature)", () => {
  it("roundtrip valide → retourne l'utilisateur", async () => {
    process.env.FRANCIS_PASSWORD = "secret-francis";
    const c = await creerCookie("Francis");
    expect(c).toMatch(/^v2\|Francis\|/);
    expect(await utilisateurDuCookie(c!)).toBe("Francis");
  });

  it("signature falsifiée → refusé", async () => {
    process.env.FRANCIS_PASSWORD = "secret-francis";
    const c = (await creerCookie("Francis"))!;
    expect(await utilisateurDuCookie(c.slice(0, -4) + "0000")).toBeNull();
  });

  it("la signature lie l'utilisateur (impossible de changer Francis→Gabriel)", async () => {
    (process.env as any).NODE_ENV ="production";
    process.env.FRANCIS_PASSWORD = "pw-francis";
    process.env.GABRIEL_PASSWORD = "pw-gabriel";
    const c = (await creerCookie("Francis"))!;
    const parts = c.split("|"); parts[1] = "Gabriel"; // usurpation
    expect(await utilisateurDuCookie(parts.join("|"))).toBeNull();
  });

  it("cookie expiré → refusé", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    process.env.FRANCIS_PASSWORD = "secret-francis";
    const c = (await creerCookie("Francis"))!;
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z").getTime() + DUREE_SESSION_MS + 5000);
    expect(await utilisateurDuCookie(c)).toBeNull();
  });
});

describe("session — fail-closed en production", () => {
  it("aucun mot de passe configuré en PROD → refusé", async () => {
    (process.env as any).NODE_ENV ="production";
    expect(await utilisateurDuCookie("v2|Francis|9999999999999|deadbeef")).toBeNull();
    expect(await utilisateurDuCookie("Francis|")).toBeNull();
  });

  it("aucun mot de passe en DEV → accès libre (tolérance locale)", async () => {
    (process.env as any).NODE_ENV ="test"; // != production
    expect(await utilisateurDuCookie("Francis|")).toBe("Francis");
  });
});

describe("session — rotation via SESSION_SECRET", () => {
  it("activer SESSION_SECRET révoque les cookies v2 existants", async () => {
    process.env.FRANCIS_PASSWORD = "secret-francis";
    const c = (await creerCookie("Francis"))!; // signé SANS SESSION_SECRET
    expect(await utilisateurDuCookie(c)).toBe("Francis");
    process.env.SESSION_SECRET = "nouvelle-rotation"; // rotation
    expect(await utilisateurDuCookie(c)).toBeNull();
  });

  it("SESSION_SECRET actif → les anciens cookies v1 (sans expiration) sont refusés", async () => {
    process.env.FRANCIS_PASSWORD = "secret-francis";
    process.env.SESSION_SECRET = "rotation";
    expect(await utilisateurDuCookie("Francis|nimportequoi")).toBeNull();
  });
});

// HMAC-SHA256(pwd, "xpress-auth-v1") : ce que l'ancien code produisait pour un cookie v1.
async function signatureV1(pwd: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(pwd), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("xpress-auth-v1"));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

describe("session — formats hérités refusés (même SANS SESSION_SECRET)", () => {
  it("« ok:<mot de passe> » en clair n'ouvre plus rien, en prod comme en dev", async () => {
    process.env.APP_PASSWORD = "mdp-app";
    expect(await utilisateurDuCookie("ok:mdp-app")).toBeNull();
    (process.env as any).NODE_ENV = "production";
    expect(await utilisateurDuCookie("ok:mdp-app")).toBeNull();
  });

  it("v1 « user|HMAC » correctement signé (sans expiration) est refusé", async () => {
    process.env.APP_PASSWORD = "mdp-app";
    process.env.FRANCIS_PASSWORD = "mdp-francis";
    const sigFrancis = await signatureV1("mdp-francis");
    const sigApp = await signatureV1("mdp-app");
    for (const env of ["test", "production"]) {
      (process.env as any).NODE_ENV = env;
      expect(await utilisateurDuCookie(`Francis|${sigFrancis}`)).toBeNull();
      expect(await utilisateurDuCookie(`Gabriel|${sigApp}`)).toBeNull();
      expect(await utilisateurDuCookie(sigApp)).toBeNull(); // v1 « APP_PASSWORD seul → Gabriel »
    }
  });

  it("dev sans mot de passe : seul « user| » exact passe, pas « user|n'importe quoi »", async () => {
    expect(await utilisateurDuCookie("Francis|")).toBe("Francis");
    expect(await utilisateurDuCookie("Francis|abc")).toBeNull();
    expect(await utilisateurDuCookie("Inconnu|")).toBeNull();
    process.env.FRANCIS_PASSWORD = "x"; // dès qu'un mot de passe existe pour lui, plus de tolérance
    expect(await utilisateurDuCookie("Francis|")).toBeNull();
  });
});

describe("session — valeurs signées (cookies techniques)", () => {
  it("roundtrip par portée ; une autre portée ou une altération est refusée", async () => {
    process.env.APP_PASSWORD = "mdp";
    const s = (await signerValeur("oauth", "abc123"))!;
    expect(s).toMatch(/^abc123\|[0-9a-f]{64}$/);
    expect(await verifierValeur("oauth", s)).toBe("abc123");
    expect(await verifierValeur("maintenance", s)).toBeNull();
    expect(await verifierValeur("oauth", s.slice(0, -1) + "0")).toBeNull();
    expect(await verifierValeur("oauth", "abc123")).toBeNull();
    expect(await verifierValeur("oauth", undefined)).toBeNull();
  });

  it("changer SESSION_SECRET invalide les valeurs signées", async () => {
    process.env.APP_PASSWORD = "mdp";
    const s = (await signerValeur("oauth", "abc"))!;
    process.env.SESSION_SECRET = "rotation";
    expect(await verifierValeur("oauth", s)).toBeNull();
  });

  it("sans aucun secret : null en production, valeur nue tolérée en dev", async () => {
    (process.env as any).NODE_ENV = "production";
    expect(await signerValeur("oauth", "abc")).toBeNull();
    expect(await verifierValeur("oauth", "abc")).toBeNull();
    (process.env as any).NODE_ENV = "test";
    expect(await signerValeur("oauth", "abc")).toBe("abc");
    expect(await verifierValeur("oauth", "abc")).toBe("abc");
  });

  it("comparaisonConstante", () => {
    expect(comparaisonConstante("abc", "abc")).toBe(true);
    expect(comparaisonConstante("abc", "abd")).toBe(false);
    expect(comparaisonConstante("abc", "ab")).toBe(false);
  });
});

describe("session — authConfiguree", () => {
  it("false si aucun mot de passe, true dès qu'un est présent", async () => {
    expect(authConfiguree()).toBe(false);
    process.env.GABRIEL_PASSWORD = "x";
    expect(authConfiguree()).toBe(true);
  });
});

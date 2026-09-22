import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { publicOrigin, hoteDeConfiance, ORIGINE_PAR_DEFAUT } from "./origin";

const OLD_ENV = { ...process.env };
beforeEach(() => { delete process.env.APP_PUBLIC_URL; });
afterEach(() => { process.env = { ...OLD_ENV }; });

function req(headers: Record<string, string>, host = "app.revetementviking.com"): any {
  const h = new Headers(headers);
  return { headers: h, nextUrl: { host } };
}

describe("publicOrigin — un hôte forgé ne fabrique jamais un lien vers ailleurs", () => {
  it("APP_PUBLIC_URL prime sur tout (barre finale retirée)", () => {
    process.env.APP_PUBLIC_URL = "https://app.revetementviking.com/";
    expect(publicOrigin(req({ "x-forwarded-host": "evil.example" }))).toBe("https://app.revetementviking.com");
  });

  it("hôte transmis à nous : accepté avec son protocole", () => {
    expect(publicOrigin(req({ "x-forwarded-host": "app.revetementviking.com", "x-forwarded-proto": "https" }))).toBe("https://app.revetementviking.com");
    expect(publicOrigin(req({ host: "localhost:3000", "x-forwarded-proto": "http" }))).toBe("http://localhost:3000");
  });

  it("hôte transmis étranger : repli sur l'origine par défaut", () => {
    expect(publicOrigin(req({ "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }))).toBe(ORIGINE_PAR_DEFAUT);
    expect(publicOrigin(req({ "x-forwarded-host": "revetementviking.com.evil.example" }))).toBe(ORIGINE_PAR_DEFAUT);
    expect(publicOrigin(req({ host: "notrevetementviking.com" }))).toBe(ORIGINE_PAR_DEFAUT);
  });

  it("hoteDeConfiance", () => {
    expect(hoteDeConfiance("app.revetementviking.com")).toBe(true);
    expect(hoteDeConfiance("revetementviking.com")).toBe(true);
    expect(hoteDeConfiance("LOCALHOST:3000")).toBe(true);
    expect(hoteDeConfiance("xrevetementviking.com")).toBe(false);
    expect(hoteDeConfiance("")).toBe(false);
    expect(hoteDeConfiance(null)).toBe(false);
  });
});

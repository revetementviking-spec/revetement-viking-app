// Lit + valide le cookie d'auth, retourne le nom d'utilisateur courant
// (Gabriel ou Francis). Compatible avec les anciens cookies (legacy → Gabriel).
import type { NextRequest } from "next/server";

const LEGACY_PREFIX = "ok:";

async function signToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("xpress-auth-v1"));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function eq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function motDePasseDe(user: string): string | undefined {
  if (user === "Gabriel") return process.env.GABRIEL_PASSWORD || process.env.APP_PASSWORD;
  if (user === "Francis") return process.env.FRANCIS_PASSWORD || process.env.APP_PASSWORD;
  return undefined;
}

export async function utilisateurActif(req: NextRequest | Request): Promise<string | null> {
  const cookieHeader = "headers" in req ? req.headers.get("cookie") : null;
  let cookieValue: string | undefined;
  if ("cookies" in req && typeof (req as NextRequest).cookies?.get === "function") {
    cookieValue = (req as NextRequest).cookies.get("xpress_auth")?.value;
  } else if (cookieHeader) {
    const m = cookieHeader.match(/(?:^|;\s*)xpress_auth=([^;]+)/);
    cookieValue = m?.[1];
  }
  if (!cookieValue) return null;
  if (cookieValue.includes("|")) {
    const [user, sig] = cookieValue.split("|");
    const pwd = motDePasseDe(user);
    if (!pwd) return user || null; // dev local sans password
    const attendu = await signToken(pwd);
    return eq(sig, attendu) ? user : null;
  }
  // Legacy : HMAC seul de APP_PASSWORD → Gabriel
  const appPwd = process.env.APP_PASSWORD;
  if (!appPwd) return null;
  if (cookieValue === `${LEGACY_PREFIX}${appPwd}`) return "Gabriel";
  const attendu = await signToken(appPwd);
  return eq(cookieValue, attendu) ? "Gabriel" : null;
}

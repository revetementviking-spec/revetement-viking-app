// Authentification simple par mot de passe partagé
// Le cookie contient un HMAC du password — pas le password lui-même
// Utilise Web Crypto pour être compatible Edge Runtime
import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "xpress_auth";
const LEGACY_PREFIX = "ok:"; // compat lors du déploiement

async function signToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("xpress-auth-v1"));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const path = req.nextUrl.pathname;
  if (path === "/login" || path.startsWith("/_next") || path.startsWith("/api/login") || path === "/favicon.ico") {
    return NextResponse.next();
  }
  // Endpoint backup déclenché par cron Vercel (GET seulement, sans cookie)
  if (path === "/api/backup" && req.method === "GET") {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(COOKIE_NAME);
  const expectedToken = await signToken(password);
  const legacyValue = `${LEGACY_PREFIX}${password}`;
  const valide = cookie && (cookie.value === expectedToken || cookie.value === legacyValue);

  if (!valide) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

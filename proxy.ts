// Authentification simple par mot de passe partagé
// Le cookie contient un HMAC du password — pas le password lui-même
// Utilise Web Crypto pour être compatible Edge Runtime
import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "xpress_auth";
const LEGACY_PREFIX = "ok:"; // compat lors du déploiement

async function signToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("xpress-auth-v1"));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// CSP compatible Next.js 16 :
// - 'unsafe-inline' requis : styles Tailwind injectés + scripts d'hydratation Next
// - 'unsafe-eval' requis par certains chunks (react-pdf). Toléré : app privée mono-tenant.
// - connect-src : APIs externes (météo Open-Meteo, Google APIs pour Drive)
// - img-src data:/blob: pour aperçus base64 + binaires
const CSP = [
  "default-src 'self'",
  // Tesseract.js (OCR) charge un Worker + WASM depuis blob:/data: et son CDN
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://unpkg.com https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // OCR : tessdata + CDN ; météo Open-Meteo ; Google APIs (Drive)
  "connect-src 'self' blob: data: https://api.open-meteo.com https://geocoding-api.open-meteo.com https://*.googleapis.com https://www.googleapis.com https://unpkg.com https://cdn.jsdelivr.net https://tessdata.projectnaptha.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** Applique les headers de sécurité à TOUTE réponse (publique, authentifiée, redirection). */
function avecHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "geolocation=(self), microphone=(), camera=(self), payment=()");
  res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.headers.set("Content-Security-Policy", CSP);
  return res;
}

// Fichiers/dossiers publics qui ne doivent JAMAIS être bloqués par l'auth
// (logo de la page login, manifest PWA, service worker, icônes).
const FICHIERS_PUBLICS = new Set([
  "/manifest.json", "/sw.js", "/favicon.ico", "/logo-viking.svg", "/robots.txt",
]);
function estAssetPublic(path: string): boolean {
  if (FICHIERS_PUBLICS.has(path)) return true;
  // Icônes générées (/icon, /apple-icon) + tout .png/.svg/.ico/.webmanifest à la racine
  if (path === "/icon" || path === "/apple-icon") return true;
  if (/^\/[^/]+\.(png|svg|ico|webmanifest|woff2?)$/.test(path)) return true;
  return false;
}

export async function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  const path = req.nextUrl.pathname;

  // Pas de mot de passe configuré (dev local) → on laisse passer mais avec headers
  if (!password) return avecHeaders(NextResponse.next());

  // Routes & assets publics (toujours avec headers de sécurité)
  if (
    path === "/login" ||
    path.startsWith("/_next") ||
    path.startsWith("/api/login") ||
    estAssetPublic(path) ||
    (path === "/api/backup" && req.method === "GET") ||      // cron Vercel (route exige CRON_SECRET)
    path === "/api/ping" ||                                   // réchauffement anti cold-start (public, sans données)
    path.startsWith("/soumission/") ||                        // signature publique (token HMAC)
    path === "/api/soumission-publique"
  ) {
    return avecHeaders(NextResponse.next());
  }

  const cookie = req.cookies.get(COOKIE_NAME);
  const expectedToken = await signToken(password);
  const legacyValue = `${LEGACY_PREFIX}${password}`;
  const eq = (a: string, b: string) => {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
  };
  const valide = cookie && (eq(cookie.value, expectedToken) || eq(cookie.value, legacyValue));

  if (!valide) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", path);
    return avecHeaders(NextResponse.redirect(url));
  }

  return avecHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

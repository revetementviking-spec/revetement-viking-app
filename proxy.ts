// Authentification simple par mot de passe partagé
// Le cookie contient un HMAC du password — pas le password lui-même
// Utilise Web Crypto pour être compatible Edge Runtime
import { NextResponse, type NextRequest } from "next/server";

const COOKIE_NAME = "xpress_auth";
const LEGACY_PREFIX = "ok:"; // compat lors du déploiement

// Multi-utilisateurs : Gabriel + Francis. Chacun a son mot de passe via env vars
// (GABRIEL_PASSWORD, FRANCIS_PASSWORD). À défaut → APP_PASSWORD (rétrocompat).
// Cookie format : "user|hmac" ou (legacy) juste l'HMAC pour APP_PASSWORD → "Gabriel".
export const UTILISATEURS = ["Gabriel", "Francis"] as const;
function motDePasse(user: string): string | undefined {
  if (user === "Gabriel") return process.env.GABRIEL_PASSWORD || process.env.APP_PASSWORD;
  if (user === "Francis") return process.env.FRANCIS_PASSWORD || process.env.APP_PASSWORD;
  return undefined;
}

async function signToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("xpress-auth-v1"));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function signTokenPourUser(user: string, password: string): Promise<string> {
  return await signToken(password);
}

const eqConstantTime = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

/** Décode + valide le cookie. Retourne le nom d'utilisateur si valide, sinon null. */
export async function utilisateurDuCookie(cookieValue?: string): Promise<string | null> {
  if (!cookieValue) return null;
  // Nouveau format : "user|hmac"
  if (cookieValue.includes("|")) {
    const [user, sig] = cookieValue.split("|");
    const pwd = motDePasse(user);
    if (!pwd) return null;
    const attendu = await signToken(pwd);
    return eqConstantTime(sig, attendu) ? user : null;
  }
  // Legacy : juste l'HMAC ou "ok:<password>" → on tente avec APP_PASSWORD = Gabriel
  const appPwd = process.env.APP_PASSWORD;
  if (!appPwd) return null;
  if (cookieValue === `${LEGACY_PREFIX}${appPwd}`) return "Gabriel";
  const attendu = await signToken(appPwd);
  return eqConstantTime(cookieValue, attendu) ? "Gabriel" : null;
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
  "connect-src 'self' blob: data: https://api.open-meteo.com https://geocoding-api.open-meteo.com https://*.googleapis.com https://www.googleapis.com https://unpkg.com https://cdn.jsdelivr.net https://tessdata.projectnaptha.com https://nominatim.openstreetmap.org",
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
    (path === "/api/relances/email" && req.method === "GET") || // cron Vercel relances (CRON_SECRET aussi)
    (path === "/api/soumissions/relances-auto" && req.method === "GET") || // cron Vercel
    (path === "/api/rapport-hebdo" && req.method === "GET") || // cron Vercel hebdo
    path === "/api/ping" ||                                   // réchauffement anti cold-start (public, sans données)
    path.startsWith("/soumission/") ||                        // signature publique (token HMAC)
    path === "/api/soumission-publique" ||
    path.startsWith("/contrat/") ||                            // page publique de signature du contrat pipeline
    path.startsWith("/projet/") ||                             // mode présentation client (token HMAC)
    path === "/api/projet-public" ||                           // endpoint mode présentation
    /^\/api\/contrats-pipeline\/[^/]+(\/pdf)?$/.test(path)     // GET infos + GET PDF + POST signature (token = secret)
  ) {
    return avecHeaders(NextResponse.next());
  }

  const cookie = req.cookies.get(COOKIE_NAME);
  const user = await utilisateurDuCookie(cookie?.value);

  if (!user) {
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

// Middleware d'authentification + en-têtes de sécurité.
// La logique de session (signature, validation, expiration, rotation) vit dans
// lib/session.ts — source unique partagée avec les routes API et le login.
import { NextResponse, type NextRequest } from "next/server";
import { authConfiguree, utilisateurDuCookie, comparaisonConstante } from "@/lib/session";

const COOKIE_NAME = "xpress_auth";

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
  res.headers.set("Permissions-Policy", "geolocation=(self), microphone=(self), camera=(self), payment=()");
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

// Domaine canonique. Le domaine technique de Vercel servait l'app EN PARALLÈLE (mesuré
// en prod le 2026-09-17 : 200, aucune redirection) : deux origines = deux sessions, deux
// PWA installables, deux caches — un vieux signet sur vercel.app faisait vivre l'équipe
// sur un site « différent ». Seules les PAGES sont redirigées : les appels /api (crons
// Vercel, auto-appels internes) restent servis tels quels sur n'importe quel hôte.
const HOTE_CANONIQUE = "app.revetementviking.com";
const HOTES_A_REDIRIGER = new Set(["revetement-viking-app.vercel.app"]);

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const hote = (req.headers.get("host") || "").toLowerCase();
  if (HOTES_A_REDIRIGER.has(hote) && !path.startsWith("/api/")) {
    const url = req.nextUrl.clone();
    url.protocol = "https:";
    url.host = HOTE_CANONIQUE;
    url.port = "";
    return avecHeaders(NextResponse.redirect(url, 308));
  }

  // Aucun mot de passe configuré : accès libre en DEV uniquement. En PRODUCTION on refuse
  // le fail-open (fail-closed) : l'app reste protégée tant qu'aucun secret n'est configuré.
  // (Avant, on ne regardait que APP_PASSWORD — un déploiement avec seulement
  //  FRANCIS_PASSWORD/GABRIEL_PASSWORD laissait passer TOUTE l'app sans auth.)
  if (!authConfiguree() && process.env.NODE_ENV !== "production") {
    return avecHeaders(NextResponse.next());
  }

  // Routes & assets publics (toujours avec headers de sécurité)
  if (
    path === "/login" ||
    path === "/hors-ligne" ||                                 // page de repli du service worker (statique, sans données)
    path.startsWith("/_next") ||
    path.startsWith("/api/login") ||
    estAssetPublic(path) ||
    (path === "/api/backup" && req.method === "GET") ||      // cron Vercel (route exige CRON_SECRET)
    (path === "/api/relances/email" && req.method === "GET") || // cron Vercel relances (CRON_SECRET aussi)
    (path === "/api/soumissions/relances-auto" && req.method === "GET") || // cron Vercel
    (path === "/api/rapport-hebdo" && req.method === "GET") || // cron Vercel hebdo
    (path === "/api/prix-web/precalcul" && req.method === "GET") || // cron Vercel pre-calc prix
    (path === "/api/rappels-quotidiens" && req.method === "GET") || // cron Vercel rappels push
    path === "/api/ping" ||                                   // réchauffement anti cold-start (public, sans données)
    path.startsWith("/soumission/") ||                        // signature publique (token HMAC)
    path === "/api/soumission-publique" ||
    path.startsWith("/contrat/") ||                            // page publique de signature du contrat pipeline
    path.startsWith("/projet/") ||                             // mode présentation client (token HMAC)
    path === "/api/projet-public" ||                           // endpoint mode présentation
    (path === "/api/lead-web" && req.method === "POST") ||     // formulaires du site web (exige LEAD_WEBHOOK_SECRET)
    // Appel interne du cron de pré-calcul des prix : il s'auto-appelle en HTTP, donc sans
    // cookie — il était bloqué en 401 et le cron nocturne ne rafraîchissait RIEN depuis
    // toujours. On l'ouvre uniquement s'il porte le secret de cron.
    (path === "/api/prix-web" && req.method === "POST" && !!process.env.CRON_SECRET
      && comparaisonConstante(req.headers.get("authorization") || "", `Bearer ${process.env.CRON_SECRET}`)) ||
    // GET infos + PDF + certificat d'authentification + devis joint + POST signature
    // (le jeton EST le secret ; chaque route revérifie qu'il correspond à un contrat)
    /^\/api\/contrats-pipeline\/[^/]+(\/pdf|\/certificat|\/annexe)?$/.test(path)
  ) {
    return avecHeaders(NextResponse.next());
  }

  const cookie = req.cookies.get(COOKIE_NAME);
  const user = await utilisateurDuCookie(cookie?.value);

  if (!user) {
    // API protégée : 401 JSON plutôt qu'une redirection 307 vers du HTML
    // (sinon les fetch/<img> côté client échouent silencieusement).
    if (path.startsWith("/api/")) {
      return avecHeaders(NextResponse.json({ error: "non authentifié" }, { status: 401 }));
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    // On garde la CHAÎNE DE REQUÊTE, pas seulement le chemin. Avant, une session expirée
    // sur « Modifier la soumission XP-… » renvoyait vers /soumissions/nouveau tout court :
    // après reconnexion, l'utilisateur atterrissait sur un formulaire VIERGE et repartait
    // à zéro sans comprendre pourquoi. Idem pour toute page ouverte avec un paramètre.
    const cible = path + (req.nextUrl.search || "");
    url.search = "";                       // sinon on recopie les params de la page cible
    url.searchParams.set("redirect", cible);
    return avecHeaders(NextResponse.redirect(url));
  }

  return avecHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};

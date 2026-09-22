// Session partagée — SOURCE UNIQUE de la logique d'authentification.
// Utilisée par le middleware (proxy.ts), les routes API (authUser.ts) et le login.
// Edge-safe : uniquement Web Crypto + TextEncoder + process.env (aucune API Node,
// aucun import DB) → utilisable dans le runtime edge du middleware.

export const UTILISATEURS = ["Gabriel", "Francis"] as const;
const VERSION_V2 = "v2";

// Durée de vie d'une session (90 jours). Après, reconnexion requise.
export const DUREE_SESSION_MS = 90 * 24 * 60 * 60 * 1000;

const enProduction = () => process.env.NODE_ENV === "production";

/** Mot de passe d'un utilisateur : par-utilisateur d'abord, APP_PASSWORD en repli. */
export function motDePasse(user: string): string | undefined {
  if (user === "Gabriel") return process.env.GABRIEL_PASSWORD || process.env.APP_PASSWORD;
  if (user === "Francis") return process.env.FRANCIS_PASSWORD || process.env.APP_PASSWORD;
  return undefined;
}

/** Vrai dès qu'UN mot de passe est configuré (n'importe lequel des trois). */
export function authConfiguree(): boolean {
  return !!(process.env.APP_PASSWORD || process.env.FRANCIS_PASSWORD || process.env.GABRIEL_PASSWORD);
}

// Matériel de signature : lie la session au mot de passe de l'utilisateur ET, si présent,
// à SESSION_SECRET. Changer l'un OU l'autre révoque toutes les sessions (rotation).
function materielSignature(user: string): string | undefined {
  const pwd = motDePasse(user);
  if (!pwd) return undefined;
  return `${process.env.SESSION_SECRET || ""}::${pwd}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparaison à temps constant (anti timing-attack). Edge-safe : exportée pour le
// middleware, qui ne peut pas importer lib/rateLimit.ts (dépend de la base).
export function comparaisonConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const eq = comparaisonConstante;

// Matériel de signature de l'APPLICATION (pas d'un utilisateur) : sert aux cookies
// techniques (état OAuth, contournement de maintenance). Lié à SESSION_SECRET et aux mots
// de passe : changer l'un d'eux invalide ces cookies, comme les sessions.
function materielApplication(): string | undefined {
  const parts = [process.env.SESSION_SECRET, process.env.APP_PASSWORD, process.env.FRANCIS_PASSWORD, process.env.GABRIEL_PASSWORD];
  if (!parts.some(Boolean)) return undefined;
  return parts.map((p) => p || "").join("::");
}

/** Signe une valeur de cookie technique : « valeur|sig ». `portee` distingue les usages
 *  (une signature d'état OAuth ne vaut pas pour le contournement de maintenance).
 *  Sans aucun secret : null en production (fail-closed), valeur nue en dev. */
export async function signerValeur(portee: string, valeur: string): Promise<string | null> {
  if (/[|]/.test(valeur)) return null;
  const mat = materielApplication();
  if (!mat) return enProduction() ? null : valeur;
  return `${valeur}|${await hmacHex(mat, `${portee}:${valeur}`)}`;
}

/** Vérifie une valeur signée par signerValeur ; retourne la valeur nue ou null. */
export async function verifierValeur(portee: string, signee?: string | null): Promise<string | null> {
  if (!signee) return null;
  const mat = materielApplication();
  if (!mat) return enProduction() ? null : (signee.includes("|") ? null : signee);
  const parts = signee.split("|");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [valeur, sig] = parts;
  return eq(sig, await hmacHex(mat, `${portee}:${valeur}`)) ? valeur : null;
}

/** Crée la valeur de cookie signée, format v2 avec expiration. Null si pas de mot de passe. */
export async function creerCookie(user: string): Promise<string | null> {
  const mat = materielSignature(user);
  if (!mat) return null;
  const exp = Date.now() + DUREE_SESSION_MS;
  const sig = await hmacHex(mat, `${VERSION_V2}:${user}:${exp}`);
  return `${VERSION_V2}|${user}|${exp}|${sig}`;
}

/** Valide un cookie et retourne l'utilisateur (ou null). Seul le format v2 est accepté.
 *  Les formats hérités (« ok:<mot de passe> » en clair et « user|sig » v1 sans expiration)
 *  sont retirés : les cookies v2 existent depuis 2026-07-12 avec 90 j de vie, donc aucun
 *  cookie ancien encore valide ne peut subsister — et le cookie « ok:<mdp> » exposait le
 *  mot de passe lui-même. */
export async function utilisateurDuCookie(cookieValue?: string): Promise<string | null> {
  if (!cookieValue) return null;

  // Format v2 : "v2|user|exp|sig"
  if (cookieValue.startsWith(VERSION_V2 + "|")) {
    const parts = cookieValue.split("|");
    if (parts.length !== 4) return null; // format strict : aucun segment en trop
    const [, user, expStr, sig] = parts;
    if (!user || !expStr || !sig) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Date.now()) return null; // expiré
    const mat = materielSignature(user);
    if (!mat) return enProduction() ? null : user || null; // pas de mdp : dev seulement
    return eq(sig, await hmacHex(mat, `${VERSION_V2}:${user}:${exp}`)) ? user : null;
  }

  // Dev local, utilisateur sans mot de passe : le login pose « user| » (voir /api/login).
  // Jamais en production (fail-closed).
  if (!enProduction()) {
    const parts = cookieValue.split("|");
    const [user, reste] = parts;
    if (parts.length === 2 && reste === "" && UTILISATEURS.includes(user as any) && !motDePasse(user)) return user;
  }
  return null;
}

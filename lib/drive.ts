// Client Google Drive — supporte 2 modes d'auth :
// 1. OAuth utilisateur (refresh_token stocké en DB) — pour My Drive personnel (15GB gratuit)
// 2. Service Account JWT — pour Shared Drive (Workspace)
import crypto from "crypto";
import { getOAuthTokens, saveOAuthTokens } from "@/lib/db";

const SCOPES = "https://www.googleapis.com/auth/drive.file"; // accès aux fichiers créés par l'app
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";

interface SAJson {
  client_email: string;
  private_key: string;
}

let _cachedSAToken: { token: string; expires: number } | null = null;

function getSA(): SAJson | null {
  const raw = process.env.GOOGLE_SA_JSON;
  if (!raw) return null;
  try { return JSON.parse(raw) as SAJson; } catch { return null; }
}

function getFolderId(): string | null {
  return process.env.GOOGLE_DRIVE_FOLDER_ID || null;
}

const ROOT_FOLDER_NAME = process.env.GOOGLE_DRIVE_ROOT_NAME || "Viking";
let _cachedRootOAuth: string | null = null;

/** En mode OAuth user, trouve/crée le dossier "Viking" à la racine de My Drive.
 *  En mode SA, retourne GOOGLE_DRIVE_FOLDER_ID. */
async function getRootFolderId(mode: "oauth_user" | "service_account"): Promise<string> {
  if (mode === "service_account") {
    const id = getFolderId();
    if (!id) throw new Error("GOOGLE_DRIVE_FOLDER_ID manquant");
    return id;
  }
  if (_cachedRootOAuth) return _cachedRootOAuth;
  const q = `name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;
  const r = await driveFetch(`/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
  if (r.files && r.files.length > 0) { _cachedRootOAuth = r.files[0].id; return _cachedRootOAuth!; }
  const c = await driveFetch("/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: ROOT_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder", parents: ["root"] }),
  });
  _cachedRootOAuth = c.id;
  return c.id;
}

async function getCurrentMode(): Promise<"oauth_user" | "service_account" | null> {
  if (getOAuthClientCreds()) {
    const t = await getOAuthTokens("google_drive");
    if (t?.refresh_token) return "oauth_user";
  }
  if (driveSAConfigure()) return "service_account";
  return null;
}

async function resolveRootFolder(): Promise<string> {
  const mode = await getCurrentMode();
  if (!mode) throw new Error("Aucune auth Drive");
  return await getRootFolderId(mode);
}

function getOAuthClientCreds(): { id: string; secret: string; redirect: string } | null {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const secret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirect = process.env.GOOGLE_OAUTH_REDIRECT_URI || "https://app.revetementviking.com/api/drive/auth/callback";
  if (!id || !secret) return null;
  return { id, secret, redirect };
}

export function driveOAuthConfigure(): boolean {
  return !!getOAuthClientCreds() && !!getFolderId();
}

export function driveSAConfigure(): boolean {
  return !!getSA() && !!getFolderId();
}

export async function driveEstActif(): Promise<boolean> {
  // OAuth user connecté ? (pas besoin de folder env var — auto-créé "Viking" à la racine)
  if (getOAuthClientCreds()) {
    const t = await getOAuthTokens("google_drive");
    if (t?.refresh_token) return true;
  }
  // SA fallback (nécessite folder env var)
  return driveSAConfigure();
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** OAuth User : URL de consent pour démarrer le flow */
export function buildOAuthAuthUrl(): string {
  const creds = getOAuthClientCreds();
  if (!creds) throw new Error("OAuth client non configuré");
  const params = new URLSearchParams({
    client_id: creds.id,
    redirect_uri: creds.redirect,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent", // force refresh_token à chaque fois
  });
  return `${AUTH_URL}?${params.toString()}`;
}

/** Exchange authorization code → tokens */
export async function exchangeCodeForTokens(code: string): Promise<{ refresh_token?: string; access_token: string; expires_in: number }> {
  const creds = getOAuthClientCreds();
  if (!creds) throw new Error("OAuth client non configuré");
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: creds.id,
      client_secret: creds.secret,
      redirect_uri: creds.redirect,
      grant_type: "authorization_code",
    }),
  });
  if (!r.ok) throw new Error(`Token exchange ${r.status}: ${await r.text()}`);
  return await r.json();
}

/** Rafraîchit l'access_token via refresh_token */
async function refreshAccessToken(refresh_token: string): Promise<{ access_token: string; expires_in: number }> {
  const creds = getOAuthClientCreds();
  if (!creds) throw new Error("OAuth client non configuré");
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token,
      client_id: creds.id,
      client_secret: creds.secret,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`Refresh token ${r.status}: ${await r.text()}`);
  return await r.json();
}

/** Récupère un access_token valide (utilise OAuth user en priorité, puis SA) */
async function getAccessToken(): Promise<string> {
  // 1. Essai OAuth user
  if (getOAuthClientCreds()) {
    const t = await getOAuthTokens("google_drive");
    if (t?.refresh_token) {
      // Token toujours valide ?
      if (t.access_token && t.expires_at && t.expires_at > Date.now() + 60_000) {
        return t.access_token;
      }
      // Refresh
      const refreshed = await refreshAccessToken(t.refresh_token);
      const expires = Date.now() + (refreshed.expires_in * 1000);
      await saveOAuthTokens({
        provider: "google_drive",
        access_token: refreshed.access_token,
        refresh_token: t.refresh_token,
        expires_at: expires,
        user_email: t.user_email,
      });
      return refreshed.access_token;
    }
  }

  // 2. Fallback Service Account JWT
  if (_cachedSAToken && _cachedSAToken.expires > Date.now() + 60_000) return _cachedSAToken.token;
  const sa = getSA();
  if (!sa) throw new Error("Aucun moyen d'authentification Drive configuré");
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify({
    iss: sa.client_email, scope: SCOPES, aud: TOKEN_URL, exp: now + 3600, iat: now,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = base64UrlEncode(signer.sign(sa.private_key));
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${payload}.${signature}`,
    }),
  });
  if (!r.ok) throw new Error(`SA Token ${r.status}: ${await r.text()}`);
  const d = await r.json();
  _cachedSAToken = { token: d.access_token, expires: Date.now() + (d.expires_in * 1000) };
  return d.access_token;
}

async function driveFetch(path: string, opts: RequestInit = {}, baseUrl: string = DRIVE_API): Promise<any> {
  const token = await getAccessToken();
  const r = await fetch(`${baseUrl}${path}`, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Drive ${r.status}: ${txt.slice(0, 500)}`);
  }
  return await r.json();
}

export async function trouverOuCreerSousDossier(nom: string, parent?: string): Promise<string> {
  const parentId = parent || await resolveRootFolder();
  if (!parentId) throw new Error("Pas de dossier parent");
  const nomEscape = nom.replace(/'/g, "\\'");
  const q = `name='${nomEscape}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`;
  const r = await driveFetch(`/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
  if (r.files && r.files.length > 0) return r.files[0].id;
  const c = await driveFetch("/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nom, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  return c.id;
}

export async function uploaderFichier(params: {
  nom: string;
  dataUrl: string;
  dossierId?: string;
  description?: string;
}): Promise<{ id: string; webViewLink: string }> {
  const dossier = params.dossierId || await resolveRootFolder();
  if (!dossier) throw new Error("Dossier non spécifié");
  const match = params.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("dataUrl invalide");
  const mimeType = match[1];
  const buf = Buffer.from(match[2], "base64");
  const metadata = {
    name: params.nom,
    parents: [dossier],
    description: params.description || "Sauvegardé depuis Revêtement Viking App",
  };
  const boundary = `vk-${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    buf,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const token = await getAccessToken();
  const r = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: body as any,
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Drive upload ${r.status}: ${txt.slice(0, 500)}`);
  }
  const d = await r.json();
  return { id: d.id, webViewLink: d.webViewLink };
}

/** Crée OU met à jour un Google Sheet (identifié par son nom) dans le dossier racine
 *  Viking, à partir d'un contenu CSV. Garde un seul fichier qu'on rafraîchit. */
export async function sauvegarderClasseurCSV(nom: string, csv: string, description?: string): Promise<{ id: string; webViewLink: string; cree: boolean }> {
  const dossier = await resolveRootFolder();
  if (!dossier) throw new Error("Dossier Drive introuvable");
  const csvBuf = Buffer.from(csv, "utf-8");
  const nomEscape = nom.replace(/'/g, "\\'");
  // Existe déjà ?
  const q = `name='${nomEscape}' and '${dossier}' in parents and trashed=false`;
  const liste = await driveFetch(`/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
  const existant = (liste.files || [])[0];
  const token = await getAccessToken();
  if (existant) {
    // Met à jour le contenu du Sheet existant (réimport du CSV)
    const r = await fetch(`${DRIVE_UPLOAD}/files/${existant.id}?uploadType=media&fields=id,webViewLink`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/csv" },
      body: csvBuf as any,
    });
    if (!r.ok) throw new Error(`Drive maj Sheet ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const d = await r.json();
    return { id: d.id, webViewLink: d.webViewLink, cree: false };
  }
  // Crée un nouveau Google Sheet à partir du CSV (Drive convertit text/csv → spreadsheet)
  const metadata = {
    name: nom, parents: [dossier],
    mimeType: "application/vnd.google-apps.spreadsheet",
    description: description || "Sauvegarde des heures — Revêtement Viking",
  };
  const boundary = `vk-${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/csv\r\n\r\n`),
    csvBuf,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const r = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body: body as any,
  });
  if (!r.ok) throw new Error(`Drive création Sheet ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  return { id: d.id, webViewLink: d.webViewLink, cree: true };
}

export async function testerConnexion(): Promise<{ ok: boolean; mode?: string; folder?: string; email?: string; message?: string }> {
  const oauthCreds = getOAuthClientCreds();
  const oauthTokens = oauthCreds ? await getOAuthTokens("google_drive") : null;
  const mode = oauthTokens?.refresh_token ? "oauth_user" : (driveSAConfigure() ? "service_account" : null);
  if (!mode) return {
    ok: false,
    message: oauthCreds ? "OAuth Client configuré — connecte ton Drive maintenant" : "Aucune auth configurée"
  };
  try {
    const folderId = await getRootFolderId(mode);
    const info = await driveFetch(`/files/${folderId}?fields=id,name,webViewLink`);
    return { ok: true, mode, folder: info.name, email: oauthTokens?.user_email || getSA()?.client_email };
  } catch (e: any) {
    return { ok: false, mode, message: e.message };
  }
}

export async function listerDossier(dossierId?: string): Promise<any[]> {
  const id = dossierId || await resolveRootFolder().catch(() => null);
  if (!id) return [];
  const r = await driveFetch(`/files?q='${id}' in parents and trashed=false&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&pageSize=50&orderBy=modifiedTime desc`);
  return r.files || [];
}

/** Indique si l'OAuth Client est configuré dans Vercel */
export function oauthClientConfigure(): boolean {
  return !!getOAuthClientCreds();
}

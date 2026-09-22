import { NextResponse } from "next/server";
import { buildOAuthAuthUrl, oauthClientConfigure, genererEtatOAuth } from "@/lib/drive";
import { signerValeur } from "@/lib/session";

export const dynamic = "force-dynamic";

// Nom et portée du cookie d'état OAuth — mêmes valeurs dans /callback (une route Next ne
// peut pas exporter autre chose que ses handlers).
const COOKIE_ETAT_OAUTH = "drive_oauth_state";
const PORTEE_ETAT_OAUTH = "oauth-drive";

export async function GET() {
  if (!oauthClientConfigure()) {
    return NextResponse.json({ error: "GOOGLE_OAUTH_CLIENT_ID/SECRET non configurés dans Vercel" }, { status: 400 });
  }
  // `state` aléatoire : envoyé à Google ET gardé dans un cookie signé, HttpOnly. Le
  // callback exige que les deux correspondent (anti-CSRF du flux OAuth).
  const etat = genererEtatOAuth();
  const signee = await signerValeur(PORTEE_ETAT_OAUTH, etat);
  if (!signee) {
    return NextResponse.json({ error: "Impossible de signer l'état OAuth (aucun secret de session configuré)" }, { status: 500 });
  }
  const res = NextResponse.redirect(buildOAuthAuthUrl(etat));
  res.cookies.set(COOKIE_ETAT_OAUTH, signee, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // envoyé sur la navigation de retour depuis Google (top-level GET)
    maxAge: 10 * 60, // le consentement Google se fait en quelques minutes
    path: "/api/drive/auth",
  });
  return res;
}

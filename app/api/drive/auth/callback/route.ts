import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/drive";
import { saveOAuthTokens } from "@/lib/db";
import { verifierValeur, comparaisonConstante } from "@/lib/session";

export const dynamic = "force-dynamic";

// Mêmes constantes que /start (dupliquées : une route Next ne peut exporter que ses handlers
// et quelques options ; les importer depuis /start casserait le type-check des routes).
const COOKIE_ETAT_OAUTH = "drive_oauth_state";
const PORTEE_ETAT_OAUTH = "oauth-drive";
const OPTIONS_COOKIE = { path: "/api/drive/auth" };

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const erreur = req.nextUrl.searchParams.get("error");
  const etatRecu = req.nextUrl.searchParams.get("state") || "";

  // Anti-CSRF : le `state` renvoyé par Google doit être celui posé au départ du flux
  // (cookie signé, HttpOnly). Absent, altéré ou différent → 400, jamais d'échange de code.
  const etatAttendu = await verifierValeur(PORTEE_ETAT_OAUTH, req.cookies.get(COOKIE_ETAT_OAUTH)?.value);
  const etatValide = !!etatAttendu && !!etatRecu && comparaisonConstante(etatRecu, etatAttendu);
  const effacerEtat = (res: NextResponse) => { res.cookies.set(COOKIE_ETAT_OAUTH, "", { ...OPTIONS_COOKIE, maxAge: 0 }); return res; };
  if (!etatValide) {
    return effacerEtat(NextResponse.json(
      { error: "État OAuth absent ou invalide — relance la connexion Google Drive depuis /sync." },
      { status: 400 },
    ));
  }

  if (erreur) {
    return effacerEtat(NextResponse.redirect(`${req.nextUrl.origin}/sync?drive=error&msg=${encodeURIComponent(erreur)}`));
  }
  if (!code) {
    return effacerEtat(NextResponse.redirect(`${req.nextUrl.origin}/sync?drive=error&msg=no_code`));
  }
  try {
    const t = await exchangeCodeForTokens(code);
    const expires_at = Date.now() + (t.expires_in * 1000);
    // Récupérer email utilisateur via tokeninfo (optionnel)
    let user_email: string | undefined;
    try {
      const ui = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo`, {
        headers: { Authorization: `Bearer ${t.access_token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (ui.ok) {
        const j = await ui.json();
        user_email = j.email;
      }
    } catch {}
    await saveOAuthTokens({
      provider: "google_drive",
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at,
      user_email,
    });
    return effacerEtat(NextResponse.redirect(`${req.nextUrl.origin}/sync?drive=connected`));
  } catch (e: any) {
    // Le détail (réponse Google, extrait de jeton) reste dans le journal serveur.
    console.error("[/api/drive/auth/callback]", e);
    return effacerEtat(NextResponse.redirect(`${req.nextUrl.origin}/sync?drive=error&msg=${encodeURIComponent("échange du code refusé — voir le journal serveur")}`));
  }
}

import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/drive";
import { saveOAuthTokens } from "@/lib/db";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const erreur = req.nextUrl.searchParams.get("error");
  if (erreur) {
    return NextResponse.redirect(`${req.nextUrl.origin}/sync?drive=error&msg=${encodeURIComponent(erreur)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${req.nextUrl.origin}/sync?drive=error&msg=no_code`);
  }
  try {
    const t = await exchangeCodeForTokens(code);
    const expires_at = Date.now() + (t.expires_in * 1000);
    // Récupérer email utilisateur via tokeninfo (optionnel)
    let user_email: string | undefined;
    try {
      const ui = await fetch(`https://www.googleapis.com/oauth2/v2/userinfo`, {
        headers: { Authorization: `Bearer ${t.access_token}` },
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
    return NextResponse.redirect(`${req.nextUrl.origin}/sync?drive=connected`);
  } catch (e: any) {
    return NextResponse.redirect(`${req.nextUrl.origin}/sync?drive=error&msg=${encodeURIComponent(e.message)}`);
  }
}

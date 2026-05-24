import { NextResponse } from "next/server";
import { buildOAuthAuthUrl, oauthClientConfigure } from "@/lib/drive";

export async function GET() {
  if (!oauthClientConfigure()) {
    return NextResponse.json({ error: "GOOGLE_OAUTH_CLIENT_ID/SECRET non configurés dans Vercel" }, { status: 400 });
  }
  const url = buildOAuthAuthUrl();
  return NextResponse.redirect(url);
}

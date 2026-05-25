import { NextRequest, NextResponse } from "next/server";
import { journaliser } from "@/lib/audit";

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

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return NextResponse.json({ ok: true });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
  const ua = req.headers.get("user-agent") || undefined;
  if (password !== expected) {
    await journaliser("auth.login_echec", { description: "Mauvais mot de passe", ip, user_agent: ua });
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }
  await journaliser("auth.login_ok", { description: "Connexion réussie", ip, user_agent: ua });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("xpress_auth", await signToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365 * 10,
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("xpress_auth");
  return res;
}

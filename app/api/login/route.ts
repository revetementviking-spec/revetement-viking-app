import { NextRequest, NextResponse } from "next/server";
import { journaliser } from "@/lib/audit";
import { rateLimitDepasse, timingSafeEqual } from "@/lib/rateLimit";

const UTILISATEURS = ["Gabriel", "Francis"] as const;

async function signToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("xpress-auth-v1"));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function motDePasseDe(user: string): string | undefined {
  if (user === "Gabriel") return process.env.GABRIEL_PASSWORD || process.env.APP_PASSWORD;
  if (user === "Francis") return process.env.FRANCIS_PASSWORD || process.env.APP_PASSWORD;
  return undefined;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const password: string = body.password || "";
  // Compat : si pas de "user" fourni, on tente Gabriel (APP_PASSWORD) — rétrocompat
  const user: string = body.user || "Gabriel";
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
  const ua = req.headers.get("user-agent") || undefined;

  if (!UTILISATEURS.includes(user as any)) {
    return NextResponse.json({ error: "Utilisateur inconnu" }, { status: 400 });
  }

  if (await rateLimitDepasse("auth.login_echec", ip, 5, 15)) {
    await journaliser("auth.login_echec", { description: `Bloqué (rate limit) — ${user}`, ip, user_agent: ua });
    return NextResponse.json({ error: "Trop d'essais. Réessaie dans 15 minutes." }, { status: 429 });
  }

  const attendu = motDePasseDe(user);
  if (!attendu) {
    // Aucun mot de passe configuré (dev local) → accès libre
    const res = NextResponse.json({ ok: true, user });
    res.cookies.set("xpress_auth", `${user}|`, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365 * 10, path: "/" });
    return res;
  }
  if (!timingSafeEqual(password, attendu)) {
    await journaliser("auth.login_echec", { description: `Mauvais mot de passe — ${user}`, ip, user_agent: ua });
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }
  await journaliser("auth.login_ok", { description: `Connexion réussie — ${user}`, ip, user_agent: ua });
  const sig = await signToken(attendu);
  const res = NextResponse.json({ ok: true, user });
  res.cookies.set("xpress_auth", `${user}|${sig}`, {
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

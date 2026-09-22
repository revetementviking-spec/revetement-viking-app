import { ipClient } from "@/lib/ip";
import { NextRequest, NextResponse } from "next/server";
import { journaliser } from "@/lib/audit";
import { rateLimitDepasse, rateLimitDepasseParDescription, timingSafeEqual } from "@/lib/rateLimit";
import { UTILISATEURS, motDePasse, creerCookie, DUREE_SESSION_MS } from "@/lib/session";

// Description journalisée à chaque mauvais mot de passe : c'est sur elle (exacte) que
// compte la limite par utilisateur.
const descMauvaisMdp = (user: string) => `Mauvais mot de passe — ${user}`;
// Limite par NOM D'UTILISATEUR, toutes IP confondues : 20 échecs / heure.
const MAX_ECHECS_UTILISATEUR = 20;
const FENETRE_UTILISATEUR_MIN = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const password: string = body.password || "";
  // Compat : si pas de "user" fourni, on tente Gabriel (APP_PASSWORD) — rétrocompat
  const user: string = body.user || "Gabriel";
  // Jamais le PREMIER x-forwarded-for : le client le choisit, donc il choisissait la clé de
  // la limite de tentatives et la contournait à chaque essai. Voir lib/ip.ts.
  const ip = ipClient(req);
  const ua = req.headers.get("user-agent") || undefined;

  // Rate-limit EN TÊTE : couvre tous les essais, y compris « utilisateur inconnu »
  // (qui renvoyaient 400 avant le throttle → endpoint abusable sans limite).
  if (await rateLimitDepasse("auth.login_echec", ip, 5, 15)) {
    await journaliser("auth.login_echec", { description: `Bloqué (rate limit) — ${user}`, ip, user_agent: ua });
    return NextResponse.json({ error: "Trop d'essais. Réessaie dans 15 minutes." }, { status: 429, headers: { "Retry-After": String(15 * 60) } });
  }

  if (!UTILISATEURS.includes(user as any)) {
    await journaliser("auth.login_echec", { description: `Utilisateur inconnu — ${user}`, ip, user_agent: ua });
    return NextResponse.json({ error: "Utilisateur inconnu" }, { status: 400 });
  }

  // Second compteur, par utilisateur : le compteur par IP seul se contourne en changeant
  // d'adresse à chaque essai (chaque IP repart à zéro sur le même compte).
  if (await rateLimitDepasseParDescription("auth.login_echec", descMauvaisMdp(user), MAX_ECHECS_UTILISATEUR, FENETRE_UTILISATEUR_MIN)) {
    await journaliser("auth.login_echec", { description: `Bloqué (limite par utilisateur) — ${user}`, ip, user_agent: ua });
    return NextResponse.json({ error: "Trop d'essais pour cet utilisateur. Réessaie dans une heure." }, { status: 429, headers: { "Retry-After": String(FENETRE_UTILISATEUR_MIN * 60) } });
  }

  const attendu = motDePasse(user);
  if (!attendu) {
    // Aucun mot de passe configuré. En PRODUCTION : on refuse (fail-closed) au lieu
    // d'émettre un cookie « libre » qui ouvrirait toute l'app. En dev local : accès libre.
    if (process.env.NODE_ENV === "production") {
      await journaliser("auth.login_echec", { description: `Auth non configurée côté serveur — ${user}`, ip, user_agent: ua });
      return NextResponse.json({ error: "Authentification non configurée sur le serveur (mot de passe manquant)." }, { status: 503 });
    }
    const res = NextResponse.json({ ok: true, user });
    res.cookies.set("xpress_auth", `${user}|`, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 365, path: "/" });
    return res;
  }
  if (!timingSafeEqual(password, attendu)) {
    await journaliser("auth.login_echec", { description: descMauvaisMdp(user), ip, user_agent: ua });
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }
  await journaliser("auth.login_ok", { description: `Connexion réussie — ${user}`, ip, user_agent: ua });
  // Cookie v2 signé, avec expiration (90 j) + révocable via SESSION_SECRET.
  const valeur = await creerCookie(user);
  if (!valeur) return NextResponse.json({ error: "Impossible de créer la session." }, { status: 500 });
  const res = NextResponse.json({ ok: true, user });
  res.cookies.set("xpress_auth", valeur, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: Math.floor(DUREE_SESSION_MS / 1000), // le cookie expire en même temps que la session signée
    path: "/",
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("xpress_auth");
  return res;
}

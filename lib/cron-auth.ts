// Authentification des routes de cron (Vercel Cron → `Authorization: Bearer CRON_SECRET`).
//
// Un seul endroit pour les cinq crons. Fail-closed : sans CRON_SECRET, la route est
// DÉSACTIVÉE (503) plutôt que laissée ouverte. Comparaison en temps constant : un
// `!==` sur le secret laisse fuir sa longueur et ses premiers caractères par le temps
// de réponse.
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "@/lib/rateLimit";

/** Le porteur d'un en-tête Authorization est-il le secret de cron ? (sans effet de bord) */
export function estAppelCron(req: { headers: { get(n: string): string | null } }): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  return timingSafeEqual(auth, `Bearer ${secret}`);
}

/** Renvoie une réponse d'erreur (503 sans secret, 401 si faux) ou `null` si l'appel est
 *  autorisé. Usage : `const refus = verifierCron(req); if (refus) return refus;` */
export function verifierCron(req: NextRequest): NextResponse | null {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET non configuré — route désactivée" }, { status: 503 });
  }
  if (!estAppelCron(req)) return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  return null;
}

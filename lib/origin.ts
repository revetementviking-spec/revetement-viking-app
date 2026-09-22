import type { NextRequest } from "next/server";

/** Origine de repli quand rien de fiable n'est configuré ni transmis. */
export const ORIGINE_PAR_DEFAUT = "https://app.revetementviking.com";

/** Un hôte transmis n'est cru que s'il est à nous (ou local). Sinon, un en-tête
 *  `x-forwarded-host` forgé ferait pointer un lien de signature envoyé par courriel vers
 *  un domaine étranger (empoisonnement du lien). Le port est toléré (localhost:3000). */
export function hoteDeConfiance(host: string | null | undefined): boolean {
  const h = String(host || "").trim().toLowerCase().replace(/:\d+$/, "");
  if (!h) return false;
  if (h === "localhost" || h === "127.0.0.1") return true;
  return h === "revetementviking.com" || h.endsWith(".revetementviking.com");
}

/** Origine publique fiable pour construire un lien absolu envoyé par courriel (ex. lien de
 *  signature de contrat). Priorité : APP_PUBLIC_URL (override explicite, à configurer sur
 *  Vercel si le domaine public diffère du Host vu par le serveur) > en-têtes forwarded posés
 *  par le proxy/edge > Host brut — à condition que l'hôte soit le nôtre ; sinon, repli sur
 *  ORIGINE_PAR_DEFAUT. Ne dépend jamais de l'en-tête "Origin", absent sur beaucoup de
 *  requêtes non-CORS. */
export function publicOrigin(req: NextRequest): string {
  const override = process.env.APP_PUBLIC_URL;
  if (override) return override.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
  const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || req.headers.get("host") || req.nextUrl.host;
  if (!hoteDeConfiance(host)) return ORIGINE_PAR_DEFAUT;
  return `${proto}://${host}`;
}

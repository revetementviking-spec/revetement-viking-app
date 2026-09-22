import { NextRequest, NextResponse } from "next/server";
import { verifierCron } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
// Six recherches web IA en parallèle : bien au-delà des 60 s par défaut d'une fonction Vercel.
export const maxDuration = 300;

/** Cron nuit (vercel.json : `0 3 * * *` = 3 h UTC, soit 23 h la veille à Montréal l'été
 *  (UTC−4) et 22 h l'hiver (UTC−5)) : pré-calcul les prix des matériaux les plus utilisés.
 *  Force un refresh du cache pour qu'ils soient frais le matin. */
const PRODUITS_USUELS = [
  { nom: "Maibec Statera cèdre blanc 6\"", code: "MAIBEC-STATERA-6", fournisseur: "Maibec" },
  { nom: "Canexel Ridgewood 8.25\"", code: "CANEXEL-RIDGE-825", fournisseur: "Canexel" },
  { nom: "James Hardie HardiePlank 8.25\"", code: "HARDIE-PLANK-825", fournisseur: "James Hardie" },
  { nom: "Tyvek HomeWrap rouleau", code: "TYVEK-HOMEWRAP", fournisseur: "DuPont" },
  { nom: "Gentek Sentinel Plus D4D vinyle", code: "GENTEK-SENT-D4D", fournisseur: "Gentek" },
  { nom: "Calfeutrant OSI Quad Max 295ml", code: "OSI-QUAD-MAX", fournisseur: "OSI" },
];

export async function GET(req: NextRequest) {
  // Fail-closed, comme les 4 autres crons : sans CRON_SECRET la route est DÉSACTIVÉE.
  // Ici c'est d'autant plus important que chaque passage déclenche 6 appels à l'API
  // Anthropic avec recherche web — donc un coût réel si la route est abusée en boucle.
  const refus = verifierCron(req);
  if (refus) return refus;
  const cronSecret = process.env.CRON_SECRET!;

  const base = req.nextUrl.origin;
  // Les 6 appels partent EN PARALLÈLE (avant : en série, ~6 × 30 s, au-delà du délai de
  // la fonction). allSettled : un produit qui échoue ne prive pas les autres du cache.
  const reponses = await Promise.allSettled(PRODUITS_USUELS.map(async (p) => {
    // On transmet le secret de cron : sans lui, cet appel interne partait sans cookie et
    // se faisait refuser en 401 par le proxy — la boucle tournait chaque nuit pour rien
    // et le cache de prix n'était jamais rafraîchi.
    const r = await fetch(`${base}/api/prix-web`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cronSecret}` },
      body: JSON.stringify({ ...p, force: true }),
      signal: AbortSignal.timeout(120_000),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`);
    return { code: p.code, ok: true, prix: d.prix_moyen_estime, mis_en_cache: d.mis_en_cache };
  }));
  const resultats = reponses.map((r, i) => r.status === "fulfilled"
    ? r.value
    : { code: PRODUITS_USUELS[i].code, ok: false, erreur: (r.reason as any)?.message || String(r.reason) });
  // Chaque échec partiel est journalisé côté serveur : « ok:true, 4 réussis » ne dit pas
  // lesquels ont manqué ni pourquoi.
  for (const r of resultats) if (!r.ok) console.error(`[prix-web/precalcul] ${r.code} : ${(r as any).erreur}`);
  // `ok:true` était renvoyé même quand les 6 appels avaient échoué : l'échec du cron était
  // donc invisible. On remonte le compte réel, et 500 si RIEN n'a abouti.
  const reussis = resultats.filter((r) => r.ok).length;
  const corps = { ok: reussis > 0, traite: resultats.length, reussis, echecs: resultats.length - reussis, resultats };
  return NextResponse.json(corps, { status: reussis > 0 ? 200 : 500 });
}

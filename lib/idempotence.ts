// Idempotence des POST d'écriture (heures, dépenses, extras, photos).
//
// Contrat avec les écrans : l'écran envoie un en-tête `X-Idempotence-Cle` (chaîne de
// 1 à 64 caractères, générée une fois par formulaire soumis). Si la clé a déjà servi
// à une réponse 2xx, on renvoie la MÊME réponse (même statut, même corps) sans rien
// réexécuter : un double clic, un réessai réseau ou un onglet qui rejoue la requête
// ne crée pas deux lignes. Sans en-tête, la route se comporte comme avant.
//
// La réponse n'est gardée que si elle est 2xx : un refus (400/409) doit pouvoir être
// corrigé puis renvoyé avec la même clé. Les entrées de plus de 7 jours sont purgées
// à l'occasion (au plus une purge par heure et par instance).
import { NextRequest, NextResponse } from "next/server";
import { lireIdempotence, ecrireIdempotence, purgerIdempotence } from "@/lib/db";

export const EN_TETE_IDEMPOTENCE = "X-Idempotence-Cle";
const LONGUEUR_MAX = 64;
const RX_CLE = /^[A-Za-z0-9._:-]{1,64}$/;

/** Clé fournie par l'écran, validée. `null` si absente ; lève si mal formée. */
export function cleIdempotence(req: { headers: { get(n: string): string | null }; nextUrl?: { pathname: string } }): string | null {
  const brute = (req.headers.get(EN_TETE_IDEMPOTENCE) || "").trim();
  if (!brute) return null;
  if (brute.length > LONGUEUR_MAX || !RX_CLE.test(brute)) {
    throw Object.assign(new Error(`${EN_TETE_IDEMPOTENCE} invalide (1 à ${LONGUEUR_MAX} caractères : lettres, chiffres, . _ : -)`), { code: "CLE_IDEMPOTENCE_INVALIDE" });
  }
  // Préfixée par le chemin : la même clé envoyée à deux routes différentes ne rejoue
  // jamais la réponse de l'autre.
  const chemin = req.nextUrl?.pathname || "";
  return `${chemin}|${brute}`;
}

let _dernierePurge = 0;
const INTERVALLE_PURGE_MS = 60 * 60 * 1000;

/** Exécute `handler` sous idempotence. Voir l'en-tête du fichier. */
export async function avecIdempotence(req: NextRequest, handler: () => Promise<NextResponse>): Promise<NextResponse> {
  let cle: string | null;
  try {
    cle = cleIdempotence(req);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "clé d'idempotence invalide" }, { status: 400 });
  }
  if (!cle) return handler();

  const deja = await lireIdempotence(cle);
  if (deja) {
    return new NextResponse(deja.corps, {
      status: deja.statut,
      headers: { "Content-Type": "application/json; charset=utf-8", "X-Idempotence-Rejouee": "1" },
    });
  }

  const res = await handler();
  if (res.status >= 200 && res.status < 300) {
    // Le corps est lu sur un clone : la réponse d'origine repart intacte au client.
    const corps = await res.clone().text();
    await ecrireIdempotence(cle, res.status, corps).catch((e) => console.warn("[idempotence] écriture échouée :", e?.message || e));
    if (Date.now() - _dernierePurge > INTERVALLE_PURGE_MS) {
      _dernierePurge = Date.now();
      purgerIdempotence().catch(() => {});
    }
  }
  return res;
}

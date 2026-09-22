// Rate limit basé sur journal_activite — pas besoin de Redis/Upstash
import { db, initDb } from "@/lib/db";

/** Compte les échecs `type` depuis le IP `ip` dans les `minutes` dernières minutes.
 *  Retourne true si la limite est atteinte. */
export async function rateLimitDepasse(type: string, ip: string | undefined, max: number, minutes: number): Promise<boolean> {
  // Sans IP, la limite DISPARAISSAIT (« return false ») : tous les essais passaient. On
  // regroupe plutôt les inconnus sous une même clé — plus strict, jamais absent.
  if (!ip) ip = "inconnue";
  await initDb();
  const c = db();
  const seuil = new Date(Date.now() - minutes * 60_000).toISOString();
  const r = await c.execute({
    sql: `SELECT COUNT(*) as n FROM journal_activite WHERE type = ? AND ip = ? AND date > ?`,
    args: [type, ip, seuil],
  });
  const n = Number((r.rows[0] as any)?.n || 0);
  return n >= max;
}

/** Second compteur, par DESCRIPTION exacte (ex. « Mauvais mot de passe — Francis »),
 *  toutes IP confondues : un attaquant qui change d'adresse à chaque essai contournait
 *  le compteur par IP. Retourne true si la limite est atteinte. */
export async function rateLimitDepasseParDescription(type: string, description: string, max: number, minutes: number): Promise<boolean> {
  await initDb();
  const seuil = new Date(Date.now() - minutes * 60_000).toISOString();
  const r = await db().execute({
    sql: `SELECT COUNT(*) as n FROM journal_activite WHERE type = ? AND description = ? AND date > ?`,
    args: [type, description, seuil],
  });
  return Number((r.rows[0] as any)?.n || 0) >= max;
}

// Anti-rejeu : une empreinte (SHA-256 d'un corps normalisé) mémorisée dans le journal,
// sous un type dédié, le temps d'une fenêtre. Même mécanisme que les compteurs ci-dessus :
// la purge du journal (90 j / 10 000 lignes) borne la table sans rien de plus à entretenir.
const TYPE_EMPREINTE = "requete.empreinte";

/** Vrai si cette empreinte a déjà été vue pour cette `portee` dans les `heures` dernières heures. */
export async function empreinteDejaVue(portee: string, empreinte: string, heures: number): Promise<boolean> {
  await initDb();
  const seuil = new Date(Date.now() - heures * 3_600_000).toISOString();
  const r = await db().execute({
    sql: `SELECT 1 AS un FROM journal_activite WHERE type = ? AND ref_type = ? AND ref_id = ? AND date > ? LIMIT 1`,
    args: [TYPE_EMPREINTE, portee, empreinte, seuil],
  });
  return r.rows.length > 0;
}

/** Mémorise une empreinte (à appeler APRÈS avoir traité la requête). Ne lève jamais. */
export async function memoriserEmpreinte(portee: string, empreinte: string, ip?: string): Promise<void> {
  try {
    await initDb();
    await db().execute({
      sql: `INSERT INTO journal_activite (date, type, ref_type, ref_id, description, ip) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [new Date().toISOString(), TYPE_EMPREINTE, portee, empreinte, `Empreinte ${portee}`, ip || null],
    });
  } catch (e) {
    console.warn("[empreinte] échec de mémorisation:", (e as Error).message);
  }
}

/** Comparaison constant-time pour éviter timing attacks sur tokens. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

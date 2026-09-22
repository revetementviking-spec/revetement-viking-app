// Journal des erreurs (Sentry-light) : table dédiée `erreurs_client`, alimentée par
// error.tsx via /api/log-erreur et, côté serveur, par les jobs qui n'ont pas de session
// (le cron de sauvegarde s'auto-appelait en HTTP vers /api/log-erreur et mourait en 401 :
// l'alerte d'échec n'arrivait jamais).
import { db, initDb } from "@/lib/db";

export interface ErreurClient {
  message?: string;
  stack?: string;
  digest?: string;
  path?: string;
  userAgent?: string;
}

/** Enregistre une erreur. Ne lève jamais (best-effort) ; retourne true si écrit. */
export async function enregistrerErreurClient(e: ErreurClient): Promise<boolean> {
  try {
    await initDb();
    const c = db();
    await c.execute({
      sql: `CREATE TABLE IF NOT EXISTS erreurs_client (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        message TEXT,
        stack TEXT,
        digest TEXT,
        path TEXT,
        user_agent TEXT
      )`,
      args: [],
    });
    await c.execute({
      sql: `INSERT INTO erreurs_client (date, message, stack, digest, path, user_agent) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        new Date().toISOString(),
        String(e.message || "").slice(0, 1000),
        String(e.stack || "").slice(0, 4000),
        e.digest ? String(e.digest).slice(0, 200) : null,
        e.path ? String(e.path).slice(0, 500) : null,
        e.userAgent ? String(e.userAgent).slice(0, 200) : null,
      ],
    });
    return true;
  } catch (err) {
    console.warn("[erreurs_client] échec d'enregistrement:", (err as Error).message);
    return false;
  }
}

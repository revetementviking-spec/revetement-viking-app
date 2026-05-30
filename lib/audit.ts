// Journal d'activité enterprise-grade
// Tout changement métier critique passe ici → traçabilité complète

import { db, initDb } from "@/lib/db";
import { utilisateurActif } from "@/lib/authUser";

export type ActiviteType =
  | "soumission.creee"
  | "soumission.modifiee"
  | "soumission.statut_change"
  | "soumission.envoyee"
  | "soumission.acceptee"
  | "soumission.refusee"
  | "soumission.facturee"
  | "soumission.supprimee"
  | "soumission.dupliquee"
  | "client.cree"
  | "client.modifie"
  | "client.supprime"
  | "projet.cree"
  | "projet.statut_change"
  | "projet.supprime"
  | "contrat.cree"
  | "contrat.signe"
  | "heures.ajoutees"
  | "heures.modifiees"
  | "heures.supprimees"
  | "depense.ajoutee"
  | "depense.modifiee"
  | "depense.supprimee"
  | "paye.marquee_payee"
  | "backup.execute"
  | "drive.connecte"
  | "drive.deconnecte"
  | "auth.login_ok"
  | "auth.login_echec";

export interface ActiviteOpts {
  ref_type?: string;
  ref_id?: string | number;
  description?: string;
  avant?: any;
  apres?: any;
  ip?: string;
  user_agent?: string;
  utilisateur?: string;          // Gabriel | Francis (explicite)
  req?: Request;                 // alternative : on extrait l'utilisateur du cookie
}

// Compteur en mémoire pour déclencher la purge périodique sans I/O à chaque appel
let _depuisDernierePurge = 0;
const PURGE_CHAQUE = 500; // tous les 500 inserts, on tente une purge

async function purgerSiNecessaire(): Promise<void> {
  if (_depuisDernierePurge++ < PURGE_CHAQUE) return;
  _depuisDernierePurge = 0;
  try {
    const c = db();
    // 1. Supprime les entrées de plus de 90 jours
    const seuil = new Date(Date.now() - 90 * 86400_000).toISOString();
    await c.execute({ sql: `DELETE FROM journal_activite WHERE date < ?`, args: [seuil] });
    // 2. Si > 10 000 lignes, garde uniquement les 10 000 plus récentes
    const r = await c.execute("SELECT COUNT(*) as n FROM journal_activite");
    const n = Number((r.rows[0] as any).n || 0);
    if (n > 10000) {
      await c.execute(`DELETE FROM journal_activite WHERE id NOT IN (SELECT id FROM journal_activite ORDER BY id DESC LIMIT 10000)`);
    }
  } catch (e) {
    console.warn("[audit purge]", (e as Error).message);
  }
}

/** Log une activité — fire-and-forget, ne throw jamais. */
export async function journaliser(type: ActiviteType, opts: ActiviteOpts = {}): Promise<void> {
  try {
    await initDb();
    const c = db();
    let utilisateur = opts.utilisateur || null;
    if (!utilisateur && opts.req) {
      try { utilisateur = await utilisateurActif(opts.req as any); } catch { /* ignore */ }
    }
    await c.execute({
      sql: `INSERT INTO journal_activite (date, type, ref_type, ref_id, description, avant, apres, ip, user_agent, utilisateur) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        new Date().toISOString(),
        type,
        opts.ref_type || null,
        opts.ref_id ? String(opts.ref_id) : null,
        opts.description || null,
        opts.avant ? JSON.stringify(opts.avant).slice(0, 2000) : null,
        opts.apres ? JSON.stringify(opts.apres).slice(0, 2000) : null,
        opts.ip || null,
        opts.user_agent ? opts.user_agent.slice(0, 200) : null,
        utilisateur,
      ],
    });
    // Purge périodique non bloquante
    purgerSiNecessaire().catch(() => {});
  } catch (e) {
    console.warn("[audit] échec journalisation:", (e as Error).message);
  }
}

/** Récupère les N dernières activités, filtrable par type ou ref. */
export async function listerActivites(filtres: { type?: string; ref_type?: string; ref_id?: string; limit?: number } = {}): Promise<any[]> {
  await initDb();
  const c = db();
  const where: string[] = [];
  const args: any[] = [];
  if (filtres.type) { where.push("type = ?"); args.push(filtres.type); }
  if (filtres.ref_type) { where.push("ref_type = ?"); args.push(filtres.ref_type); }
  if (filtres.ref_id) { where.push("ref_id = ?"); args.push(filtres.ref_id); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(filtres.limit || 200, 1000);
  const r = await c.execute({ sql: `SELECT * FROM journal_activite ${w} ORDER BY id DESC LIMIT ${limit}`, args });
  return r.rows as any[];
}

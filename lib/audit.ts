// Journal d'activité enterprise-grade
// Tout changement métier critique passe ici → traçabilité complète

import { db, initDb } from "@/lib/db";

export type ActiviteType =
  | "soumission.creee"
  | "soumission.modifiee"
  | "soumission.statut_change"
  | "soumission.envoyee"
  | "soumission.acceptee"
  | "soumission.refusee"
  | "soumission.facturee"
  | "soumission.supprimee"
  | "client.cree"
  | "client.modifie"
  | "client.supprime"
  | "projet.cree"
  | "projet.statut_change"
  | "projet.supprime"
  | "contrat.cree"
  | "contrat.signe"
  | "heures.ajoutees"
  | "depense.ajoutee"
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
}

/** Log une activité — fire-and-forget, ne throw jamais. */
export async function journaliser(type: ActiviteType, opts: ActiviteOpts = {}): Promise<void> {
  try {
    await initDb();
    const c = db();
    await c.execute({
      sql: `INSERT INTO journal_activite (date, type, ref_type, ref_id, description, avant, apres, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
    });
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

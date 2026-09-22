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
  // Avis interne envoyé à la fermeture d'un chantier. L'échec est journalisé aussi :
  // l'envoi est détaché de la requête, donc sans trace il serait muet.
  | "projet.avis_courriel"
  | "projet.avis_courriel_echec"
  // Avis interne quand un client répond (accepte / refuse) à une soumission en ligne.
  | "soumission.avis_courriel"
  | "soumission.avis_courriel_echec"
  | "projet.document_ajoute"
  | "projet.document_supprime"
  | "projet.supprime"
  | "contrat.cree"
  | "contrat.signe"
  | "heures.ajoutees"
  | "heures.modifiees"
  | "heures.supprimees"
  | "depense.ajoutee"
  | "depense.modifiee"
  | "depense.supprimee"
  | "extra.ajoute"
  | "extra.modifie"
  | "extra.charge"
  | "extra.rouvert"
  | "extra.supprime"
  | "facture.creee"
  | "facture.encaissee"
  | "facture.paiement_annule"
  | "facture.supprimee"
  | "contrat.supprime"
  // Contrats en ligne (pipeline_contrats) : création et suppression d'un brouillon.
  | "contrat_pipeline.cree"
  | "contrat_pipeline.supprime"
  | "paye.marquee_payee"
  | "paye.banque_appliquee"
  | "paye.periode_supprimee"
  // Fiche employé : changement de taux, de DAS ou de statut actif (avant/après).
  | "employe.modifie"
  | "photo.supprimee"
  | "inventaire.supprime"
  | "assurance.supprimee"
  | "catalogue.desactive"
  // Issue de chaque envoi de courriel (lib/email.ts) : destinataire masqué, sujet, id ou erreur.
  | "courriel.envoye"
  | "courriel.echec"
  // Recherche de prix web forcée (`force:true`) : sert de compteur au plafond 20/h par IP (lib/rateLimit.ts).
  | "prix_web.force"
  // Empreinte anti-rejeu d'une requête acceptée (lib/rateLimit.ts) ; purgée après 24 h.
  | "requete.empreinte"
  | "backup.execute"
  | "backup.restaure"
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

// Purge : PAS de compteur en mémoire ici. « Tous les 500 inserts » ne se produisait jamais
// sur serverless (chaque instance repart de zéro) : le journal grossissait sans fin.
// La purge (90 jours / 10 000 lignes, empreintes 24 h, idempotence 7 jours) est faite en
// un seul lot par le cron quotidien : purgerJournaux() dans lib/db.ts, appelée par
// app/api/rappels-quotidiens/route.ts.

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
  // Entier borné [1, 1000] garanti avant interpolation dans le SQL (défense en profondeur).
  const limit = Math.min(Math.max(1, Math.floor(Number(filtres.limit) || 200)), 1000);
  const r = await c.execute({ sql: `SELECT * FROM journal_activite ${w} ORDER BY id DESC LIMIT ${limit}`, args });
  return r.rows as any[];
}

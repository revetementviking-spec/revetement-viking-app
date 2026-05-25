// Base de données — fonctionne en local (file:) ou en cloud (Turso libsql:)
// Si TURSO_URL est définie → utilise Turso, sinon SQLite local
import { createClient, type Client as LibsqlClient, type ResultSet } from "@libsql/client";
import path from "path";
import fs from "fs";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "soumissions.db");

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let _client: LibsqlClient | null = null;
let _initialized = false;

function getLibsqlClient(): LibsqlClient {
  if (_client) return _client;
  const tursoUrl = process.env.TURSO_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl) {
    _client = createClient({ url: tursoUrl, authToken: tursoToken });
  } else {
    _client = createClient({ url: `file:${DB_PATH}` });
  }
  return _client;
}

async function exec(sql: string, args: any[] = []): Promise<ResultSet> {
  return await getLibsqlClient().execute({ sql, args });
}

async function execMany(sqls: string[]): Promise<void> {
  for (const s of sqls.filter((x) => x.trim())) {
    await getLibsqlClient().execute(s);
  }
}

async function tryExec(sql: string): Promise<void> {
  try { await getLibsqlClient().execute(sql); } catch (e: any) {
    // Ignore "duplicate column" errors lors de migrations idempotentes
    if (!/(duplicate column|already exists)/i.test(e?.message || "")) throw e;
  }
}

export async function initDb() {
  if (_initialized) return;
  _initialized = true;
  // Migrations idempotentes pour les anciennes installations
  await tryExec("ALTER TABLE clients ADD COLUMN statut TEXT DEFAULT 'prospect'");
  await tryExec("ALTER TABLE clients ADD COLUMN source TEXT");
  await tryExec("ALTER TABLE clients ADD COLUMN tags TEXT");
  await tryExec("ALTER TABLE clients ADD COLUMN asana_gid TEXT");
  await tryExec("ALTER TABLE clients ADD COLUMN asana_modifie_le TEXT");
  await tryExec("ALTER TABLE depenses_projet ADD COLUMN recu_data TEXT");
  await tryExec("ALTER TABLE depenses_projet ADD COLUMN recu_type TEXT");
  await tryExec("ALTER TABLE projets ADD COLUMN prix_contrat REAL");
  await tryExec("ALTER TABLE projets ADD COLUMN facture_finale_data TEXT");
  await tryExec("ALTER TABLE projets ADD COLUMN facture_finale_type TEXT");
  // Migrations employés : RH complète
  await tryExec("ALTER TABLE employes ADD COLUMN telephone TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN courriel TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN adresse TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN date_naissance TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN nas TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN date_embauche TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN poste TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN contact_urgence_nom TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN contact_urgence_lien TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN contact_urgence_tel TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN specimen_cheque_data TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN specimen_cheque_type TEXT");
  await tryExec("ALTER TABLE employes ADD COLUMN notes TEXT");
  // Drive sync status sur photos
  await tryExec("ALTER TABLE photos_chantier ADD COLUMN drive_file_id TEXT");
  await tryExec("ALTER TABLE photos_chantier ADD COLUMN drive_sync_error TEXT");
  // Audit trail / journal activité (Big Four-grade)
  await tryExec(`CREATE TABLE IF NOT EXISTS journal_activite (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    ref_type TEXT, ref_id TEXT,
    description TEXT,
    avant TEXT, apres TEXT,
    ip TEXT, user_agent TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_journal_date ON journal_activite(date DESC)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_journal_type ON journal_activite(type)");
  await tryExec(`CREATE TABLE IF NOT EXISTS oauth_tokens (
    id INTEGER PRIMARY KEY,
    provider TEXT UNIQUE NOT NULL,
    access_token TEXT, refresh_token TEXT,
    expires_at INTEGER, scope TEXT,
    user_email TEXT, date_creation TEXT
  )`);
  await execMany([
    `CREATE TABLE IF NOT EXISTS soumissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE NOT NULL,
      date_creation TEXT NOT NULL,
      date_modif TEXT NOT NULL,
      client_nom TEXT, client_adresse TEXT, client_telephone TEXT, client_courriel TEXT,
      projet TEXT, statut TEXT DEFAULT 'brouillon', total REAL,
      heures_estimees REAL DEFAULT 0, heures_reelles REAL,
      date_envoi TEXT, date_acceptation TEXT, date_refus TEXT, date_facturation TEXT,
      payload_json TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_soumissions_date ON soumissions(date_creation DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_soumissions_statut ON soumissions(statut)`,
    `CREATE TABLE IF NOT EXISTS rendements_reels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      soumission_numero TEXT NOT NULL, categorie TEXT NOT NULL,
      quantite REAL NOT NULL, heures_estimees REAL NOT NULL, heures_reelles REAL NOT NULL,
      date_completion TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL, courriel TEXT, telephone TEXT, adresse TEXT, notes TEXT,
      statut TEXT DEFAULT 'prospect', source TEXT, tags TEXT,
      date_creation TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS interactions_client (
      id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL,
      type TEXT NOT NULL, date TEXT NOT NULL, sujet TEXT, note TEXT,
      fait_par TEXT, date_saisie TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS taches_client (
      id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER,
      projet_id INTEGER, titre TEXT NOT NULL, description TEXT,
      date_due TEXT, priorite INTEGER DEFAULT 3,
      statut TEXT DEFAULT 'a_faire', assigne_a TEXT,
      date_creation TEXT NOT NULL, date_completion TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS contrats (
      id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT UNIQUE NOT NULL,
      client_id INTEGER, projet_id INTEGER, soumission_numero TEXT,
      titre TEXT NOT NULL, date_emission TEXT NOT NULL, date_debut_travaux TEXT,
      date_fin_prevue TEXT, montant_avant_taxes REAL, taxes_pct REAL DEFAULT 14.975,
      montant_total REAL, depot_pct REAL DEFAULT 30, depot_montant REAL,
      conditions TEXT, garantie TEXT, statut TEXT DEFAULT 'brouillon',
      signe_par_client INTEGER DEFAULT 0, date_signature TEXT,
      payload_json TEXT, date_creation TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_inter_client ON interactions_client(client_id, date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_taches_statut ON taches_client(statut, date_due)`,
    `CREATE INDEX IF NOT EXISTS idx_contrats_client ON contrats(client_id)`,
    `CREATE TABLE IF NOT EXISTS paies_periodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, employe TEXT NOT NULL,
      debut TEXT NOT NULL, fin TEXT NOT NULL,
      heures_normales REAL DEFAULT 0, heures_sup REAL DEFAULT 0,
      taux_horaire REAL, das_pct REAL DEFAULT 0.15,
      montant_brut REAL, das_montant REAL, montant_net REAL,
      paye INTEGER DEFAULT 0, date_paiement TEXT, note TEXT,
      date_creation TEXT NOT NULL,
      UNIQUE(employe, debut, fin)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_paies_emp ON paies_periodes(employe, debut DESC)`,
    `CREATE TABLE IF NOT EXISTS photos_chantier (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projet_id INTEGER NOT NULL, date TEXT NOT NULL,
      employes TEXT, photo_data TEXT NOT NULL, photo_type TEXT,
      description TEXT, date_saisie TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_photos_projet ON photos_chantier(projet_id, date DESC)`,
    `CREATE TABLE IF NOT EXISTS projets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER, nom TEXT NOT NULL, adresse_chantier TEXT, description TEXT,
      statut TEXT DEFAULT 'actif',
      date_debut TEXT, date_fin_prevue TEXT, date_fin_reelle TEXT,
      soumission_numero TEXT, budget_estime REAL, heures_estimees REAL,
      date_creation TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS heures_projet (
      id INTEGER PRIMARY KEY AUTOINCREMENT, projet_id INTEGER NOT NULL,
      date TEXT NOT NULL, heures REAL NOT NULL, description TEXT, employe TEXT,
      taux_horaire REAL DEFAULT 90, date_saisie TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS factures_projet (
      id INTEGER PRIMARY KEY AUTOINCREMENT, projet_id INTEGER NOT NULL,
      numero TEXT, montant REAL NOT NULL, date TEXT NOT NULL, description TEXT,
      payee INTEGER DEFAULT 0, date_paiement TEXT, date_saisie TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS depenses_projet (
      id INTEGER PRIMARY KEY AUTOINCREMENT, projet_id INTEGER NOT NULL,
      date TEXT NOT NULL, montant REAL NOT NULL, fournisseur TEXT, description TEXT,
      categorie TEXT, date_saisie TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS employes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL UNIQUE, taux_horaire REAL NOT NULL,
      das_pct REAL DEFAULT 0.15, actif INTEGER DEFAULT 1,
      date_creation TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS outils (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL, categorie TEXT, etat TEXT DEFAULT 'bon',
      localisation TEXT, numero_serie TEXT, prix_achat REAL,
      date_achat TEXT, notes TEXT,
      ajoute_par TEXT, date_ajout TEXT NOT NULL,
      modifie_par TEXT, date_modif TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS bibliotheque_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date_ajout TEXT NOT NULL,
      adresse TEXT, type_materiau TEXT,
      parement_pi2 REAL, fascia_pi_lin REAL, soffite_pi2 REAL, nb_etages INTEGER,
      total_soumission REAL, heures_reelles REAL,
      hover_data_json TEXT, soumission_data_json TEXT, photos_json TEXT,
      notes_chantier TEXT, complexite TEXT
    )`,
  ]);
}

// Helpers retournent rows / first row
async function all<T = any>(sql: string, args: any[] = []): Promise<T[]> {
  await initDb();
  const r = await exec(sql, args);
  return r.rows as unknown as T[];
}
async function one<T = any>(sql: string, args: any[] = []): Promise<T | null> {
  const rows = await all<T>(sql, args);
  return rows[0] || null;
}
async function run(sql: string, args: any[] = []): Promise<{ lastInsertRowid: number; rowsAffected: number }> {
  await initDb();
  const r = await exec(sql, args);
  return { lastInsertRowid: Number(r.lastInsertRowid || 0), rowsAffected: r.rowsAffected };
}

// === TYPES ===
export type Statut = "brouillon" | "envoyee" | "acceptee" | "refusee" | "facturee";

export interface SoumissionDB {
  id: number; numero: string; date_creation: string; date_modif: string;
  client_nom: string; client_adresse: string; client_telephone: string; client_courriel: string;
  projet: string; statut: Statut; total: number;
  heures_estimees: number; heures_reelles: number | null;
  date_envoi: string | null; date_acceptation: string | null;
  date_refus: string | null; date_facturation: string | null;
  payload_json: string;
}

// === SOUMISSIONS ===
export async function genererNumero(): Promise<string> {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  const r = await one<{ n: number }>("SELECT COUNT(*) as n FROM soumissions WHERE numero LIKE ?", [`XP-${ymd}-%`]);
  const seq = String((r?.n || 0) + 1).padStart(3, "0");
  return `XP-${ymd}-${seq}`;
}

export async function sauvegarder(payload: {
  numero?: string; client: any; total: number;
  heuresEstimees?: number; data: any;
}): Promise<string> {
  const numero = payload.numero || await genererNumero();
  const now = new Date().toISOString();
  const existing = await one("SELECT id FROM soumissions WHERE numero = ?", [numero]);
  const json = JSON.stringify(payload.data);
  const heures = payload.heuresEstimees ?? 0;

  if (existing) {
    await run(
      `UPDATE soumissions SET date_modif=?, client_nom=?, client_adresse=?, client_telephone=?, client_courriel=?, projet=?, total=?, heures_estimees=?, payload_json=? WHERE numero=?`,
      [now, payload.client.nom, payload.client.adresse, payload.client.telephone, payload.client.courriel, payload.client.projet, payload.total, heures, json, numero]
    );
  } else {
    await run(
      `INSERT INTO soumissions (numero, date_creation, date_modif, client_nom, client_adresse, client_telephone, client_courriel, projet, total, heures_estimees, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero, now, now, payload.client.nom, payload.client.adresse, payload.client.telephone, payload.client.courriel, payload.client.projet, payload.total, heures, json]
    );
  }
  return numero;
}

export async function changerStatut(numero: string, statut: Statut) {
  const now = new Date().toISOString();
  const dateCol = statut === "envoyee" ? "date_envoi" :
    statut === "acceptee" ? "date_acceptation" :
    statut === "refusee" ? "date_refus" :
    statut === "facturee" ? "date_facturation" : null;
  if (dateCol) {
    await run(`UPDATE soumissions SET statut=?, ${dateCol}=? WHERE numero=?`, [statut, now, numero]);
  } else {
    await run(`UPDATE soumissions SET statut=? WHERE numero=?`, [statut, numero]);
  }
}

export async function enregistrerHeuresReelles(numero: string, heuresReelles: number) {
  await run("UPDATE soumissions SET heures_reelles=? WHERE numero=?", [heuresReelles, numero]);
}

export async function enregistrerRendement(
  numero: string, categorie: string, quantite: number,
  heuresEstimees: number, heuresReelles: number
) {
  await run(
    `INSERT INTO rendements_reels (soumission_numero, categorie, quantite, heures_estimees, heures_reelles, date_completion) VALUES (?, ?, ?, ?, ?, ?)`,
    [numero, categorie, quantite, heuresEstimees, heuresReelles, new Date().toISOString()]
  );
}

export async function rendementsMoyens(): Promise<Record<string, { qty: number; h_est: number; h_reel: number; ratio: number; n: number }>> {
  const rows = await all<any>(`SELECT categorie, SUM(quantite) as qty, SUM(heures_estimees) as h_est, SUM(heures_reelles) as h_reel, COUNT(*) as n FROM rendements_reels GROUP BY categorie`);
  const out: any = {};
  for (const r of rows) {
    out[r.categorie] = { qty: r.qty, h_est: r.h_est, h_reel: r.h_reel, ratio: r.h_est > 0 ? r.h_reel / r.h_est : 1, n: r.n };
  }
  return out;
}

export async function lister(statut?: Statut): Promise<SoumissionDB[]> {
  if (statut) return await all<SoumissionDB>("SELECT * FROM soumissions WHERE statut=? ORDER BY date_creation DESC LIMIT 500", [statut]);
  return await all<SoumissionDB>("SELECT * FROM soumissions ORDER BY date_creation DESC LIMIT 500");
}
export async function charger(numero: string): Promise<SoumissionDB | null> {
  return await one<SoumissionDB>("SELECT * FROM soumissions WHERE numero = ?", [numero]);
}
export async function supprimer(numero: string) {
  await run("DELETE FROM soumissions WHERE numero = ?", [numero]);
}

export async function statistiques() {
  const allRows = await lister();
  const moisCourant = new Date().toISOString().slice(0, 7);
  const moisCe = allRows.filter((s) => s.date_creation.startsWith(moisCourant));
  const compteParStatut: Record<string, number> = {};
  const totalParStatut: Record<string, number> = {};
  for (const s of allRows) {
    compteParStatut[s.statut] = (compteParStatut[s.statut] || 0) + 1;
    totalParStatut[s.statut] = (totalParStatut[s.statut] || 0) + (s.total || 0);
  }
  const envoyees = allRows.filter((s) => ["envoyee", "acceptee", "refusee", "facturee"].includes(s.statut)).length;
  const acceptees = allRows.filter((s) => ["acceptee", "facturee"].includes(s.statut)).length;
  return {
    total_soumissions: allRows.length,
    mois_courant: moisCe.length,
    total_mois_courant: moisCe.reduce((s, x) => s + (x.total || 0), 0),
    compte_par_statut: compteParStatut, total_par_statut: totalParStatut,
    taux_conversion: envoyees > 0 ? acceptees / envoyees : 0,
    pipeline: totalParStatut["envoyee"] || 0,
    revenus_acceptes: (totalParStatut["acceptee"] || 0) + (totalParStatut["facturee"] || 0),
  };
}

// === CLIENTS ===
// Alias pour compatibilité ascendante (anciens imports utilisent "Client")
export type { ClientType as Client };

export interface ClientType {
  id?: number; nom: string; courriel?: string; telephone?: string;
  adresse?: string; notes?: string; date_creation?: string;
  statut?: string; source?: string; tags?: string;
  asana_gid?: string; asana_modifie_le?: string;
}
export async function listerClients(): Promise<ClientType[]> {
  return await all<ClientType>("SELECT * FROM clients ORDER BY nom ASC");
}
export async function getClient(id: number): Promise<ClientType | null> {
  return await one<ClientType>("SELECT * FROM clients WHERE id = ?", [id]);
}
export async function ajouterClient(c: ClientType): Promise<number> {
  const r = await run(
    `INSERT INTO clients (nom, courriel, telephone, adresse, notes, date_creation) VALUES (?, ?, ?, ?, ?, ?)`,
    [c.nom, c.courriel || null, c.telephone || null, c.adresse || null, c.notes || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function modifierClient(id: number, c: Partial<ClientType>) {
  const champs = ['nom', 'courriel', 'telephone', 'adresse', 'notes', 'statut', 'source', 'tags', 'asana_gid', 'asana_modifie_le'];
  const definis = champs.filter(k => (c as any)[k] !== undefined);
  if (!definis.length) return;
  const sets = definis.map(k => `${k} = ?`).join(', ');
  const valeurs = definis.map(k => (c as any)[k]);
  await run(`UPDATE clients SET ${sets} WHERE id = ?`, [...valeurs, id]);
}
export async function supprimerClient(id: number) {
  await run("DELETE FROM clients WHERE id = ?", [id]);
}
export async function trouverOuCreerClient(nom: string, infos?: Partial<Client>): Promise<number> {
  if (!nom?.trim()) return 0;
  const existant = await one<{ id: number }>("SELECT id FROM clients WHERE LOWER(nom) = LOWER(?)", [nom.trim()]);
  if (existant) return existant.id;
  return await ajouterClient({ nom: nom.trim(), ...infos } as ClientType);
}

// === CRM : INTERACTIONS ===
export interface Interaction {
  id?: number; client_id: number; type: string; date: string;
  sujet?: string; note?: string; fait_par?: string; date_saisie?: string;
}
export async function listerInteractions(client_id: number): Promise<Interaction[]> {
  return await all<Interaction>("SELECT * FROM interactions_client WHERE client_id = ? ORDER BY date DESC, id DESC", [client_id]);
}
export async function ajouterInteraction(i: Interaction): Promise<number> {
  const r = await run(
    `INSERT INTO interactions_client (client_id, type, date, sujet, note, fait_par, date_saisie) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [i.client_id, i.type, i.date, i.sujet || null, i.note || null, i.fait_par || null, new Date().toISOString()]
  );
  // Mettre à jour notes ou pas — on garde la trace dans interactions
  return r.lastInsertRowid;
}
export async function supprimerInteraction(id: number) {
  await run("DELETE FROM interactions_client WHERE id = ?", [id]);
}

// === CRM : TÂCHES ===
export interface Tache {
  id?: number; client_id?: number; projet_id?: number;
  titre: string; description?: string; date_due?: string;
  priorite?: number; statut?: string; assigne_a?: string;
  date_creation?: string; date_completion?: string;
}
export async function listerTaches(filtres?: { statut?: string; client_id?: number; projet_id?: number }): Promise<Tache[]> {
  const conds: string[] = []; const args: any[] = [];
  if (filtres?.statut) { conds.push("statut = ?"); args.push(filtres.statut); }
  if (filtres?.client_id) { conds.push("client_id = ?"); args.push(filtres.client_id); }
  if (filtres?.projet_id) { conds.push("projet_id = ?"); args.push(filtres.projet_id); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return await all<Tache>(`SELECT * FROM taches_client ${where} ORDER BY CASE statut WHEN 'a_faire' THEN 0 WHEN 'en_cours' THEN 1 ELSE 2 END, date_due ASC, priorite DESC`, args);
}
export async function ajouterTache(t: Tache): Promise<number> {
  const r = await run(
    `INSERT INTO taches_client (client_id, projet_id, titre, description, date_due, priorite, statut, assigne_a, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.client_id || null, t.projet_id || null, t.titre, t.description || null,
     t.date_due || null, t.priorite ?? 3, t.statut || 'a_faire', t.assigne_a || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function modifierTache(id: number, t: Partial<Tache>) {
  const champs = ['titre', 'description', 'date_due', 'priorite', 'statut', 'assigne_a', 'date_completion'];
  const definis = champs.filter(k => (t as any)[k] !== undefined);
  if (!definis.length) return;
  const sets = definis.map(k => `${k} = ?`).join(', ');
  const valeurs = definis.map(k => (t as any)[k]);
  await run(`UPDATE taches_client SET ${sets} WHERE id = ?`, [...valeurs, id]);
}
export async function supprimerTache(id: number) {
  await run("DELETE FROM taches_client WHERE id = ?", [id]);
}

// === CONTRATS ===
export interface Contrat {
  id?: number; numero: string; client_id?: number; projet_id?: number;
  soumission_numero?: string; titre: string; date_emission: string;
  date_debut_travaux?: string; date_fin_prevue?: string;
  montant_avant_taxes?: number; taxes_pct?: number; montant_total?: number;
  depot_pct?: number; depot_montant?: number;
  conditions?: string; garantie?: string; statut?: string;
  signe_par_client?: number; date_signature?: string;
  payload_json?: string;
}
export async function genererNumeroContrat(): Promise<string> {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = await one<{ n: number }>("SELECT COUNT(*) as n FROM contrats WHERE numero LIKE ?", [`VK-CTR-${ymd}-%`]);
  return `VK-CTR-${ymd}-${String((r?.n || 0) + 1).padStart(3, "0")}`;
}
export async function listerContrats(statut?: string): Promise<any[]> {
  let sql = `SELECT c.*, cl.nom as client_nom FROM contrats c LEFT JOIN clients cl ON cl.id = c.client_id`;
  const args: any[] = [];
  if (statut) { sql += ` WHERE c.statut = ?`; args.push(statut); }
  sql += ` ORDER BY c.date_emission DESC LIMIT 200`;
  return await all<any>(sql, args);
}
export async function getContrat(id: number): Promise<any> {
  return await one<any>(`SELECT c.*, cl.nom as client_nom, cl.courriel as client_courriel, cl.adresse as client_adresse, cl.telephone as client_telephone FROM contrats c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = ?`, [id]);
}
export async function ajouterContrat(c: Contrat): Promise<{ id: number; numero: string }> {
  const numero = c.numero || await genererNumeroContrat();
  const r = await run(
    `INSERT INTO contrats (numero, client_id, projet_id, soumission_numero, titre, date_emission, date_debut_travaux, date_fin_prevue, montant_avant_taxes, taxes_pct, montant_total, depot_pct, depot_montant, conditions, garantie, statut, payload_json, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [numero, c.client_id || null, c.projet_id || null, c.soumission_numero || null,
     c.titre, c.date_emission, c.date_debut_travaux || null, c.date_fin_prevue || null,
     c.montant_avant_taxes || null, c.taxes_pct ?? 14.975, c.montant_total || null,
     c.depot_pct ?? 30, c.depot_montant || null, c.conditions || null,
     c.garantie || null, c.statut || 'brouillon', c.payload_json || null, new Date().toISOString()]
  );
  return { id: r.lastInsertRowid, numero };
}
export async function modifierContrat(id: number, c: Partial<Contrat>) {
  const champs = ['titre', 'date_emission', 'date_debut_travaux', 'date_fin_prevue',
                  'montant_avant_taxes', 'taxes_pct', 'montant_total', 'depot_pct',
                  'depot_montant', 'conditions', 'garantie', 'statut',
                  'signe_par_client', 'date_signature', 'payload_json'];
  const definis = champs.filter(k => (c as any)[k] !== undefined);
  if (!definis.length) return;
  const sets = definis.map(k => `${k} = ?`).join(', ');
  const valeurs = definis.map(k => (c as any)[k]);
  await run(`UPDATE contrats SET ${sets} WHERE id = ?`, [...valeurs, id]);
}
export async function supprimerContrat(id: number) {
  await run("DELETE FROM contrats WHERE id = ?", [id]);
}

// === PROJETS ===
export interface Projet {
  id?: number; client_id?: number; nom: string; adresse_chantier?: string;
  description?: string; statut?: 'actif' | 'complete' | 'en_pause' | 'annule';
  date_debut?: string; date_fin_prevue?: string; date_fin_reelle?: string;
  soumission_numero?: string; budget_estime?: number; heures_estimees?: number;
  prix_contrat?: number; facture_finale_data?: string; facture_finale_type?: string;
  date_creation?: string;
}
export interface ProjetAvecTotaux extends Projet {
  client_nom?: string; total_heures: number; cout_main_oeuvre: number;
  total_depenses: number; total_facture: number; total_paye: number;
  cout_total: number; marge: number; marge_pct: number; pct_budget_consomme: number;
}

function calculerTotaux(r: any): ProjetAvecTotaux {
  // Le prix de contrat (signé) prime sur le budget estimé (interne)
  const revenu = r.prix_contrat || r.budget_estime || 0;
  const cout_total = (r.cout_main_oeuvre || 0) + (r.total_depenses || 0);
  const marge = revenu - cout_total;
  const marge_pct = revenu ? (marge / revenu) * 100 : 0;
  const pct_budget_consomme = revenu ? Math.min(100, (cout_total / revenu) * 100) : 0;
  // On expose aussi le revenu actif pour affichage clair
  return { ...r, cout_total, marge, marge_pct, pct_budget_consomme, revenu };
}

const PROJ_SQL = `SELECT p.*, c.nom as client_nom,
  COALESCE((SELECT SUM(heures) FROM heures_projet WHERE projet_id = p.id), 0) as total_heures,
  COALESCE((SELECT SUM(heures * taux_horaire) FROM heures_projet WHERE projet_id = p.id), 0) as cout_main_oeuvre,
  COALESCE((SELECT SUM(montant) FROM depenses_projet WHERE projet_id = p.id), 0) as total_depenses,
  COALESCE((SELECT SUM(montant) FROM factures_projet WHERE projet_id = p.id), 0) as total_facture,
  COALESCE((SELECT SUM(montant) FROM factures_projet WHERE projet_id = p.id AND payee = 1), 0) as total_paye
FROM projets p LEFT JOIN clients c ON c.id = p.client_id`;

export async function listerProjets(statut?: string): Promise<ProjetAvecTotaux[]> {
  let sql = PROJ_SQL;
  const args: any[] = [];
  if (statut) { sql += ` WHERE p.statut = ?`; args.push(statut); }
  sql += ` ORDER BY p.date_creation DESC`;
  const rows = await all<any>(sql, args);
  return rows.map(calculerTotaux);
}
export async function getProjet(id: number): Promise<ProjetAvecTotaux | null> {
  const r = await one<any>(`${PROJ_SQL} WHERE p.id = ?`, [id]);
  return r ? calculerTotaux(r) : null;
}
export async function ajouterProjet(p: Projet): Promise<number> {
  const r = await run(
    `INSERT INTO projets (client_id, nom, adresse_chantier, description, statut, date_debut, date_fin_prevue, soumission_numero, budget_estime, heures_estimees, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.client_id || null, p.nom, p.adresse_chantier || null, p.description || null,
     p.statut || 'actif', p.date_debut || null, p.date_fin_prevue || null,
     p.soumission_numero || null, p.budget_estime || null, p.heures_estimees || null,
     new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function modifierProjet(id: number, p: Partial<Projet>) {
  const champs = ['client_id', 'nom', 'adresse_chantier', 'description', 'statut', 'date_debut', 'date_fin_prevue', 'date_fin_reelle', 'budget_estime', 'heures_estimees', 'prix_contrat', 'facture_finale_data', 'facture_finale_type'];
  const definis = champs.filter(k => (p as any)[k] !== undefined);
  if (!definis.length) return;
  const sets = definis.map(k => `${k} = ?`).join(', ');
  const valeurs = definis.map(k => (p as any)[k]);
  await run(`UPDATE projets SET ${sets} WHERE id = ?`, [...valeurs, id]);
}
export async function supprimerProjet(id: number) {
  await run("DELETE FROM heures_projet WHERE projet_id = ?", [id]);
  await run("DELETE FROM factures_projet WHERE projet_id = ?", [id]);
  await run("DELETE FROM depenses_projet WHERE projet_id = ?", [id]);
  await run("DELETE FROM projets WHERE id = ?", [id]);
}

// === HEURES ===
export interface HeureProjet {
  id?: number; projet_id: number; date: string; heures: number;
  description?: string; employe?: string; taux_horaire?: number;
}
export async function listerHeuresProjet(projet_id: number) {
  return await all<HeureProjet>("SELECT * FROM heures_projet WHERE projet_id = ? ORDER BY date DESC, id DESC", [projet_id]);
}
export async function ajouterHeureProjet(h: HeureProjet): Promise<number> {
  const r = await run(
    `INSERT INTO heures_projet (projet_id, date, heures, description, employe, taux_horaire, date_saisie) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [h.projet_id, h.date, h.heures, h.description || null, h.employe || null, h.taux_horaire ?? 90, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function supprimerHeureProjet(id: number) {
  await run("DELETE FROM heures_projet WHERE id = ?", [id]);
}
export async function modifierHeureProjet(id: number, h: Partial<HeureProjet>) {
  const champs = ['projet_id', 'date', 'heures', 'description', 'employe', 'taux_horaire'];
  const definis = champs.filter(k => (h as any)[k] !== undefined);
  if (!definis.length) return;
  const sets = definis.map(k => `${k} = ?`).join(', ');
  const valeurs = definis.map(k => (h as any)[k]);
  await run(`UPDATE heures_projet SET ${sets} WHERE id = ?`, [...valeurs, id]);
}
export async function listerToutesHeures(filtres?: { employe?: string; projet_id?: number; depuis?: string; jusqu_a?: string }): Promise<any[]> {
  const conds: string[] = []; const args: any[] = [];
  if (filtres?.employe) { conds.push("h.employe = ?"); args.push(filtres.employe); }
  if (filtres?.projet_id) { conds.push("h.projet_id = ?"); args.push(filtres.projet_id); }
  if (filtres?.depuis) { conds.push("h.date >= ?"); args.push(filtres.depuis); }
  if (filtres?.jusqu_a) { conds.push("h.date <= ?"); args.push(filtres.jusqu_a); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return await all<any>(
    `SELECT h.*, p.nom as projet_nom FROM heures_projet h LEFT JOIN projets p ON p.id = h.projet_id ${where} ORDER BY h.date DESC, h.id DESC LIMIT 500`,
    args
  );
}
export async function heuresParProjetDate(projet_id: number): Promise<{ employe: string; date: string; heures: number; taux_horaire: number; description?: string }[]> {
  return await all<any>(
    `SELECT employe, date, heures, taux_horaire, description FROM heures_projet
     WHERE projet_id = ? AND employe IS NOT NULL ORDER BY date DESC, employe ASC`,
    [projet_id]
  );
}
export async function soumissionsARelancer(): Promise<any[]> {
  const seuil = new Date(Date.now() - 7 * 86400000).toISOString();
  return await all<any>(
    `SELECT * FROM soumissions WHERE statut = 'envoyee' AND date_envoi IS NOT NULL AND date_envoi < ?
     ORDER BY date_envoi ASC LIMIT 20`, [seuil]
  );
}
export async function rechercheGlobale(q: string): Promise<{ type: string; id: number | string; titre: string; sous: string }[]> {
  if (!q.trim()) return [];
  const like = `%${q.toLowerCase()}%`;
  const out: any[] = [];
  const clients = await all<any>(`SELECT id, nom, telephone FROM clients WHERE LOWER(nom) LIKE ? OR LOWER(courriel) LIKE ? OR telephone LIKE ? LIMIT 5`, [like, like, like]);
  for (const c of clients) out.push({ type: "client", id: c.id, titre: c.nom, sous: c.telephone || "" });
  const projets = await all<any>(`SELECT id, nom, adresse_chantier FROM projets WHERE LOWER(nom) LIKE ? OR LOWER(adresse_chantier) LIKE ? LIMIT 5`, [like, like]);
  for (const p of projets) out.push({ type: "projet", id: p.id, titre: p.nom, sous: p.adresse_chantier || "" });
  const soums = await all<any>(`SELECT numero, client_nom, total FROM soumissions WHERE LOWER(numero) LIKE ? OR LOWER(client_nom) LIKE ? LIMIT 5`, [like, like]);
  for (const s of soums) out.push({ type: "soumission", id: s.numero, titre: s.numero, sous: s.client_nom || "" });
  return out;
}
export async function finances(annee: number): Promise<any> {
  const mois: any[] = [];
  for (let m = 1; m <= 12; m++) {
    const debut = `${annee}-${String(m).padStart(2, "0")}-01`;
    const finM = new Date(annee, m, 1).toISOString().slice(0, 10);
    const facture = (await one<any>(`SELECT COALESCE(SUM(montant), 0) as v FROM factures_projet WHERE date >= ? AND date < ?`, [debut, finM]))?.v || 0;
    const paye = (await one<any>(`SELECT COALESCE(SUM(montant), 0) as v FROM factures_projet WHERE payee = 1 AND date_paiement >= ? AND date_paiement < ?`, [debut, finM]))?.v || 0;
    const depenses = (await one<any>(`SELECT COALESCE(SUM(montant), 0) as v FROM depenses_projet WHERE date >= ? AND date < ?`, [debut, finM]))?.v || 0;
    const mo = (await one<any>(`SELECT COALESCE(SUM(heures * taux_horaire), 0) as v FROM heures_projet WHERE date >= ? AND date < ?`, [debut, finM]))?.v || 0;
    mois.push({ mois: m, facture, paye, depenses, mo, marge: facture - depenses - mo });
  }
  return { annee, mois };
}
export async function heuresParEmploye(depuis: string): Promise<{ employe: string; total_heures: number; cout_total: number; n_jours: number }[]> {
  return await all<any>(
    `SELECT employe, SUM(heures) as total_heures, SUM(heures * taux_horaire) as cout_total, COUNT(DISTINCT date) as n_jours
     FROM heures_projet WHERE date >= ? AND employe IS NOT NULL
     GROUP BY employe ORDER BY total_heures DESC`,
    [depuis]
  );
}

// === FACTURES ===
export interface FactureProjet {
  id?: number; projet_id: number; numero?: string; montant: number;
  date: string; description?: string; payee?: number; date_paiement?: string;
}
export async function listerFacturesProjet(projet_id: number) {
  return await all<FactureProjet>("SELECT * FROM factures_projet WHERE projet_id = ? ORDER BY date DESC", [projet_id]);
}
export async function ajouterFactureProjet(f: FactureProjet): Promise<number> {
  const r = await run(
    `INSERT INTO factures_projet (projet_id, numero, montant, date, description, payee, date_paiement, date_saisie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [f.projet_id, f.numero || null, f.montant, f.date, f.description || null, f.payee ? 1 : 0, f.date_paiement || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function marquerFacturePayee(id: number, date_paiement: string) {
  await run("UPDATE factures_projet SET payee = 1, date_paiement = ? WHERE id = ?", [date_paiement, id]);
}
export async function supprimerFactureProjet(id: number) {
  await run("DELETE FROM factures_projet WHERE id = ?", [id]);
}

// === DÉPENSES ===
export interface DepenseProjet {
  id?: number; projet_id?: number | null; date: string; montant: number;
  fournisseur?: string; description?: string; categorie?: string;
  recu_data?: string; recu_type?: string;
}
export async function listerDepensesProjet(projet_id: number | null) {
  if (projet_id === null) return await all<DepenseProjet>("SELECT * FROM depenses_projet WHERE projet_id IS NULL ORDER BY date DESC");
  return await all<DepenseProjet>("SELECT * FROM depenses_projet WHERE projet_id = ? ORDER BY date DESC", [projet_id]);
}
export async function listerToutesDepenses() {
  return await all<DepenseProjet>("SELECT * FROM depenses_projet ORDER BY date DESC LIMIT 500");
}
export async function fournisseursConnus(): Promise<string[]> {
  const rows = await all<{ fournisseur: string }>("SELECT DISTINCT fournisseur FROM depenses_projet WHERE fournisseur IS NOT NULL AND fournisseur != '' ORDER BY fournisseur ASC");
  return rows.map(r => r.fournisseur);
}
export async function ajouterDepenseProjet(d: DepenseProjet): Promise<number> {
  const r = await run(
    `INSERT INTO depenses_projet (projet_id, date, montant, fournisseur, description, categorie, recu_data, recu_type, date_saisie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.projet_id || null, d.date, d.montant, d.fournisseur || null, d.description || null, d.categorie || null, d.recu_data || null, d.recu_type || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function supprimerDepenseProjet(id: number) {
  await run("DELETE FROM depenses_projet WHERE id = ?", [id]);
}

// === PHOTOS CHANTIER ===
export interface PhotoChantier {
  id?: number; projet_id: number; date: string;
  employes?: string; photo_data: string; photo_type?: string;
  description?: string; date_saisie?: string;
}
export async function listerPhotosChantier(projet_id?: number, options: { sansData?: boolean } = {}): Promise<any[]> {
  const cols = options.sansData
    ? "id, projet_id, date, employes, photo_type, description, date_saisie"
    : "*";
  if (projet_id) {
    return await all<any>(`SELECT ${cols} FROM photos_chantier WHERE projet_id = ? ORDER BY date DESC, id DESC`, [projet_id]);
  }
  return await all<any>(`SELECT ${cols} FROM photos_chantier ORDER BY date DESC, id DESC LIMIT 200`);
}
export async function getPhotoChantier(id: number): Promise<PhotoChantier | null> {
  return await one<PhotoChantier>("SELECT * FROM photos_chantier WHERE id = ?", [id]);
}
export async function ajouterPhotoChantier(p: PhotoChantier): Promise<number> {
  const r = await run(
    `INSERT INTO photos_chantier (projet_id, date, employes, photo_data, photo_type, description, date_saisie) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [p.projet_id, p.date, p.employes || null, p.photo_data, p.photo_type || null, p.description || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function supprimerPhotoChantier(id: number) {
  await run("DELETE FROM photos_chantier WHERE id = ?", [id]);
}
export async function marquerDriveSync(id: number, drive_file_id: string | null, error: string | null) {
  await run("UPDATE photos_chantier SET drive_file_id = ?, drive_sync_error = ? WHERE id = ?", [drive_file_id, error, id]);
}
export async function compterPhotosErreursDrive(): Promise<number> {
  const r = await one<{ n: number }>("SELECT COUNT(*) AS n FROM photos_chantier WHERE drive_sync_error IS NOT NULL");
  return r?.n || 0;
}

// === BIBLIOTHÈQUE ===
export interface JobBiblio {
  id?: number; date_ajout: string; adresse?: string; type_materiau?: string;
  parement_pi2?: number; fascia_pi_lin?: number; soffite_pi2?: number;
  nb_etages?: number; total_soumission?: number; heures_reelles?: number;
  hover_data_json?: string; soumission_data_json?: string; photos_json?: string;
  notes_chantier?: string; complexite?: string;
}
export async function ajouterJobBiblio(job: JobBiblio): Promise<number> {
  const r = await run(
    `INSERT INTO bibliotheque_jobs (date_ajout, adresse, type_materiau, parement_pi2, fascia_pi_lin, soffite_pi2, nb_etages, total_soumission, heures_reelles, hover_data_json, soumission_data_json, photos_json, notes_chantier, complexite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [job.date_ajout, job.adresse || null, job.type_materiau || null, job.parement_pi2 || null,
     job.fascia_pi_lin || null, job.soffite_pi2 || null, job.nb_etages || null, job.total_soumission || null,
     job.heures_reelles || null, job.hover_data_json || null, job.soumission_data_json || null,
     job.photos_json || null, job.notes_chantier || null, job.complexite || null]
  );
  return r.lastInsertRowid;
}
export async function listerJobsBiblio(): Promise<JobBiblio[]> {
  return await all<JobBiblio>("SELECT * FROM bibliotheque_jobs ORDER BY date_ajout DESC LIMIT 200");
}
export async function supprimerJobBiblio(id: number) {
  await run("DELETE FROM bibliotheque_jobs WHERE id = ?", [id]);
}
export async function jobsSimilaires(parementPi2: number, typeMateriau?: string, limit = 3): Promise<JobBiblio[]> {
  const min = parementPi2 * 0.7, max = parementPi2 * 1.3;
  if (typeMateriau) {
    const rows = await all<JobBiblio>(
      `SELECT * FROM bibliotheque_jobs WHERE parement_pi2 BETWEEN ? AND ? AND type_materiau = ? ORDER BY ABS(parement_pi2 - ?) ASC LIMIT ?`,
      [min, max, typeMateriau, parementPi2, limit]
    );
    if (rows.length > 0) return rows;
  }
  return await all<JobBiblio>(
    `SELECT * FROM bibliotheque_jobs WHERE parement_pi2 BETWEEN ? AND ? ORDER BY ABS(parement_pi2 - ?) ASC LIMIT ?`,
    [min, max, parementPi2, limit]
  );
}

// === EMPLOYÉS ===
export interface Employe {
  id?: number; nom: string; taux_horaire: number; das_pct?: number; actif?: number;
  telephone?: string; courriel?: string; adresse?: string;
  date_naissance?: string; nas?: string; date_embauche?: string; poste?: string;
  contact_urgence_nom?: string; contact_urgence_lien?: string; contact_urgence_tel?: string;
  specimen_cheque_data?: string; specimen_cheque_type?: string;
  notes?: string;
}
async function seedEmployes() {
  // Migration idempotente : Frédéric n'est plus un employé suivi
  await run("UPDATE employes SET actif = 0 WHERE nom = 'Frédéric'", []);
  const r = await one<{ n: number }>("SELECT COUNT(*) as n FROM employes WHERE actif = 1");
  if ((r?.n || 0) > 0) return;
  const now = new Date().toISOString();
  const defaults = [
    { nom: "Gabriel Quinchon", taux: 45 },
    { nom: "Maxime", taux: 30 },
    { nom: "Francis Quinchon", taux: 30 },
  ];
  for (const e of defaults) {
    await run("INSERT OR IGNORE INTO employes (nom, taux_horaire, das_pct, actif, date_creation) VALUES (?, ?, ?, 1, ?)", [e.nom, e.taux, 0.15, now]);
  }
}
export async function listerEmployes(): Promise<Employe[]> {
  await initDb(); await seedEmployes();
  return await all<Employe>("SELECT * FROM employes WHERE actif = 1 ORDER BY nom ASC");
}
export async function ajouterEmploye(e: Employe): Promise<number> {
  const r = await run(
    "INSERT INTO employes (nom, taux_horaire, das_pct, actif, date_creation) VALUES (?, ?, ?, 1, ?)",
    [e.nom, e.taux_horaire, e.das_pct ?? 0.15, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function modifierEmploye(id: number, e: Partial<Employe>) {
  const champs = ['nom', 'taux_horaire', 'das_pct', 'actif',
    'telephone', 'courriel', 'adresse', 'date_naissance', 'nas',
    'date_embauche', 'poste', 'contact_urgence_nom', 'contact_urgence_lien',
    'contact_urgence_tel', 'specimen_cheque_data', 'specimen_cheque_type', 'notes'];
  const definis = champs.filter(k => (e as any)[k] !== undefined);
  if (!definis.length) return;
  const sets = definis.map(k => `${k} = ?`).join(', ');
  const valeurs = definis.map(k => (e as any)[k]);
  await run(`UPDATE employes SET ${sets} WHERE id = ?`, [...valeurs, id]);
}
export async function getEmploye(id: number): Promise<Employe | null> {
  return await one<Employe>("SELECT * FROM employes WHERE id = ?", [id]);
}
export async function supprimerEmploye(id: number) {
  await run("UPDATE employes SET actif = 0 WHERE id = ?", [id]);
}

// === PAYE / PÉRIODES BI-HEBDOMADAIRES ===
// Conventions :
// - Période = 14 jours, débutant un dimanche (jour 0)
// - Heures normales : <= 40h/semaine (max 80h sur la période)
// - Heures supplémentaires : > 40h/semaine (taux × 1.5)
// - DAS : 15% retenu sur le brut

export interface PaiePeriode {
  id?: number; employe: string; debut: string; fin: string;
  heures_normales: number; heures_sup: number;
  taux_horaire: number; das_pct?: number;
  montant_brut: number; das_montant: number; montant_net: number;
  paye?: number; date_paiement?: string; note?: string;
}

/** Retourne le dimanche de la semaine d'une date YYYY-MM-DD */
function dimancheDe(dateStr: string): Date {
  const d = new Date(dateStr + "T12:00:00");
  const jour = d.getDay(); // 0 = dimanche
  d.setDate(d.getDate() - jour);
  return d;
}

/** Calcule la période bi-hebdo (sam→ven × 2) qui contient une date.
 *  Ancrée sur dimanches d'une année de référence (2026-01-04). */
function periodeBiHebdo(dateStr: string): { debut: string; fin: string } {
  const ancre = new Date("2026-01-04T12:00:00"); // dimanche de référence
  const d = new Date(dateStr + "T12:00:00");
  const diffJours = Math.floor((d.getTime() - ancre.getTime()) / 86400000);
  const numeroPeriode = Math.floor(diffJours / 14);
  const debut = new Date(ancre);
  debut.setDate(ancre.getDate() + numeroPeriode * 14);
  const fin = new Date(debut);
  fin.setDate(debut.getDate() + 13);
  return {
    debut: debut.toISOString().slice(0, 10),
    fin: fin.toISOString().slice(0, 10),
  };
}

/** Calcule les heures normales/sup d'un ensemble d'heures pour une période bi-hebdo */
function calculerHeuresPaye(heures: { date: string; heures: number }[], debut: string): { normales: number; sup: number } {
  // Diviser en 2 semaines
  const debutDate = new Date(debut + "T12:00:00");
  const semaine1Fin = new Date(debutDate); semaine1Fin.setDate(debutDate.getDate() + 6);
  const semaine2Debut = new Date(debutDate); semaine2Debut.setDate(debutDate.getDate() + 7);
  let h1 = 0, h2 = 0;
  for (const e of heures) {
    const d = new Date(e.date + "T12:00:00");
    if (d <= semaine1Fin) h1 += e.heures;
    else if (d >= semaine2Debut) h2 += e.heures;
  }
  const normales = Math.min(40, h1) + Math.min(40, h2);
  const sup = Math.max(0, h1 - 40) + Math.max(0, h2 - 40);
  return { normales, sup };
}

/** Génère/met à jour les périodes de paye à partir des heures saisies.
 *  Retourne la liste des périodes pour un employé donné (ou tous). */
export async function listerPaiePeriodes(employe?: string, limit = 12): Promise<PaiePeriode[]> {
  await initDb();
  // 1. Récupérer toutes les heures
  const where = employe ? "WHERE employe = ?" : "WHERE employe IS NOT NULL";
  const args = employe ? [employe] : [];
  const heures = await all<{ employe: string; date: string; heures: number; taux_horaire: number }>(
    `SELECT employe, date, heures, taux_horaire FROM heures_projet ${where}`, args
  );
  if (heures.length === 0) {
    // Quand même retourner les périodes existantes
    const exist = employe
      ? await all<PaiePeriode>("SELECT * FROM paies_periodes WHERE employe = ? ORDER BY debut DESC LIMIT ?", [employe, limit])
      : await all<PaiePeriode>("SELECT * FROM paies_periodes ORDER BY debut DESC LIMIT ?", [limit]);
    return exist;
  }

  // 2. Grouper par (employe, période bi-hebdo)
  const groupes = new Map<string, { employe: string; debut: string; fin: string; taux: number; heures: { date: string; heures: number }[] }>();
  for (const h of heures) {
    const p = periodeBiHebdo(h.date);
    const key = `${h.employe}|${p.debut}`;
    if (!groupes.has(key)) groupes.set(key, { employe: h.employe, debut: p.debut, fin: p.fin, taux: h.taux_horaire, heures: [] });
    groupes.get(key)!.heures.push({ date: h.date, heures: h.heures });
  }

  // 3. Pour chaque groupe, calculer et upsert dans paies_periodes
  for (const g of groupes.values()) {
    const { normales, sup } = calculerHeuresPaye(g.heures, g.debut);
    const brut = normales * g.taux + sup * g.taux * 1.5;
    const dasMontant = brut * 0.15;
    const net = brut - dasMontant;

    const existant = await one<PaiePeriode>("SELECT * FROM paies_periodes WHERE employe = ? AND debut = ? AND fin = ?", [g.employe, g.debut, g.fin]);
    if (existant) {
      // Ne pas écraser si déjà payé
      if (!existant.paye) {
        await run(
          `UPDATE paies_periodes SET heures_normales=?, heures_sup=?, taux_horaire=?, montant_brut=?, das_montant=?, montant_net=? WHERE id=?`,
          [normales, sup, g.taux, brut, dasMontant, net, existant.id]
        );
      }
    } else {
      await run(
        `INSERT INTO paies_periodes (employe, debut, fin, heures_normales, heures_sup, taux_horaire, das_pct, montant_brut, das_montant, montant_net, paye, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [g.employe, g.debut, g.fin, normales, sup, g.taux, 0.15, brut, dasMontant, net, new Date().toISOString()]
      );
    }
  }

  // 4. Retourner la liste
  const list = employe
    ? await all<PaiePeriode>("SELECT * FROM paies_periodes WHERE employe = ? ORDER BY debut DESC LIMIT ?", [employe, limit])
    : await all<PaiePeriode>("SELECT * FROM paies_periodes ORDER BY debut DESC, employe ASC LIMIT ?", [limit * 5]);
  return list;
}

export async function supprimerPayePeriode(id: number) {
  await run("DELETE FROM paies_periodes WHERE id = ?", [id]);
}
/** Supprime les périodes de paye qui ne correspondent plus à aucune heure saisie */
export async function nettoyerPayePeriodesOrphelines(): Promise<number> {
  await initDb();
  // Récupérer tous les couples (employe, dates) qui ont encore des heures
  const heuresExistantes = await all<{ employe: string; date: string }>(
    "SELECT DISTINCT employe, date FROM heures_projet WHERE employe IS NOT NULL"
  );
  if (heuresExistantes.length === 0) {
    const r = await run("DELETE FROM paies_periodes WHERE paye = 0", []);
    return r.rowsAffected;
  }
  // Liste les périodes existantes
  const periodes = await all<{ id: number; employe: string; debut: string; fin: string; paye: number }>("SELECT id, employe, debut, fin, paye FROM paies_periodes");
  let deleted = 0;
  for (const p of periodes) {
    if (p.paye) continue; // jamais supprimer une paye marquée payée
    // Vérifier s'il existe des heures pour cet employé dans cette période
    const r = await one<{ n: number }>(
      "SELECT COUNT(*) as n FROM heures_projet WHERE employe = ? AND date >= ? AND date <= ?",
      [p.employe, p.debut, p.fin]
    );
    if ((r?.n || 0) === 0) {
      await run("DELETE FROM paies_periodes WHERE id = ?", [p.id]);
      deleted++;
    }
  }
  return deleted;
}
export async function marquerPayePeriode(id: number, paye: boolean, date_paiement?: string, note?: string) {
  await run(
    `UPDATE paies_periodes SET paye = ?, date_paiement = ?, note = ? WHERE id = ?`,
    [paye ? 1 : 0, paye ? (date_paiement || new Date().toISOString().slice(0, 10)) : null, note || null, id]
  );
}

// === OUTILS ===
export interface Outil {
  id?: number; nom: string; categorie?: string; etat?: string;
  localisation?: string; numero_serie?: string; prix_achat?: number;
  date_achat?: string; notes?: string;
  ajoute_par?: string; date_ajout?: string;
  modifie_par?: string; date_modif?: string;
}
export async function listerOutils(): Promise<Outil[]> {
  return await all<Outil>("SELECT * FROM outils ORDER BY date_ajout DESC");
}
export async function getOutil(id: number): Promise<Outil | null> {
  return await one<Outil>("SELECT * FROM outils WHERE id = ?", [id]);
}
export async function ajouterOutil(o: Outil): Promise<number> {
  const now = new Date().toISOString();
  const r = await run(
    `INSERT INTO outils (nom, categorie, etat, localisation, numero_serie, prix_achat, date_achat, notes, ajoute_par, date_ajout) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [o.nom, o.categorie || null, o.etat || 'bon', o.localisation || null, o.numero_serie || null,
     o.prix_achat || null, o.date_achat || null, o.notes || null, o.ajoute_par || null, now]
  );
  return r.lastInsertRowid;
}
export async function modifierOutil(id: number, o: Partial<Outil>) {
  const champs = ['nom', 'categorie', 'etat', 'localisation', 'numero_serie', 'prix_achat', 'date_achat', 'notes'];
  const definis = champs.filter(k => (o as any)[k] !== undefined);
  if (!definis.length) return;
  const sets = definis.map(k => `${k} = ?`).join(', ') + ', modifie_par = ?, date_modif = ?';
  const valeurs = [...definis.map(k => (o as any)[k]), o.modifie_par || null, new Date().toISOString()];
  await run(`UPDATE outils SET ${sets} WHERE id = ?`, [...valeurs, id]);
}
export async function supprimerOutil(id: number) {
  await run("DELETE FROM outils WHERE id = ?", [id]);
}

// === OAUTH TOKENS ===
export interface OAuthTokens {
  provider: string;
  access_token?: string; refresh_token?: string;
  expires_at?: number; scope?: string; user_email?: string;
}
export async function getOAuthTokens(provider: string): Promise<OAuthTokens | null> {
  await initDb();
  return await one<OAuthTokens>("SELECT * FROM oauth_tokens WHERE provider = ?", [provider]);
}
export async function saveOAuthTokens(t: OAuthTokens): Promise<void> {
  await initDb();
  const existant = await one<{ id: number }>("SELECT id FROM oauth_tokens WHERE provider = ?", [t.provider]);
  if (existant) {
    await run(
      `UPDATE oauth_tokens SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ?, scope = ?, user_email = ? WHERE provider = ?`,
      [t.access_token || null, t.refresh_token || null, t.expires_at || null, t.scope || null, t.user_email || null, t.provider]
    );
  } else {
    await run(
      `INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, scope, user_email, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [t.provider, t.access_token || null, t.refresh_token || null, t.expires_at || null, t.scope || null, t.user_email || null, new Date().toISOString()]
    );
  }
}
export async function deleteOAuthTokens(provider: string): Promise<void> {
  await run("DELETE FROM oauth_tokens WHERE provider = ?", [provider]);
}

// Export factice pour compatibilité ascendante (certains anciens fichiers importaient `db`)
export function db() { return getLibsqlClient(); }

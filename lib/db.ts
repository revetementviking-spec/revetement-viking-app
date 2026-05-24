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

export async function initDb() {
  if (_initialized) return;
  _initialized = true;
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
      date_creation TEXT NOT NULL
    )`,
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
  const champs = ['nom', 'courriel', 'telephone', 'adresse', 'notes'];
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

// === PROJETS ===
export interface Projet {
  id?: number; client_id?: number; nom: string; adresse_chantier?: string;
  description?: string; statut?: 'actif' | 'complete' | 'en_pause' | 'annule';
  date_debut?: string; date_fin_prevue?: string; date_fin_reelle?: string;
  soumission_numero?: string; budget_estime?: number; heures_estimees?: number;
  date_creation?: string;
}
export interface ProjetAvecTotaux extends Projet {
  client_nom?: string; total_heures: number; cout_main_oeuvre: number;
  total_depenses: number; total_facture: number; total_paye: number;
  cout_total: number; marge: number; marge_pct: number; pct_budget_consomme: number;
}

function calculerTotaux(r: any): ProjetAvecTotaux {
  const cout_total = (r.cout_main_oeuvre || 0) + (r.total_depenses || 0);
  const marge = (r.budget_estime || 0) - cout_total;
  const marge_pct = r.budget_estime ? (marge / r.budget_estime) * 100 : 0;
  const pct_budget_consomme = r.budget_estime ? Math.min(100, (cout_total / r.budget_estime) * 100) : 0;
  return { ...r, cout_total, marge, marge_pct, pct_budget_consomme };
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
  const champs = ['client_id', 'nom', 'adresse_chantier', 'description', 'statut', 'date_debut', 'date_fin_prevue', 'date_fin_reelle', 'budget_estime', 'heures_estimees'];
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
  id?: number; projet_id: number; date: string; montant: number;
  fournisseur?: string; description?: string; categorie?: string;
}
export async function listerDepensesProjet(projet_id: number) {
  return await all<DepenseProjet>("SELECT * FROM depenses_projet WHERE projet_id = ? ORDER BY date DESC", [projet_id]);
}
export async function ajouterDepenseProjet(d: DepenseProjet): Promise<number> {
  const r = await run(
    `INSERT INTO depenses_projet (projet_id, date, montant, fournisseur, description, categorie, date_saisie) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [d.projet_id, d.date, d.montant, d.fournisseur || null, d.description || null, d.categorie || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function supprimerDepenseProjet(id: number) {
  await run("DELETE FROM depenses_projet WHERE id = ?", [id]);
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
  const champs = ['nom', 'taux_horaire', 'das_pct', 'actif'];
  const definis = champs.filter(k => (e as any)[k] !== undefined);
  if (!definis.length) return;
  const sets = definis.map(k => `${k} = ?`).join(', ');
  const valeurs = definis.map(k => (e as any)[k]);
  await run(`UPDATE employes SET ${sets} WHERE id = ?`, [...valeurs, id]);
}
export async function supprimerEmploye(id: number) {
  await run("UPDATE employes SET actif = 0 WHERE id = ?", [id]);
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

// Export factice pour compatibilité ascendante (certains anciens fichiers importaient `db`)
export function db() { return getLibsqlClient(); }

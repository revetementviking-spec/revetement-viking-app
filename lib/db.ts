// Base de données — fonctionne en local (file:) ou en cloud (Turso libsql:)
// Si TURSO_URL est définie → utilise Turso, sinon SQLite local
import { createClient, type Client as LibsqlClient, type ResultSet } from "@libsql/client";
import path from "path";
import fs from "fs";
import { calculerMargeProjet, periodeBiHebdo as periodeBiHebdoCalc, calculerHeuresPaye as calculerHeuresPayeCalc, calculerPaye } from "@/lib/calculs";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "soumissions.db");

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let _client: LibsqlClient | null = null;
let _initialized = false;
let _initPromise: Promise<void> | null = null;
// Incrémenter à CHAQUE changement de schéma (nouvelle colonne/table/index).
// Tant que la version stockée (PRAGMA user_version) ≥ cette valeur, initDb saute
// toutes les migrations → 1 seul aller-retour réseau au lieu de ~70 (clé de la rapidité).
const SCHEMA_VERSION = 3;

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
  if (!_initPromise) _initPromise = doInitDb().catch((e) => { _initPromise = null; throw e; });
  await _initPromise;
}

async function doInitDb() {
  // Schéma déjà à jour ? (1 aller-retour) → on saute les ~70 migrations.
  try {
    const r = await getLibsqlClient().execute("PRAGMA user_version");
    const cur = Number((r.rows?.[0] as any)?.user_version ?? 0);
    if (cur >= SCHEMA_VERSION) { _initialized = true; return; }
  } catch { /* PRAGMA indisponible → on exécute les migrations par sécurité */ }
  // IMPORTANT : marquer initialisé AVANT les migrations. Le backfill ci-dessous
  // appelle all()/run() qui re-appellent initDb() → sans ce flag, deadlock sur _initPromise.
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
  await tryExec("ALTER TABLE projets ADD COLUMN numero TEXT");
  await tryExec("ALTER TABLE projets ADD COLUMN contrat_signe_data TEXT");
  await tryExec("ALTER TABLE projets ADD COLUMN contrat_signe_type TEXT");
  // Signature en ligne des soumissions par le client
  await tryExec("ALTER TABLE soumissions ADD COLUMN signature_nom TEXT");
  await tryExec("ALTER TABLE soumissions ADD COLUMN signature_date TEXT");
  await tryExec("ALTER TABLE soumissions ADD COLUMN signature_ip TEXT");
  await tryExec("ALTER TABLE soumissions ADD COLUMN vue_client_le TEXT");
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
  await tryExec("ALTER TABLE photos_chantier ADD COLUMN thumb_data TEXT"); // vignette ~15ko pour grilles rapides
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

  // === INDEXES PERF — toutes les sous-requêtes du dashboard ===
  // PROJ_SQL fait 5 sous-SELECT par ligne projet, ces index passent O(n²) → O(n log n)
  await tryExec("CREATE INDEX IF NOT EXISTS idx_heures_projet ON heures_projet(projet_id, date DESC)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_heures_date ON heures_projet(date DESC)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_heures_employe ON heures_projet(employe, date DESC)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_depenses_projet ON depenses_projet(projet_id, date DESC)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses_projet(date DESC)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_depenses_categorie ON depenses_projet(categorie)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_factures_projet ON factures_projet(projet_id, payee)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_factures_date ON factures_projet(date DESC)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_projets_client ON projets(client_id)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_projets_statut ON projets(statut)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_clients_statut ON clients(statut)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_clients_nom ON clients(nom)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_clients_courriel ON clients(courriel)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_clients_tel ON clients(telephone)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_employes_actif ON employes(actif)");
  // Véhicules de la flotte
  await tryExec(`CREATE TABLE IF NOT EXISTS vehicules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL, marque TEXT, modele TEXT, annee INTEGER,
    plaque TEXT, vin TEXT, date_achat TEXT, notes TEXT, date_creation TEXT
  )`);
  // Assurances (auto, responsabilité, etc.) avec documents + dates de renouvellement
  await tryExec(`CREATE TABLE IF NOT EXISTS assurances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT, compagnie TEXT, numero_police TEXT,
    vehicule_id INTEGER, date_debut TEXT, date_renouvellement TEXT,
    prime_annuelle REAL, document_data TEXT, document_type TEXT,
    notes TEXT, date_creation TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_assurances_renouv ON assurances(date_renouvellement)");
  // Banque d'heures : heures réellement travaillées + solde de banque après la période
  await tryExec("ALTER TABLE paies_periodes ADD COLUMN heures_travaillees REAL");
  await tryExec("ALTER TABLE paies_periodes ADD COLUMN banque_solde REAL DEFAULT 0");
  // Banque dispo avant la période (proposable) + heures effectivement tirées (choisi par l'utilisateur)
  await tryExec("ALTER TABLE paies_periodes ADD COLUMN banque_dispo REAL DEFAULT 0");
  await tryExec("ALTER TABLE paies_periodes ADD COLUMN banque_appliquee REAL DEFAULT 0");
  // Backfill numéros de projet manquants (anciens projets créés avant le numérotage)
  try {
    const sansNum = await all<{ id: number; date_creation: string }>("SELECT id, date_creation FROM projets WHERE numero IS NULL ORDER BY date_creation ASC, id ASC");
    if (sansNum.length > 0) {
      // Compteur par année à partir des numéros déjà attribués
      const compteurs: Record<string, number> = {};
      const existants = await all<{ numero: string }>("SELECT numero FROM projets WHERE numero IS NOT NULL");
      for (const e of existants) {
        const [an, seq] = (e.numero || "").split("-");
        const n = parseInt(seq || "0", 10);
        if (an && !isNaN(n)) compteurs[an] = Math.max(compteurs[an] || 0, n);
      }
      for (const p of sansNum) {
        const an = (p.date_creation || "").slice(0, 4) || String(new Date().getFullYear());
        compteurs[an] = (compteurs[an] || 0) + 1;
        await tryExec(`UPDATE projets SET numero='${an}-${String(compteurs[an]).padStart(3, "0")}' WHERE id=${p.id}`);
      }
    }
  } catch (e) { console.warn("[backfill numero projet]", (e as Error).message); }
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
      id INTEGER PRIMARY KEY AUTOINCREMENT, projet_id INTEGER,
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
  // MIGRATION : rendre depenses_projet.projet_id NULLABLE (dépenses générales sans projet).
  // Les anciennes installations ont projet_id NOT NULL → INSERT null échoue (500).
  // SQLite ne permet pas d'enlever NOT NULL via ALTER → reconstruction de la table.
  try {
    const info = await all<any>("PRAGMA table_info(depenses_projet)");
    const col = info.find((c) => c.name === "projet_id");
    if (col && Number(col.notnull) === 1) {
      await tryExec("ALTER TABLE depenses_projet RENAME TO depenses_projet_old");
      await tryExec(`CREATE TABLE depenses_projet (
        id INTEGER PRIMARY KEY AUTOINCREMENT, projet_id INTEGER,
        date TEXT NOT NULL, montant REAL NOT NULL, fournisseur TEXT, description TEXT,
        categorie TEXT, recu_data TEXT, recu_type TEXT, date_saisie TEXT NOT NULL
      )`);
      await tryExec(`INSERT INTO depenses_projet (id, projet_id, date, montant, fournisseur, description, categorie, recu_data, recu_type, date_saisie)
        SELECT id, projet_id, date, montant, fournisseur, description, categorie, recu_data, recu_type, date_saisie FROM depenses_projet_old`);
      await tryExec("DROP TABLE depenses_projet_old");
      await tryExec("CREATE INDEX IF NOT EXISTS idx_depenses_projet ON depenses_projet(projet_id, date DESC)");
      await tryExec("CREATE INDEX IF NOT EXISTS idx_depenses_date ON depenses_projet(date DESC)");
      await tryExec("CREATE INDEX IF NOT EXISTS idx_depenses_categorie ON depenses_projet(categorie)");
    }
  } catch (e) { console.warn("[migration depenses_projet nullable]", (e as Error).message); }

  // Schéma à jour : on enregistre la version pour sauter les migrations aux prochains démarrages.
  try { await getLibsqlClient().execute(`PRAGMA user_version = ${SCHEMA_VERSION}`); } catch { /* ignore */ }
  _initialized = true;
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
  _lastWrite = Date.now(); // invalide les caches de lecture (voir cacheLecture)
  return { lastInsertRowid: Number(r.lastInsertRowid || 0), rowsAffected: r.rowsAffected };
}

// === CACHE MÉMOIRE COURT pour requêtes de liste lourdes ===
// Sert le résultat caché uniquement si AUCUNE écriture depuis sa construction
// (toute écriture via run() avance _lastWrite) ET âge < TTL. Donc jamais de
// donnée périmée après une modification, mais lectures répétées instantanées.
let _lastWrite = 0;
const _cache = new Map<string, { builtAt: number; data: any }>();
async function cacheLecture<T>(cle: string, ttlMs: number, producteur: () => Promise<T>): Promise<T> {
  const e = _cache.get(cle);
  if (e && e.builtAt >= _lastWrite && Date.now() - e.builtAt < ttlMs) return e.data as T;
  const data = await producteur();
  _cache.set(cle, { builtAt: Date.now(), data });
  return data;
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
  const json = JSON.stringify(payload.data ?? {});
  const heures = payload.heuresEstimees ?? 0;
  const c = payload.client || {};
  // Coercition undefined → null (Turso refuse undefined : "Unsupported type of value")
  const nom = c.nom ?? null, adresse = c.adresse ?? null, tel = c.telephone ?? null,
    courriel = c.courriel ?? null, projet = c.projet ?? payload?.data?.projet ?? null;
  const total = payload.total ?? 0;

  if (existing) {
    await run(
      `UPDATE soumissions SET date_modif=?, client_nom=?, client_adresse=?, client_telephone=?, client_courriel=?, projet=?, total=?, heures_estimees=?, payload_json=? WHERE numero=?`,
      [now, nom, adresse, tel, courriel, projet, total, heures, json, numero]
    );
  } else {
    await run(
      `INSERT INTO soumissions (numero, date_creation, date_modif, client_nom, client_adresse, client_telephone, client_courriel, projet, total, heures_estimees, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero, now, now, nom, adresse, tel, courriel, projet, total, heures, json]
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

/** Marque qu'un client a ouvert le lien public (1re fois seulement). */
export async function marquerSoumissionVue(numero: string) {
  await run(`UPDATE soumissions SET vue_client_le=COALESCE(vue_client_le, ?) WHERE numero=?`, [new Date().toISOString(), numero]);
}

/** Le client accepte la soumission en ligne (signature). */
export async function signerSoumission(numero: string, nom: string, ip?: string): Promise<void> {
  const now = new Date().toISOString();
  await run(
    `UPDATE soumissions SET statut='acceptee', date_acceptation=COALESCE(date_acceptation, ?), signature_nom=?, signature_date=?, signature_ip=? WHERE numero=?`,
    [now, nom, now, ip || null, numero]
  );
}

/** Le client refuse la soumission en ligne. */
export async function refuserSoumission(numero: string, ip?: string): Promise<void> {
  const now = new Date().toISOString();
  await run(`UPDATE soumissions SET statut='refusee', date_refus=COALESCE(date_refus, ?), signature_ip=? WHERE numero=?`, [now, ip || null, numero]);
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

// Colonnes "lites" — exclut payload_json (peut peser 50-200 KB / ligne).
// Utilisé pour les listes et les stats. Récupérer payload_json via charger(numero).
const SOUM_COLS_LITES = "id, numero, date_creation, date_modif, client_nom, client_adresse, client_telephone, client_courriel, projet, statut, total, heures_estimees, heures_reelles, date_envoi, date_acceptation, date_refus, date_facturation";

export async function lister(statut?: Statut): Promise<SoumissionDB[]> {
  if (statut) return await all<SoumissionDB>(`SELECT ${SOUM_COLS_LITES} FROM soumissions WHERE statut=? ORDER BY date_creation DESC LIMIT 500`, [statut]);
  return await all<SoumissionDB>(`SELECT ${SOUM_COLS_LITES} FROM soumissions ORDER BY date_creation DESC LIMIT 500`);
}
export async function charger(numero: string): Promise<SoumissionDB | null> {
  return await one<SoumissionDB>("SELECT * FROM soumissions WHERE numero = ?", [numero]);
}
export async function supprimer(numero: string) {
  await run("DELETE FROM soumissions WHERE numero = ?", [numero]);
}

export async function statistiques() {
  // Tout en SQL pur — pas de chargement de payload_json
  const moisCourant = new Date().toISOString().slice(0, 7);
  const parStatutRows = await all<{ statut: string; n: number; total: number }>(
    `SELECT statut, COUNT(*) as n, COALESCE(SUM(total), 0) as total FROM soumissions GROUP BY statut`
  );
  const compteParStatut: Record<string, number> = {};
  const totalParStatut: Record<string, number> = {};
  let total_soumissions = 0;
  for (const r of parStatutRows) {
    compteParStatut[r.statut] = r.n;
    totalParStatut[r.statut] = r.total;
    total_soumissions += r.n;
  }
  const moisCeRow = await one<{ n: number; total: number }>(
    `SELECT COUNT(*) as n, COALESCE(SUM(total), 0) as total FROM soumissions WHERE date_creation LIKE ?`,
    [`${moisCourant}%`]
  );
  const envoyees = (compteParStatut["envoyee"] || 0) + (compteParStatut["acceptee"] || 0) + (compteParStatut["refusee"] || 0) + (compteParStatut["facturee"] || 0);
  const acceptees = (compteParStatut["acceptee"] || 0) + (compteParStatut["facturee"] || 0);
  return {
    total_soumissions,
    mois_courant: moisCeRow?.n || 0,
    total_mois_courant: moisCeRow?.total || 0,
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
  description?: string; statut?: 'a_venir' | 'actif' | 'complete' | 'en_pause' | 'annule';
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
  // Logique centralisée + testée dans lib/calculs.ts
  const m = calculerMargeProjet(r);
  return { ...r, ...m };
}

// Colonnes projets sans facture_finale_data (blob potentiel de plusieurs MB).
// La liste retourne juste un flag a_facture_finale.
const PROJ_SQL = `SELECT p.id, p.numero, p.client_id, p.nom, p.adresse_chantier, p.description, p.statut,
  p.date_debut, p.date_fin_prevue, p.date_fin_reelle, p.budget_estime, p.heures_estimees,
  p.prix_contrat, p.facture_finale_type, (p.facture_finale_data IS NOT NULL) as a_facture_finale,
  p.contrat_signe_type, (p.contrat_signe_data IS NOT NULL) as a_contrat_signe,
  p.soumission_numero, p.date_creation,
  c.nom as client_nom, c.courriel as client_courriel,
  COALESCE((SELECT SUM(heures) FROM heures_projet WHERE projet_id = p.id), 0) as total_heures,
  COALESCE((SELECT SUM(heures * taux_horaire) FROM heures_projet WHERE projet_id = p.id), 0) as cout_main_oeuvre,
  COALESCE((SELECT SUM(montant) FROM depenses_projet WHERE projet_id = p.id), 0) as total_depenses,
  COALESCE((SELECT SUM(montant) FROM factures_projet WHERE projet_id = p.id), 0) as total_facture,
  COALESCE((SELECT SUM(montant) FROM factures_projet WHERE projet_id = p.id AND payee = 1), 0) as total_paye
FROM projets p LEFT JOIN clients c ON c.id = p.client_id`;

/** Réchauffement : initialise la connexion + une requête triviale (garde Turso chaud). */
export async function pingDb(): Promise<boolean> {
  await initDb();
  await one("SELECT 1 as ok");
  return true;
}

export async function listerProjets(statut?: string): Promise<ProjetAvecTotaux[]> {
  // Cache court (10 s) invalidé par toute écriture — la liste (PROJ_SQL = 5 sous-requêtes
  // par projet) est l'une des plus lourdes ; les ouvertures répétées deviennent instantanées.
  return cacheLecture(`projets:${statut || "all"}`, 10000, async () => {
    let sql = PROJ_SQL;
    const args: any[] = [];
    if (statut) { sql += ` WHERE p.statut = ?`; args.push(statut); }
    sql += ` ORDER BY p.date_creation DESC`;
    const rows = await all<any>(sql, args);
    return rows.map(calculerTotaux);
  });
}
export async function getProjet(id: number): Promise<ProjetAvecTotaux | null> {
  // PERF : on ne charge PAS les blobs facture/contrat (plusieurs Mo) dans le JSON.
  // Les flags a_facture_finale / a_contrat_signe + les types suffisent pour l'UI ;
  // les binaires sont servis à la demande par /api/projets/[id]/facture et /contrat.
  // (Inclut client_courriel pour le courriel d'avis Google.)
  const r = await one<any>(`${PROJ_SQL} WHERE p.id = ?`, [id]);
  return r ? calculerTotaux(r) : null;
}
/** Génère le prochain numéro de projet séquentiel AAAA-NNN.
 *  Se base sur les numéros existants pour l'année courante (ne saute pas, ne duplique pas). */
export async function genererNumeroProjet(): Promise<string> {
  const annee = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric" }).format(new Date());
  const prefixe = `${annee}-`;
  const rows = await all<{ numero: string }>(
    `SELECT numero FROM projets WHERE numero LIKE ? ORDER BY numero DESC`, [`${prefixe}%`]
  );
  let max = 0;
  for (const r of rows) {
    const n = parseInt((r.numero || "").split("-")[1] || "0", 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${prefixe}${String(max + 1).padStart(3, "0")}`;
}

export async function ajouterProjet(p: Projet): Promise<number> {
  const numero = (p as any).numero || await genererNumeroProjet();
  const r = await run(
    `INSERT INTO projets (numero, client_id, nom, adresse_chantier, description, statut, date_debut, date_fin_prevue, soumission_numero, budget_estime, heures_estimees, prix_contrat, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [numero, p.client_id || null, p.nom, p.adresse_chantier || null, p.description || null,
     p.statut || 'actif', p.date_debut || null, p.date_fin_prevue || null,
     p.soumission_numero || null, p.budget_estime || null, p.heures_estimees || null,
     (p as any).prix_contrat || null,
     new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function modifierProjet(id: number, p: Partial<Projet>) {
  const champs = ['client_id', 'nom', 'adresse_chantier', 'description', 'statut', 'date_debut', 'date_fin_prevue', 'date_fin_reelle', 'budget_estime', 'heures_estimees', 'prix_contrat', 'facture_finale_data', 'facture_finale_type', 'contrat_signe_data', 'contrat_signe_type'];
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
export async function getHeureProjet(id: number) {
  return await one<any>("SELECT * FROM heures_projet WHERE id = ?", [id]);
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
    // Revenu de contrat reconnu : valeur des projets démarrés ce mois (prix_contrat sinon budget_estime)
    const contrats = (await one<any>(`SELECT COALESCE(SUM(COALESCE(prix_contrat, budget_estime, 0)), 0) as v FROM projets WHERE date_debut >= ? AND date_debut < ?`, [debut, finM]))?.v || 0;
    // Revenu reconnu = facturation réelle si elle existe, sinon valeur des contrats démarrés
    const revenu = facture > 0 ? facture : contrats;
    mois.push({ mois: m, facture, paye, depenses, mo, contrats, revenu, marge: revenu - depenses - mo });
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
// Colonnes sans le blob recu_data (perf : envoie juste un flag a_recu)
const DEPENSES_COLS_LITES = "id, projet_id, date, montant, fournisseur, description, categorie, recu_type, (recu_data IS NOT NULL) as a_recu";
export async function listerDepensesProjet(projet_id: number | null, options: { sansData?: boolean } = {}) {
  const cols = options.sansData ? DEPENSES_COLS_LITES : "*";
  if (projet_id === null) return await all<DepenseProjet>(`SELECT ${cols} FROM depenses_projet WHERE projet_id IS NULL ORDER BY date DESC`);
  return await all<DepenseProjet>(`SELECT ${cols} FROM depenses_projet WHERE projet_id = ? ORDER BY date DESC`, [projet_id]);
}
export async function listerToutesDepenses(options: { sansData?: boolean } = {}) {
  const cols = options.sansData ? DEPENSES_COLS_LITES : "*";
  return await all<DepenseProjet>(`SELECT ${cols} FROM depenses_projet ORDER BY date DESC LIMIT 500`);
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
export async function modifierDepenseProjet(id: number, d: Partial<DepenseProjet>) {
  const champs = ["projet_id", "date", "montant", "fournisseur", "description", "categorie"];
  const sets: string[] = [];
  const args: any[] = [];
  for (const c of champs) {
    if ((d as any)[c] !== undefined) { sets.push(`${c} = ?`); args.push((d as any)[c] || null); }
  }
  if (sets.length === 0) return;
  args.push(id);
  await run(`UPDATE depenses_projet SET ${sets.join(", ")} WHERE id = ?`, args);
}

// === PHOTOS CHANTIER ===
export interface PhotoChantier {
  id?: number; projet_id: number; date: string;
  employes?: string; photo_data: string; photo_type?: string;
  description?: string; date_saisie?: string; thumb_data?: string;
}
export async function listerPhotosChantier(projet_id?: number, options: { sansData?: boolean } = {}): Promise<any[]> {
  // sansData : on exclut le blob plein-format ET la vignette base64 (la grille charge
  // les vignettes via /api/photos/[id]?thumb=1, donc thumb_data ici alourdit inutilement
  // le JSON — ~30 ko × N photos). On ne garde que les métadonnées + flags.
  const cols = options.sansData
    ? "id, projet_id, date, employes, photo_type, description, date_saisie, (thumb_data IS NOT NULL) as a_thumb"
    : "*";
  if (projet_id) {
    return await all<any>(`SELECT ${cols} FROM photos_chantier WHERE projet_id = ? ORDER BY date DESC, id DESC`, [projet_id]);
  }
  return await all<any>(`SELECT ${cols} FROM photos_chantier ORDER BY date DESC, id DESC LIMIT 200`);
}
export async function getPhotoChantier(id: number): Promise<PhotoChantier | null> {
  return await one<PhotoChantier>("SELECT * FROM photos_chantier WHERE id = ?", [id]);
}
export async function getVignettePhoto(id: number): Promise<{ thumb_data?: string; photo_data?: string; photo_type?: string } | null> {
  return await one<any>("SELECT thumb_data, photo_data, photo_type FROM photos_chantier WHERE id = ?", [id]);
}
export async function ajouterPhotoChantier(p: PhotoChantier): Promise<number> {
  const r = await run(
    `INSERT INTO photos_chantier (projet_id, date, employes, photo_data, photo_type, description, date_saisie, thumb_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.projet_id, p.date, p.employes || null, p.photo_data, p.photo_type || null, p.description || null, new Date().toISOString(), p.thumb_data || null]
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

// === VÉHICULES ===
export interface Vehicule { id?: number; nom: string; marque?: string; modele?: string; annee?: number; plaque?: string; vin?: string; date_achat?: string; notes?: string; }
export async function listerVehicules(): Promise<Vehicule[]> {
  await initDb();
  return await all<Vehicule>("SELECT * FROM vehicules ORDER BY nom ASC");
}
export async function ajouterVehicule(v: Vehicule): Promise<number> {
  const r = await run(
    `INSERT INTO vehicules (nom, marque, modele, annee, plaque, vin, date_achat, notes, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [v.nom, v.marque || null, v.modele || null, v.annee || null, v.plaque || null, v.vin || null, v.date_achat || null, v.notes || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function modifierVehicule(id: number, v: Partial<Vehicule>) {
  const champs = ['nom', 'marque', 'modele', 'annee', 'plaque', 'vin', 'date_achat', 'notes'];
  const def = champs.filter(k => (v as any)[k] !== undefined);
  if (!def.length) return;
  await run(`UPDATE vehicules SET ${def.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...def.map(k => (v as any)[k] ?? null), id]);
}
export async function supprimerVehicule(id: number) { await run("DELETE FROM vehicules WHERE id = ?", [id]); }

// === ASSURANCES ===
export interface Assurance { id?: number; type?: string; compagnie?: string; numero_police?: string; vehicule_id?: number | null; date_debut?: string; date_renouvellement?: string; prime_annuelle?: number; document_data?: string; document_type?: string; notes?: string; }
// Colonnes sans le blob document (perf) + flag a_document
const ASSUR_COLS_LITES = "id, type, compagnie, numero_police, vehicule_id, date_debut, date_renouvellement, prime_annuelle, document_type, notes, date_creation, (document_data IS NOT NULL) as a_document";
export async function listerAssurances(): Promise<any[]> {
  await initDb();
  return await all<any>(`SELECT ${ASSUR_COLS_LITES} FROM assurances ORDER BY date_renouvellement ASC`);
}
export async function getAssuranceDocument(id: number): Promise<{ document_data?: string; document_type?: string } | null> {
  return await one<any>("SELECT document_data, document_type FROM assurances WHERE id = ?", [id]);
}
export async function ajouterAssurance(a: Assurance): Promise<number> {
  const r = await run(
    `INSERT INTO assurances (type, compagnie, numero_police, vehicule_id, date_debut, date_renouvellement, prime_annuelle, document_data, document_type, notes, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.type || null, a.compagnie || null, a.numero_police || null, a.vehicule_id || null, a.date_debut || null, a.date_renouvellement || null, a.prime_annuelle || null, a.document_data || null, a.document_type || null, a.notes || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function modifierAssurance(id: number, a: Partial<Assurance>) {
  const champs = ['type', 'compagnie', 'numero_police', 'vehicule_id', 'date_debut', 'date_renouvellement', 'prime_annuelle', 'document_data', 'document_type', 'notes'];
  const def = champs.filter(k => (a as any)[k] !== undefined);
  if (!def.length) return;
  await run(`UPDATE assurances SET ${def.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...def.map(k => (a as any)[k] ?? null), id]);
}
export async function supprimerAssurance(id: number) { await run("DELETE FROM assurances WHERE id = ?", [id]); }

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

// Logique paie centralisée + testée dans lib/calculs.ts
const periodeBiHebdo = periodeBiHebdoCalc;
const calculerHeuresPaye = calculerHeuresPayeCalc;

/** Génère/met à jour les périodes de paye à partir des heures saisies.
 *  Retourne la liste des périodes pour un employé donné (ou tous). */
export async function listerPaiePeriodes(employe?: string, limit = 12): Promise<PaiePeriode[]> {
  await initDb();
  // 0. Auto-nettoyage : supprime les périodes orphelines (ex. anciennes lignes
  //    créées par un ancien calcul de période bugué qui ne correspondent plus
  //    à aucune heure réelle). Ne touche jamais une période marquée payée.
  await nettoyerPayePeriodesOrphelines().catch(() => {});
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

  // 3. BANQUE D'HEURES — traitement CHRONOLOGIQUE par employé.
  //    Pas de prime ×1.5 : les heures au-delà de 80h/quinzaine sont ACCUMULÉES
  //    dans une banque, et servent à compléter une quinzaine sous 80h plus tard.
  const SEUIL = 80;
  // Regrouper les groupes par employé, triés par date de début (ancien → récent)
  const parEmploye = new Map<string, typeof groupes extends Map<string, infer V> ? V[] : never>();
  for (const g of groupes.values()) {
    if (!parEmploye.has(g.employe)) parEmploye.set(g.employe, [] as any);
    (parEmploye.get(g.employe) as any).push(g);
  }
  for (const [, liste] of parEmploye) {
    (liste as any[]).sort((a, b) => a.debut.localeCompare(b.debut));
    let banque = 0; // solde courant de la banque (heures accumulées non payées)
    for (const g of liste as any[]) {
      const travaillees = g.heures.reduce((s: number, e: any) => s + (e.heures || 0), 0);
      const base = Math.min(travaillees, SEUIL);          // heures payées d'office (max 80)
      const surplus = Math.max(0, travaillees - SEUIL);   // surplus → accumulé en banque
      const dispoAvant = banque;                          // banque disponible AVANT cette période

      const existant = await one<any>("SELECT * FROM paies_periodes WHERE employe = ? AND debut = ? AND fin = ?", [g.employe, g.debut, g.fin]);

      // Heures tirées de la banque pour combler cette période — CHOISI par l'utilisateur (banque_appliquee).
      // Jamais automatique : on propose seulement. Plafonné au manque (80 - travaillees) et à la dispo.
      let appliquee = 0;
      if (existant?.paye) {
        appliquee = Math.min(existant.banque_appliquee || 0, dispoAvant);
      } else if (travaillees < SEUIL) {
        appliquee = Math.min(existant?.banque_appliquee || 0, SEUIL - travaillees, dispoAvant);
      }
      const payees = base + appliquee;
      banque = dispoAvant + surplus - appliquee;          // solde résultant

      // Taux normal sur les heures payées — AUCUNE prime ×1.5, l'overtime $ n'existe pas
      const brut = payees * g.taux;
      const dasMontant = brut * 0.15;
      const net = brut - dasMontant;

      if (existant) {
        if (!existant.paye) {
          await run(
            `UPDATE paies_periodes SET heures_normales=?, heures_sup=0, heures_travaillees=?, banque_dispo=?, banque_appliquee=?, banque_solde=?, taux_horaire=?, montant_brut=?, das_montant=?, montant_net=? WHERE id=?`,
            [payees, travaillees, dispoAvant, appliquee, banque, g.taux, brut, dasMontant, net, existant.id]
          );
        } else {
          // Période payée : on ne touche pas la paie, mais on rafraîchit les champs d'affichage de la banque.
          await run(`UPDATE paies_periodes SET banque_dispo=?, banque_solde=? WHERE id=?`, [dispoAvant, banque, existant.id]);
        }
      } else {
        await run(
          `INSERT INTO paies_periodes (employe, debut, fin, heures_normales, heures_sup, heures_travaillees, banque_dispo, banque_appliquee, banque_solde, taux_horaire, das_pct, montant_brut, das_montant, montant_net, paye, date_creation) VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [g.employe, g.debut, g.fin, payees, travaillees, dispoAvant, banque, g.taux, 0.15, brut, dasMontant, net, new Date().toISOString()]
        );
      }
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
/** Définit le nombre d'heures tirées de la banque pour combler une période (choix utilisateur).
 *  Le recalcul (montants, solde) se fait au prochain listerPaiePeriodes. */
export async function definirBanqueAppliquee(id: number, heures: number) {
  await run("UPDATE paies_periodes SET banque_appliquee = ? WHERE id = ? AND paye = 0", [Math.max(0, heures || 0), id]);
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
    // 1. Borne mal alignée avec l'ancrage de paie actuel → période obsolète, on supprime.
    const aligne = periodeBiHebdoCalc(p.debut);
    if (aligne.debut !== p.debut || aligne.fin !== p.fin) {
      await run("DELETE FROM paies_periodes WHERE id = ?", [p.id]);
      deleted++;
      continue;
    }
    // 2. Aucune heure réelle dans la période → orpheline, on supprime.
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

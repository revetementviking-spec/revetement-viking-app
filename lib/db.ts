// Base de données — fonctionne en local (file:) ou en cloud (Turso libsql:)
// Si TURSO_URL est définie → utilise Turso, sinon SQLite local
import { createClient, type Client as LibsqlClient, type ResultSet } from "@libsql/client";
import path from "path";
import fs from "fs";
import { calculerMargeProjet, revenuAvantTaxes, depensesAvantTaxes, avancerDateRecurrence, periodeBiHebdo as periodeBiHebdoCalc, calculerHeuresPaye as calculerHeuresPayeCalc, calculerPaye, heuresDuesPeriodePayee, SEUIL_SUP_PERIODE } from "@/lib/calculs";
import { SQL_PROJET_ACTIF } from "@/lib/statuts-projet";
import { estStatutSoumission, STATUTS_SOUMISSION } from "@/lib/vocabulaire";
import { aujourdhuiMontreal } from "./date";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "soumissions.db");

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let _client: LibsqlClient | null = null;
let _initialized = false;
let _initPromise: Promise<void> | null = null;
// Incrémenter à CHAQUE changement de schéma (nouvelle colonne/table/index).
// Tant que la version stockée (PRAGMA user_version) ≥ cette valeur, initDb saute
// toutes les migrations → 1 seul aller-retour réseau au lieu de ~70 (clé de la rapidité).
const SCHEMA_VERSION = 24;

function getLibsqlClient(): LibsqlClient {
  if (_client) return _client;
  const tursoUrl = process.env.TURSO_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl) {
    _client = createClient({ url: tursoUrl, authToken: tursoToken });
  } else {
    _client = createClient({ url: `file:${DB_PATH}` });
  }
  // SQL_DEBUG=1 : trace chaque requête sur stderr. En production la base est DISTANTE
  // (Turso) : chaque requête est un aller-retour réseau, donc le COMPTE de requêtes par
  // appel API est la mesure qui compte — pas la durée locale sur un fichier SQLite.
  // Sans la variable, aucun coût.
  if (process.env.SQL_DEBUG === "1") {
    const brut = _client;
    const origExec = brut.execute.bind(brut);
    const origBatch = brut.batch.bind(brut);
    brut.execute = ((s: any) => { console.error("[SQL]", (typeof s === "string" ? s : s.sql).replace(/\s+/g, " ").slice(0, 90)); return origExec(s); }) as any;
    brut.batch = ((st: any, mode?: any) => { console.error(`[SQL] BATCH ×${Array.isArray(st) ? st.length : "?"}`); return origBatch(st, mode); }) as any;
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
    // Migrations idempotentes : on ignore les erreurs attendues.
    // - "duplicate column"/"already exists" : colonne/index déjà présent (base déjà migrée).
    // - "no such table" : la migration (ALTER/INDEX) précède la création de la table sur une
    //   base NEUVE ; la table sera créée juste après par execMany() avec son schéma complet.
    if (!/(duplicate column|already exists|no such table)/i.test(e?.message || "")) throw e;
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
  // Base : creer les tables AVANT les migrations ALTER (robuste sur base neuve).
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
  // Migrations idempotentes pour les anciennes installations
  await tryExec("ALTER TABLE clients ADD COLUMN statut TEXT DEFAULT 'prospect'");
  await tryExec("ALTER TABLE clients ADD COLUMN source TEXT");
  await tryExec("ALTER TABLE clients ADD COLUMN tags TEXT");
  await tryExec("ALTER TABLE clients ADD COLUMN asana_gid TEXT");
  await tryExec("ALTER TABLE clients ADD COLUMN asana_modifie_le TEXT");
  // Pipeline CRM : étape du parcours commercial (info, RDV, mesures, soum, attente, accepté)
  await tryExec("ALTER TABLE clients ADD COLUMN pipeline_stage TEXT");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_clients_pipeline ON clients(pipeline_stage)");
  // Pipeline enrichi style Asana : assignation (Gabriel/Francis), date de relance/rappel
  await tryExec("ALTER TABLE clients ADD COLUMN assignee TEXT");
  await tryExec("ALTER TABLE clients ADD COLUMN date_relance TEXT");
  await tryExec("ALTER TABLE clients ADD COLUMN projet_lien_id INTEGER");
  await tryExec("ALTER TABLE clients ADD COLUMN instructions_speciales TEXT");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_clients_assignee ON clients(assignee)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_clients_relance ON clients(date_relance)");
  // Fichiers attachés aux clients (plans, photos, contrats) — drag & drop dans le pipeline
  await tryExec(`CREATE TABLE IF NOT EXISTS client_fichiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL, nom TEXT, type TEXT, taille INTEGER,
    data TEXT NOT NULL, ajoute_par TEXT, date_ajout TEXT NOT NULL
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_client_fichiers_cli ON client_fichiers(client_id, date_ajout DESC)");
  // Documents d'un CHANTIER : permis, plans, garanties, fiches techniques, rapports
  // d'inspection… Distinct des photos de chantier (galerie datée), du contrat signé et de
  // la facture finale, qui ont chacun leur emplacement dédié. Même forme que
  // client_fichiers pour que les deux espaces se comportent pareil.
  await tryExec(`CREATE TABLE IF NOT EXISTS projet_fichiers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projet_id INTEGER NOT NULL, nom TEXT, type TEXT, taille INTEGER,
    categorie TEXT, description TEXT,
    data TEXT NOT NULL, ajoute_par TEXT, date_ajout TEXT NOT NULL
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_projet_fichiers_proj ON projet_fichiers(projet_id, date_ajout DESC)");
  // Sous-tâches d'une carte pipeline (checklist style Asana)
  await tryExec(`CREATE TABLE IF NOT EXISTS client_taches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL, titre TEXT NOT NULL,
    complete INTEGER DEFAULT 0, assignee TEXT, ordre INTEGER DEFAULT 0,
    date_creation TEXT NOT NULL, date_completion TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_client_taches_cli ON client_taches(client_id, ordre)");
  // Échéance optionnelle sur les tâches client (affichée sur le tableau de bord par utilisateur)
  await tryExec("ALTER TABLE client_taches ADD COLUMN date_echeance TEXT");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_client_taches_assignee ON client_taches(assignee, complete, date_echeance)");
  // Tâches générales (table taches_client) : récurrence + index de suivi.
  await tryExec("ALTER TABLE taches_client ADD COLUMN recurrence TEXT");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_taches_client_suivi ON taches_client(assigne_a, statut, date_due)");

  // === INVENTAIRE matériaux en stock ===
  await tryExec(`CREATE TABLE IF NOT EXISTS inventaire (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    categorie TEXT,
    quantite REAL DEFAULT 0,
    unite TEXT DEFAULT 'u',
    emplacement TEXT,
    photo_data TEXT, photo_type TEXT,
    notes TEXT,
    cout_unit REAL,
    date_creation TEXT,
    date_modif TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_inventaire_emplacement ON inventaire(emplacement)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_inventaire_nom ON inventaire(nom)");
  // Mouvements pour traçabilité (entree, sortie, ajustement)
  await tryExec(`CREATE TABLE IF NOT EXISTS inventaire_mouvements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inventaire_id INTEGER NOT NULL,
    delta REAL NOT NULL,
    type TEXT,
    note TEXT,
    par TEXT,
    date_creation TEXT
  )`);

  // === CACHE PRIX WEB (Maibec/Canexel/Hardie) — TTL 7 jours ===
  await tryExec(`CREATE TABLE IF NOT EXISTS prix_cache_v2 (
    cle TEXT PRIMARY KEY,
    produit TEXT,
    prix_unit REAL,
    unite TEXT,
    source TEXT,
    note TEXT,
    date_creation TEXT,
    date_expire TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_prix_cache_expire ON prix_cache_v2(date_expire)");

  // === FEEDBACK IA : corrections apportées par l'humain sur les outputs auto-estimateur ===
  await tryExec(`CREATE TABLE IF NOT EXISTS ia_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    soumission_numero TEXT,
    avant_json TEXT,
    apres_json TEXT,
    differences TEXT,
    par TEXT,
    date_creation TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_ia_feedback_date ON ia_feedback(date_creation DESC)");

  // === PARAMÈTRES IA modifiables par l'utilisateur (règles métier injectées dans les prompts) ===
  await tryExec(`CREATE TABLE IF NOT EXISTS parametres_ia (
    cle TEXT PRIMARY KEY,
    valeur TEXT NOT NULL,
    label TEXT,
    description TEXT,
    type TEXT DEFAULT 'text',
    date_modif TEXT
  )`);

  // === DOCUMENTS DE RÉFÉRENCE (PDF, Excel, prix fournisseurs) lus par l'IA lors des soumissions ===
  await tryExec(`CREATE TABLE IF NOT EXISTS documents_ia (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    type_mime TEXT,
    taille INTEGER,
    data_b64 TEXT NOT NULL,
    contenu_texte TEXT,
    tags TEXT,
    actif INTEGER DEFAULT 1,
    par TEXT,
    date_creation TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_documents_ia_actif ON documents_ia(actif, date_creation DESC)");

  // === CATALOGUE MATÉRIAUX (modifiable manuellement, source officielle des prix) ===
  await tryExec(`CREATE TABLE IF NOT EXISTS catalogue_materiaux (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    type TEXT,
    fournisseur TEXT,
    unite TEXT NOT NULL,
    format_paquet REAL,
    format_paquet_label TEXT,
    prix_coutant REAL,
    majoration_pct REAL DEFAULT 20,
    prix_vente REAL,
    notes TEXT,
    actif INTEGER DEFAULT 1,
    date_creation TEXT,
    date_modif TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_catalogue_type ON catalogue_materiaux(type, actif)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_catalogue_nom ON catalogue_materiaux(nom)");

  // === NOTES RAPIDES (vocales ou texte) attachées à un projet ===
  await tryExec(`CREATE TABLE IF NOT EXISTS notes_rapides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projet_id INTEGER,
    client_id INTEGER,
    texte TEXT NOT NULL,
    source TEXT,
    auteur TEXT,
    date_creation TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_notes_rapides_projet ON notes_rapides(projet_id, date_creation DESC)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_notes_rapides_client ON notes_rapides(client_id, date_creation DESC)");

  // === CAMÉRAS de sécurité (URL embed ou stream) ===
  await tryExec(`CREATE TABLE IF NOT EXISTS cameras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    emplacement TEXT,
    url_embed TEXT,
    type TEXT,
    actif INTEGER DEFAULT 1,
    ordre INTEGER DEFAULT 0,
    date_creation TEXT
  )`);
  // Fil de commentaires
  await tryExec(`CREATE TABLE IF NOT EXISTS client_commentaires (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL, auteur TEXT, texte TEXT NOT NULL,
    mentions TEXT, date_creation TEXT NOT NULL
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_client_comm_cli ON client_commentaires(client_id, date_creation DESC)");
  // Profil utilisateur (Gabriel/Francis) : infos modifiables côté UI
  await tryExec(`CREATE TABLE IF NOT EXISTS utilisateur_profil (
    username TEXT PRIMARY KEY,
    nom_affichage TEXT, telephone TEXT, courriel TEXT, role TEXT,
    photo_data TEXT, photo_type TEXT,
    date_creation TEXT, date_modif TEXT
  )`);
  // Badge "Reno assistance" sur les projets (visible dans la liste + détail)
  await tryExec("ALTER TABLE projets ADD COLUMN reno_assistance INTEGER DEFAULT 0");
  // Contrats générés depuis le pipeline (avec signature en ligne par token public)
  await tryExec(`CREATE TABLE IF NOT EXISTS pipeline_contrats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    numero TEXT, token TEXT UNIQUE NOT NULL,
    data_json TEXT NOT NULL,
    pdf_brouillon TEXT, pdf_signe TEXT,
    signature_dataurl TEXT, signature_nom TEXT, signature_date TEXT, signature_ip TEXT,
    statut TEXT DEFAULT 'brouillon',
    cree_par TEXT, date_creation TEXT NOT NULL, date_envoye TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_pipe_contrats_cli ON pipeline_contrats(client_id, date_creation DESC)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_pipe_contrats_token ON pipeline_contrats(token)");
  // Preuve de transmission style DocuSign : vue + envoi mail
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN date_vue TEXT");
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN ip_vue TEXT");
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN courriel_destinataire TEXT");
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN courriel_message_id TEXT");
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN courriel_erreur TEXT");
  // Devis joint au contrat : le client le consulte depuis la page de signature et le
  // reçoit avec le contrat signé. C'est une pièce du dossier, donc elle est archivée
  // avec le contrat plutôt que rangée à part.
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN annexe_data TEXT");
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN annexe_nom TEXT");
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN annexe_type TEXT");
  // Projet créé à la SIGNATURE (et non à la préparation du contrat) : ce lien évite d'en
  // créer un deuxième si le contrat est resigné ou si un projet existait déjà.
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN projet_id INTEGER");
  // Certificat d'authentification : empreinte scellée du PDF signé (preuve d'intégrité),
  // navigateur du signataire, et traçage de l'envoi du dossier signé au client.
  // Journal des coûts IA. Était créée par un CREATE TABLE IF NOT EXISTS à CHAQUE appel au
  // modèle (un aller-retour de plus à chaque fois) — sa place est ici, avec le reste.
  await tryExec(`CREATE TABLE IF NOT EXISTS ia_couts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outil TEXT, model TEXT,
    input_tokens INTEGER, output_tokens INTEGER,
    cache_write_tokens INTEGER, cache_read_tokens INTEGER,
    cout_usd REAL, utilisateur TEXT, date TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_ia_couts_date ON ia_couts(date)");
  // Photos de la bibliothèque de jobs. Elles étaient écrites sur le disque local
  // (data/photos-biblio) : perdu à chaque déploiement sur Vercel, et aucune route ne les
  // servait. Stockage en base comme photos_chantier.
  await tryExec(`CREATE TABLE IF NOT EXISTS bibliotheque_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    data TEXT NOT NULL, type TEXT,
    date_ajout TEXT NOT NULL
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_biblio_photos_job ON bibliotheque_photos(job_id)");
  // Qui reçoit un talon de paie : les propriétaires ne s'en remettent pas un à eux-mêmes,
  // mais leurs périodes restent calculées (coût de chantier). Défaut 1 = une nouvelle
  // embauche en reçoit un, ce qui est le cas normal.
  await tryExec("ALTER TABLE employes ADD COLUMN recoit_talon INTEGER DEFAULT 1");
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN pdf_signe_sha256 TEXT");
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN signature_user_agent TEXT");
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN date_signe_envoye TEXT");
  await tryExec("ALTER TABLE pipeline_contrats ADD COLUMN signe_destinataire TEXT");
  // « Ajouté par » sur les principales entités (qui a saisi cette dépense / heure / etc.)
  await tryExec("ALTER TABLE depenses_projet ADD COLUMN ajoute_par TEXT");
  await tryExec("ALTER TABLE heures_projet ADD COLUMN ajoute_par TEXT");
  await tryExec("ALTER TABLE projets ADD COLUMN cree_par TEXT");
  await tryExec("ALTER TABLE projets ADD COLUMN modifie_par TEXT");
  await tryExec("ALTER TABLE photos_chantier ADD COLUMN ajoute_par TEXT");
  await tryExec("ALTER TABLE factures_projet ADD COLUMN ajoute_par TEXT");
  await tryExec("ALTER TABLE clients ADD COLUMN cree_par TEXT");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_depenses_ajoute_par ON depenses_projet(ajoute_par)");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_heures_ajoute_par ON heures_projet(ajoute_par)");
  // Notifications push PWA (subscription par utilisateur+appareil)
  await tryExec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    utilisateur TEXT NOT NULL, endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL, auth TEXT NOT NULL,
    user_agent TEXT, date_creation TEXT NOT NULL
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(utilisateur)");
  // Audit : qui a fait l'action ?
  await tryExec("ALTER TABLE journal_activite ADD COLUMN utilisateur TEXT");
  await tryExec("CREATE INDEX IF NOT EXISTS idx_journal_user ON journal_activite(utilisateur)");
  await tryExec("ALTER TABLE depenses_projet ADD COLUMN recu_data TEXT");
  await tryExec("ALTER TABLE depenses_projet ADD COLUMN recu_type TEXT");
  // Verrouillage optimiste (B7) : compteur incrémenté à chaque UPDATE. Permet de
  // détecter qu'un autre utilisateur a modifié la ligne entre le chargement et la sauvegarde.
  await tryExec("ALTER TABLE depenses_projet ADD COLUMN version INTEGER NOT NULL DEFAULT 0");
  await tryExec("ALTER TABLE heures_projet ADD COLUMN version INTEGER NOT NULL DEFAULT 0");
  // Facture détaxée (sans TPS/TVQ) : ne pas retirer les taxes du montant dans les calculs avant-taxes.
  await tryExec("ALTER TABLE depenses_projet ADD COLUMN detaxe INTEGER NOT NULL DEFAULT 0");
  // Réglages applicatifs clé/valeur (ex. mode maintenance)
  await tryExec("CREATE TABLE IF NOT EXISTS parametres_app (cle TEXT PRIMARY KEY, valeur TEXT)");
  // Migration UNIQUE (gardée) : règle « complété = facturé ». Aligne les projets déjà
  // complétés une seule fois — ne se ré-applique pas si on re-bascule un projet à facturer.
  try {
    const fait = await one<{ valeur: string }>("SELECT valeur FROM parametres_app WHERE cle = 'mig_complete_facture'");
    if (!fait) {
      await run("UPDATE projets SET facturee = 1 WHERE statut = 'complete'");
      await run("INSERT OR REPLACE INTO parametres_app (cle, valeur) VALUES ('mig_complete_facture', '1')");
    }
  } catch { /* table projets pas encore prête sur une base neuve : la règle s'applique alors à la complétion */ }
  // Extras à facturer (travaux/matériaux supplémentaires hors soumission)
  await tryExec(`CREATE TABLE IF NOT EXISTS extras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    projet_id INTEGER, date TEXT, nature TEXT, description TEXT,
    montant REAL, heures REAL, photo_data TEXT, thumb_data TEXT,
    statut TEXT DEFAULT 'a_charger', saisi_par TEXT, date_creation TEXT, date_charge TEXT
  )`);
  await tryExec("CREATE INDEX IF NOT EXISTS idx_extras_statut ON extras(statut, date DESC)");
  await tryExec("ALTER TABLE projets ADD COLUMN prix_contrat REAL");
  await tryExec("ALTER TABLE projets ADD COLUMN numero TEXT");
  // Suivi facturation : 0 = à facturer (rappel dashboard), 1 = facturé
  await tryExec("ALTER TABLE projets ADD COLUMN facturee INTEGER NOT NULL DEFAULT 0");
  await tryExec("ALTER TABLE projets ADD COLUMN contrat_signe_data TEXT");
  await tryExec("ALTER TABLE projets ADD COLUMN contrat_signe_type TEXT");
  // Signature en ligne des soumissions par le client
  await tryExec("ALTER TABLE soumissions ADD COLUMN signature_nom TEXT");
  await tryExec("ALTER TABLE soumissions ADD COLUMN signature_date TEXT");
  await tryExec("ALTER TABLE soumissions ADD COLUMN signature_ip TEXT");
  await tryExec("ALTER TABLE soumissions ADD COLUMN vue_client_le TEXT");
  await tryExec("ALTER TABLE projets ADD COLUMN facture_finale_data TEXT");
  await tryExec("ALTER TABLE projets ADD COLUMN facture_finale_type TEXT");
  // Durée prévue des travaux (jours) — sert à placer le projet sur l'échéancier.
  await tryExec("ALTER TABLE projets ADD COLUMN duree_jours REAL");
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
    ip TEXT, user_agent TEXT,
    -- IMPORTANT : colonne incluse ici (et pas seulement via l'ALTER plus haut, qui
    -- s'exécute AVANT ce CREATE). Sur une base neuve l'ALTER échoue silencieusement,
    -- la table naissait sans « utilisateur » → toute journalisation échouait, ce qui
    -- désactivait aussi le rate-limit du login (il compte les lignes de ce journal).
    utilisateur TEXT
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
  // Catégories de dépenses : gérables par l'utilisateur (ajout/renommage/désactivation)
  await tryExec(`CREATE TABLE IF NOT EXISTS categories_depense (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT UNIQUE NOT NULL, ordre INTEGER DEFAULT 99,
    actif INTEGER DEFAULT 1, date_creation TEXT
  )`);
  // Seed par défaut (idempotent grâce à INSERT OR IGNORE) — anciennes constantes du code
  for (const [i, nom] of ["matériaux", "outils", "location", "sous-traitant", "transport", "permis", "essence", "autre"].entries()) {
    await tryExec(`INSERT OR IGNORE INTO categories_depense (nom, ordre, actif, date_creation) VALUES ('${nom}', ${i}, 1, '${new Date().toISOString()}')`);
  }
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
/** Plusieurs écritures en UN aller-retour. En production la base est distante : N `run()`
 *  = N allers-retours réseau ; un lot = un seul. Vide → ne fait rien. */
async function runBatch(stmts: { sql: string; args: any[] }[]): Promise<void> {
  if (!stmts.length) return;
  await initDb();
  await getLibsqlClient().batch(stmts, "write");
  _lastWrite = Date.now();
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
  signature_nom?: string | null; signature_date?: string | null; signature_ip?: string | null; vue_client_le?: string | null;
  payload_json: string;
}

// === SOUMISSIONS ===
export async function genererNumero(): Promise<string> {
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, "");
  // MAX du suffixe, PAS COUNT : avec COUNT, supprimer une soumission du milieu
  // faisait retomber sur un numéro déjà pris → la nouvelle ÉCRASAIT l'ancienne
  // (branche UPDATE de sauvegarder). MAX+1 reste monotone même après suppression.
  const r = await one<{ mx: string }>("SELECT MAX(numero) as mx FROM soumissions WHERE numero LIKE ?", [`XP-${ymd}-%`]);
  let n = 0;
  const m = r?.mx ? String(r.mx).match(/-(\d+)$/) : null;
  if (m) n = parseInt(m[1], 10) || 0;
  const seq = String(n + 1).padStart(3, "0");
  return `XP-${ymd}-${seq}`;
}

export async function sauvegarder(payload: {
  numero?: string; client: any; total: number;
  heuresEstimees?: number; data: any;
}): Promise<string> {
  const numero = payload.numero || await genererNumero();
  const now = new Date().toISOString();
  const existing = await one<any>(
    "SELECT id, signature_nom, signature_date, statut FROM soumissions WHERE numero = ?", [numero]
  );
  // Une soumission SIGNÉE par le client en ligne ne doit plus changer : sinon la base
  // affirme qu'il a signé à telle date, depuis telle IP, un document dont le prix et les
  // lignes ont été modifiés depuis. Il faut dupliquer pour repartir d'une base révisée.
  if (existing?.signature_nom) {
    // `code` reconnu par la route pour répondre 409 (refus délibéré) et non 500
    // (panne serveur). Le message était bon, mais le code disait « l'app est cassée ».
    throw Object.assign(
      new Error(`La soumission ${numero} a été SIGNÉE par le client le ${String((existing as any).signature_date || "").slice(0, 10) || "—"} : elle ne peut plus être modifiée. Duplique-la pour créer une version révisée.`),
      { code: "SOUMISSION_SIGNEE" }
    );
  }
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
  // Vocabulaire fermé. Mesuré : « statut_bidon » était enregistré en 200, et la
  // soumission disparaissait de TOUS les onglets (Brouillon, Envoyée, Acceptée…) —
  // introuvable à l'écran alors qu'elle existe en base.
  if (!estStatutSoumission(statut)) {
    throw Object.assign(new Error(`Statut de soumission inconnu « ${statut} » (attendu : ${STATUTS_SOUMISSION.join(", ")}).`), { code: "STATUT_INVALIDE" });
  }
  // Une soumission SIGNÉE par le client ne redevient pas un brouillon. Son contenu était
  // déjà verrouillé (voir sauvegarder), mais son statut, lui, se changeait librement :
  // on pouvait remettre en « brouillon » une soumission acceptée et signée, ce qui la
  // sortait du pipeline et des relances tout en gardant la signature au dossier.
  // Seul « facturee » reste permis : c'est la suite normale.
  const sig = await one<{ signature_nom: string | null }>("SELECT signature_nom FROM soumissions WHERE numero = ?", [numero]);
  if (sig?.signature_nom && statut !== "facturee" && statut !== "acceptee") {
    throw Object.assign(
      new Error(`La soumission ${numero} a été signée par ${sig.signature_nom} : son statut ne peut plus revenir à « ${statut} ». Duplique-la pour repartir d'une version révisée.`),
      { code: "SOUMISSION_SIGNEE" }
    );
  }
  const now = new Date().toISOString();
  const dateCol = statut === "envoyee" ? "date_envoi" :
    statut === "acceptee" ? "date_acceptation" :
    statut === "refusee" ? "date_refus" :
    statut === "facturee" ? "date_facturation" : null;
  if (dateCol) {
    // COALESCE : on garde la 1re date (ex. date_envoi). Avant, re-cliquer « envoyée »
    // réécrivait date_envoi = aujourd'hui → le cron de relance (seuil 7 j) repartait à
    // zéro et une soumission traînante n'était jamais relancée.
    await run(`UPDATE soumissions SET statut=?, ${dateCol}=COALESCE(${dateCol}, ?) WHERE numero=?`, [statut, now, numero]);
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

// LIMIT 5000 : colonnes "lites" (sans payload_json) → transfert léger. La pagination
// se fait côté client (composant Pagination) ; ce plafond évite juste une requête
// non bornée. Au-delà de 5000 soumissions, passer à une vraie pagination serveur.
export async function lister(statut?: Statut): Promise<SoumissionDB[]> {
  if (statut) return await all<SoumissionDB>(`SELECT ${SOUM_COLS_LITES} FROM soumissions WHERE statut=? ORDER BY date_creation DESC LIMIT 5000`, [statut]);
  return await all<SoumissionDB>(`SELECT ${SOUM_COLS_LITES} FROM soumissions ORDER BY date_creation DESC LIMIT 5000`);
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
export async function ajouterClient(c: any): Promise<number> {
  const r = await run(
    `INSERT INTO clients (nom, courriel, telephone, adresse, notes, statut, source, tags, pipeline_stage, assignee, date_relance, projet_lien_id, date_creation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(c.nom ?? "").trim(), // trim : un espace parasite créait des doublons (la recherche compare TRIM)
      c.courriel || null,
      c.telephone || null,
      c.adresse || null,
      c.notes || null,
      c.statut || "prospect",
      c.source || null,
      c.tags || null,
      c.pipeline_stage || null,
      c.assignee || null,
      c.date_relance || null,
      c.projet_lien_id || null,
      new Date().toISOString(),
    ]
  );
  return r.lastInsertRowid;
}
export async function modifierClient(id: number, c: Partial<ClientType>) {
  const champs = ['nom', 'courriel', 'telephone', 'adresse', 'notes', 'statut', 'source', 'tags', 'asana_gid', 'asana_modifie_le', 'pipeline_stage', 'assignee', 'date_relance', 'projet_lien_id', 'instructions_speciales'];
  const definis = champs.filter(k => (c as any)[k] !== undefined);
  if (!definis.length) return;
  const sets = definis.map(k => `${k} = ?`).join(', ');
  const valeurs = definis.map(k => (c as any)[k]);
  await run(`UPDATE clients SET ${sets} WHERE id = ?`, [...valeurs, id]);
}
export async function supprimerClient(id: number): Promise<{ ok: boolean; raison?: string; contrats_signes?: number }> {
  // GARDE-FOU : un contrat SIGNÉ est une pièce juridique (PDF signé + empreinte scellée +
  // chronologie). La cascade le détruisait sans le moindre avertissement — on refuse.
  const signes = await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM pipeline_contrats WHERE client_id = ? AND statut = 'signe'", [id]
  ).catch(() => ({ n: 0 }));
  const nb = Number(signes?.n || 0);
  if (nb > 0) {
    return { ok: false, contrats_signes: nb, raison: `Ce client a ${nb} contrat(s) SIGNÉ(S). Les supprimer effacerait la pièce signée et son certificat d'authentification, sans copie. Supprime d'abord les contrats si c'est vraiment voulu.` };
  }
  // Suppression en cascade : aucune contrainte FK n'existe, donc on nettoie à la main.
  // Sinon sous-tâches, commentaires et surtout FICHIERS (blobs base64) restaient en
  // base indéfiniment sous un client_id mort → base qui gonfle + stats faussées.
  // `pipeline_contrats` n'est purgé que de ses BROUILLONS (les signés sont refusés plus haut).
  for (const t of ["interactions_client", "client_taches", "client_commentaires", "client_fichiers", "taches_client"]) {
    await run(`DELETE FROM ${t} WHERE client_id = ?`, [id]).catch(() => {});
  }
  await run("DELETE FROM pipeline_contrats WHERE client_id = ? AND statut != 'signe'", [id]).catch(() => {});
  // Ce qui SURVIT au client garde une référence morte si on ne la coupe pas : un projet
  // pointant sur un client_id disparu, une note ou un contrat rattachés à personne.
  // On ne les supprime pas — un chantier ne disparaît pas parce qu'on efface une fiche —
  // on coupe seulement le lien.
  await run("UPDATE projets SET client_id = NULL WHERE client_id = ?", [id]).catch(() => {});
  await run("UPDATE notes_rapides SET client_id = NULL WHERE client_id = ?", [id]).catch(() => {});
  await run("UPDATE contrats SET client_id = NULL WHERE client_id = ?", [id]).catch(() => {});
  await run("DELETE FROM clients WHERE id = ?", [id]);
  return { ok: true };
}
/** Cherche un client par son nom exact (insensible à la casse et aux espaces de bord).
 *  Sert à savoir si une création de projet a AJOUTÉ un client ou réutilisé une fiche —
 *  pour pouvoir le dire à l'écran plutôt que de laisser deviner. */
export async function clientParNom(nom: string): Promise<{ id: number; nom: string } | null> {
  if (!nom?.trim()) return null;
  return await one<{ id: number; nom: string }>(
    "SELECT id, nom FROM clients WHERE LOWER(TRIM(nom)) = LOWER(?)", [nom.trim()]
  );
}

export async function trouverOuCreerClient(nom: string, infos?: Partial<ClientType>): Promise<number> {
  if (!nom?.trim()) return 0;
  const existant = await one<{ id: number }>("SELECT id FROM clients WHERE LOWER(TRIM(nom)) = LOWER(?)", [nom.trim()]);
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
  recurrence?: string; date_creation?: string; date_completion?: string;
}
export async function listerTaches(filtres?: { statut?: string; client_id?: number; projet_id?: number; assigne_a?: string }): Promise<Tache[]> {
  const conds: string[] = []; const args: any[] = [];
  if (filtres?.statut) { conds.push("t.statut = ?"); args.push(filtres.statut); }
  if (filtres?.client_id) { conds.push("t.client_id = ?"); args.push(filtres.client_id); }
  if (filtres?.projet_id) { conds.push("t.projet_id = ?"); args.push(filtres.projet_id); }
  if (filtres?.assigne_a) { conds.push("t.assigne_a = ?"); args.push(filtres.assigne_a); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  // Jointures facultatives pour afficher le client / projet rattaché.
  return await all<Tache>(`SELECT t.*, c.nom AS client_nom, p.nom AS projet_nom
    FROM taches_client t
    LEFT JOIN clients c ON c.id = t.client_id
    LEFT JOIN projets p ON p.id = t.projet_id
    ${where}
    ORDER BY CASE t.statut WHEN 'a_faire' THEN 0 WHEN 'en_cours' THEN 1 ELSE 2 END, (t.date_due IS NULL) ASC, t.date_due ASC, t.priorite DESC`, args);
}
export async function ajouterTache(t: Tache): Promise<number> {
  const r = await run(
    `INSERT INTO taches_client (client_id, projet_id, titre, description, date_due, priorite, statut, assigne_a, recurrence, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [t.client_id || null, t.projet_id || null, t.titre, t.description || null,
     t.date_due || null, t.priorite ?? 3, t.statut || 'a_faire', t.assigne_a || null, t.recurrence || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function modifierTache(id: number, t: Partial<Tache>) {
  const champs = ['titre', 'description', 'date_due', 'priorite', 'statut', 'assigne_a', 'recurrence', 'date_completion'];
  const definis = champs.filter(k => (t as any)[k] !== undefined);
  if (!definis.length) return;
  const sets = definis.map(k => `${k} = ?`).join(', ');
  const valeurs = definis.map(k => (t as any)[k]);
  await run(`UPDATE taches_client SET ${sets} WHERE id = ?`, [...valeurs, id]);
}
export async function supprimerTache(id: number) {
  await run("DELETE FROM taches_client WHERE id = ?", [id]);
}
/** Marque une tâche complétée. Si elle est récurrente, recrée la prochaine occurrence. */
export async function terminerTache(id: number, dateCompletion: string): Promise<{ prochaine?: number }> {
  const t = await one<any>("SELECT * FROM taches_client WHERE id = ?", [id]);
  if (!t) return {};
  await run("UPDATE taches_client SET statut = 'complete', date_completion = ? WHERE id = ?", [dateCompletion, id]);
  if (t.recurrence) {
    const prochaineDate = avancerDateRecurrence(t.date_due, t.recurrence);
    const r = await run(
      `INSERT INTO taches_client (client_id, projet_id, titre, description, date_due, priorite, statut, assigne_a, recurrence, date_creation) VALUES (?, ?, ?, ?, ?, ?, 'a_faire', ?, ?, ?)`,
      [t.client_id || null, t.projet_id || null, t.titre, t.description || null, prochaineDate, t.priorite ?? 3, t.assigne_a || null, t.recurrence, new Date().toISOString()]
    );
    return { prochaine: r.lastInsertRowid };
  }
  return {};
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
  const ymd = aujourdhuiMontreal().replace(/-/g, "");
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
  date_debut?: string; date_fin_prevue?: string; date_fin_reelle?: string; duree_jours?: number;
  soumission_numero?: string; budget_estime?: number; heures_estimees?: number;
  prix_contrat?: number; facture_finale_data?: string; facture_finale_type?: string;
  date_creation?: string;
}
export interface ProjetAvecTotaux extends Projet {
  client_nom?: string; total_heures: number; cout_main_oeuvre: number;
  total_depenses: number; total_depenses_detaxe?: number; total_depenses_avant_taxes?: number;
  total_facture: number; total_paye: number;
  cout_total: number; marge: number; marge_pct: number; pct_budget_consomme: number;
  revenu?: number; revenu_avant_taxes?: number; extras_factures?: number;
}

function calculerTotaux(r: any): ProjetAvecTotaux {
  // Logique centralisée + testée dans lib/calculs.ts
  // RENTABILITÉ AVANT TAXES : le revenu est ramené avant taxes, donc les dépenses
  // DOIVENT l'être aussi (sinon on soustrait des montants taxes incluses d'un revenu
  // hors taxes → marge sous-estimée d'environ 13 % des dépenses taxables).
  // Les factures détaxées n'ont pas de taxes à retirer. Même règle que l'écran Finances.
  const total_depenses_avant_taxes = depensesAvantTaxes(r.total_depenses || 0, r.total_depenses_detaxe || 0);
  const m = calculerMargeProjet({ ...r, total_depenses: total_depenses_avant_taxes });
  // `total_depenses` reste le montant réellement payé (taxes incluses) pour l'affichage ;
  // la marge, elle, est calculée sur `total_depenses_avant_taxes`.
  return { ...r, ...m, total_depenses_avant_taxes };
}

// Colonnes projets sans facture_finale_data (blob potentiel de plusieurs MB).
// La liste retourne juste un flag a_facture_finale.
const PROJ_SQL = `SELECT p.id, p.numero, p.client_id, p.nom, p.adresse_chantier, p.description, p.statut,
  p.date_debut, p.date_fin_prevue, p.date_fin_reelle, p.duree_jours, p.budget_estime, p.heures_estimees,
  p.prix_contrat, p.facture_finale_type, (p.facture_finale_data IS NOT NULL) as a_facture_finale,
  p.contrat_signe_type, (p.contrat_signe_data IS NOT NULL) as a_contrat_signe,
  p.reno_assistance, p.cree_par, p.modifie_par, p.soumission_numero, p.date_creation,
  c.nom as client_nom, c.courriel as client_courriel,
  COALESCE((SELECT SUM(heures) FROM heures_projet WHERE projet_id = p.id), 0) as total_heures,
  COALESCE((SELECT SUM(heures * taux_horaire) FROM heures_projet WHERE projet_id = p.id), 0) as cout_main_oeuvre,
  COALESCE((SELECT SUM(montant) FROM depenses_projet WHERE projet_id = p.id), 0) as total_depenses,
  COALESCE((SELECT SUM(montant) FROM depenses_projet WHERE projet_id = p.id AND detaxe = 1), 0) as total_depenses_detaxe,
  COALESCE((SELECT SUM(montant) FROM factures_projet WHERE projet_id = p.id), 0) as total_facture,
  COALESCE((SELECT SUM(montant) FROM factures_projet WHERE projet_id = p.id AND payee = 1), 0) as total_paye,
  COALESCE((SELECT SUM(montant) FROM extras WHERE projet_id = p.id AND statut = 'charge'), 0) as extras_factures
FROM projets p LEFT JOIN clients c ON c.id = p.client_id`;

// === CONTRATS PIPELINE (avec signature en ligne) ===
export async function creerContratPipeline(p: {
  client_id: number; numero: string; token: string;
  data_json: any; pdf_brouillon: string; cree_par?: string;
  annexe_data?: string | null; annexe_nom?: string | null; annexe_type?: string | null;
}): Promise<number> {
  const r = await run(
    `INSERT INTO pipeline_contrats (client_id, numero, token, data_json, pdf_brouillon, cree_par, date_creation, statut, annexe_data, annexe_nom, annexe_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'brouillon', ?, ?, ?)`,
    [p.client_id, p.numero, p.token, JSON.stringify(p.data_json), p.pdf_brouillon, p.cree_par || null, new Date().toISOString(),
     p.annexe_data || null, p.annexe_nom || null, p.annexe_type || null]
  );
  return r.lastInsertRowid;
}

/** Joint (ou remplace) le devis d'un contrat. Refusé une fois le contrat SIGNÉ : le
 *  dossier signé est une pièce figée, on n'y ajoute pas une annexe après coup. */
export async function definirAnnexeContrat(id: number, a: { data: string; nom: string; type: string } | null): Promise<{ ok: boolean; raison?: string }> {
  const c = await one<{ statut: string }>("SELECT statut FROM pipeline_contrats WHERE id = ?", [id]);
  if (!c) return { ok: false, raison: "contrat introuvable" };
  if (c.statut === "signe") return { ok: false, raison: "Ce contrat est déjà signé : son dossier ne peut plus être modifié." };
  await run("UPDATE pipeline_contrats SET annexe_data=?, annexe_nom=?, annexe_type=? WHERE id=?",
    [a?.data || null, a?.nom || null, a?.type || null, id]);
  return { ok: true };
}
export async function listerContratsParClient(client_id: number): Promise<any[]> {
  return await all<any>(
    `SELECT id, client_id, numero, token, statut, signature_nom, signature_date, signature_ip,
            cree_par, date_creation, date_envoye, date_vue, ip_vue,
            courriel_destinataire, courriel_message_id, courriel_erreur,
            date_signe_envoye, signe_destinataire, pdf_signe_sha256,
            (pdf_signe IS NOT NULL) as a_signe
     FROM pipeline_contrats WHERE client_id = ? ORDER BY date_creation DESC`,
    [client_id]
  );
}
export async function getContratPipelineParToken(token: string): Promise<any | null> {
  return await one<any>("SELECT * FROM pipeline_contrats WHERE token = ?", [token]);
}
export async function getPDFContratPipeline(token: string, signe = false): Promise<string | null> {
  const r = await one<any>(`SELECT ${signe ? "pdf_signe" : "pdf_brouillon"} as pdf FROM pipeline_contrats WHERE token = ?`, [token]);
  return r?.pdf || null;
}
export async function signerContratPipeline(token: string, p: {
  signature_dataurl: string; signature_nom: string; pdf_signe: string; ip?: string;
  sha256?: string; user_agent?: string;
}): Promise<boolean> {
  const r = await run(
    `UPDATE pipeline_contrats SET signature_dataurl=?, signature_nom=?, signature_date=?, signature_ip=?, pdf_signe=?,
            pdf_signe_sha256=?, signature_user_agent=?, statut='signe'
     WHERE token = ? AND statut != 'signe'`,
    [p.signature_dataurl, p.signature_nom, new Date().toISOString(), p.ip || null, p.pdf_signe,
     p.sha256 || null, p.user_agent || null, token]
  );
  return r.rowsAffected > 0;
}
/** Crée le projet à partir d'un contrat SIGNÉ, et le lie au contrat.
 *
 *  Le projet naît ici — pas à la préparation du contrat. Avant, préparer un contrat
 *  créait déjà un projet : tout brouillon jamais signé laissait un chantier fantôme dans
 *  la liste et dans les chiffres. Idempotent : si le contrat porte déjà un projet (ou si
 *  un projet a été créé à la main pour ce même numéro), on le met à jour au lieu d'en
 *  créer un second. */
export async function creerProjetDepuisContrat(token: string): Promise<{ ok: boolean; projet_id?: number; cree?: boolean; raison?: string }> {
  const c = await one<any>("SELECT * FROM pipeline_contrats WHERE token = ?", [token]);
  if (!c) return { ok: false, raison: "contrat introuvable" };
  if (c.statut !== "signe") return { ok: false, raison: "contrat non signé" };

  const d = JSON.parse(c.data_json || "{}");
  const prix = Number(d.prix_total) || null;
  const nom = String(d.nom_projet || d.client_nom || `Contrat ${c.numero || ""}`).trim().slice(0, 200);

  // 1. Déjà lié ? 2. Sinon, un projet porte-t-il déjà ce numéro de contrat ?
  let projetId: number | null = c.projet_id || null;
  if (!projetId && c.numero) {
    const existant = await one<{ id: number }>("SELECT id FROM projets WHERE numero = ?", [c.numero]);
    if (existant) projetId = existant.id;
  }

  const champs = {
    client_id: c.client_id || null,
    nom,
    adresse_chantier: d.adresse_chantier || d.client_adresse || null,
    description: d.notes_travaux || null,
    statut: "actif",
    date_debut: isoDepuisDateFr(d.date_debut_travaux),
    soumission_numero: d.soumission_numero || null,
    prix_contrat: prix,
    budget_estime: prix,
  };

  let cree = false;
  if (projetId) {
    // On ne réécrit que ce qui est vide côté projet : si Francis a déjà ajusté l'adresse
    // ou la date à la main, la signature ne doit pas écraser son travail.
    const p = await one<any>("SELECT * FROM projets WHERE id = ?", [projetId]);
    const maj: any = {};
    for (const [k, v] of Object.entries(champs)) {
      if (v === null || v === undefined || v === "") continue;
      if (k === "statut") { maj.statut = "actif"; continue; }
      if (p?.[k] === null || p?.[k] === undefined || p?.[k] === "") maj[k] = v;
    }
    // Le prix du contrat signé fait foi, même si un budget estimé existait.
    if (prix) { maj.prix_contrat = prix; maj.budget_estime = prix; }
    if (Object.keys(maj).length) await modifierProjet(projetId, maj);
  } else {
    projetId = await ajouterProjet({ ...(champs as any), numero: c.numero || undefined, cree_par: "Signature client" } as any);
    cree = true;
  }

  await run("UPDATE pipeline_contrats SET projet_id = ? WHERE token = ?", [projetId, token]);

  // La fiche CRM suit le dossier. C'était l'ancien bouton « Accepter » qui faisait ça ;
  // maintenant que le contrat se prépare sur sa propre page, plus rien ne le faisait :
  // un client pouvait avoir signé et rester affiché en « Soumission à envoyer » dans le
  // kanban. On ne rétrograde jamais un client déjà marqué perdu ou inactif à la main.
  if (c.client_id) {
    const cl = await one<{ statut: string | null }>("SELECT statut FROM clients WHERE id = ?", [c.client_id]);
    const statut = cl?.statut === "perdu" || cl?.statut === "inactif" ? cl.statut : "actif";
    await run("UPDATE clients SET pipeline_stage = 'accepte', statut = ?, projet_lien_id = ? WHERE id = ?",
      [statut, projetId, c.client_id]);
  }
  // Le PDF signé est aussi rattaché à la fiche projet : c'est là que Francis le cherche.
  if (c.pdf_signe) {
    await modifierProjet(projetId, { contrat_signe_data: c.pdf_signe, contrat_signe_type: "application/pdf" } as any);
  }
  return { ok: true, projet_id: projetId, cree };
}

/** « 2026-08-15 » ou « 15 août 2026 » → ISO, ou null si illisible. Le contrat stocke la
 *  date telle qu'affichée au client ; le projet, lui, exige un AAAA-MM-JJ. */
function isoDepuisDateFr(v: any): string | null {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Trace l'envoi du dossier signé (contrat + certificat) au client. */
export async function marquerDossierSigneEnvoye(token: string, destinataire: string): Promise<void> {
  await run("UPDATE pipeline_contrats SET date_signe_envoye=?, signe_destinataire=? WHERE token=?",
    [new Date().toISOString(), destinataire, token]);
}
export async function marquerContratEnvoye(id: number, courriel?: string, messageId?: string, erreur?: string) {
  // Un envoi RATÉ ne doit pas passer le contrat à « envoyé » : le client n'a rien reçu,
  // mais l'écran affichait « Envoyé », le filtre le rangeait avec les vrais envois, et la
  // relance automatique le comptait « sans réponse depuis N jours ». On ne garde que la
  // trace de l'échec (destinataire tenté + erreur) ; statut et date d'envoi ne bougent pas.
  if (erreur) {
    await run(
      "UPDATE pipeline_contrats SET courriel_destinataire=?, courriel_erreur=? WHERE id=? AND statut!='signe'",
      [courriel || null, erreur, id]
    );
    return;
  }
  await run(
    "UPDATE pipeline_contrats SET statut='envoye', date_envoye=?, courriel_destinataire=?, courriel_message_id=?, courriel_erreur=NULL WHERE id=? AND statut!='signe'",
    [new Date().toISOString(), courriel || null, messageId || null, id]
  );
}
/** Enregistre la première vue par le client (pour preuve de transmission). */
export async function marquerContratVu(token: string, ip?: string): Promise<void> {
  await run("UPDATE pipeline_contrats SET date_vue=?, ip_vue=? WHERE token=? AND date_vue IS NULL", [new Date().toISOString(), ip || null, token]);
}
export async function getContratPipelineParId(id: number): Promise<any | null> {
  return await one<any>("SELECT * FROM pipeline_contrats WHERE id = ?", [id]);
}
export async function supprimerContratPipeline(id: number): Promise<{ ok: boolean; raison?: string }> {
  // Même garde que sur la suppression de client : un contrat SIGNÉ emporte le PDF signé,
  // l'empreinte scellée et la chronologie. Protéger la fiche client ne servait à rien tant
  // que cette porte directe restait ouverte.
  const c = await one<{ statut: string }>("SELECT statut FROM pipeline_contrats WHERE id = ?", [id]);
  if (!c) return { ok: false, raison: "contrat introuvable" };
  if (c.statut === "signe") {
    return { ok: false, raison: "Ce contrat est SIGNÉ : le supprimer effacerait la pièce signée et son certificat d'authentification, sans copie." };
  }
  await run("DELETE FROM pipeline_contrats WHERE id = ?", [id]);
  return { ok: true };
}

// === FICHIERS ATTACHÉS AUX CLIENTS (pipeline Asana-style) ===
export async function listerFichiersClient(client_id: number): Promise<any[]> {
  return await all<any>(
    "SELECT id, client_id, nom, type, taille, ajoute_par, date_ajout FROM client_fichiers WHERE client_id = ? ORDER BY date_ajout DESC",
    [client_id]
  );
}
export async function getFichierClient(id: number): Promise<{ data: string; type: string; nom: string } | null> {
  return await one<any>("SELECT data, type, nom FROM client_fichiers WHERE id = ?", [id]);
}
export async function ajouterFichierClient(f: { client_id: number; nom: string; type: string; data: string; taille?: number; ajoute_par?: string }): Promise<number> {
  const r = await run(
    "INSERT INTO client_fichiers (client_id, nom, type, taille, data, ajoute_par, date_ajout) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [f.client_id, f.nom, f.type, f.taille || null, f.data, f.ajoute_par || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function supprimerFichierClient(id: number): Promise<void> {
  await run("DELETE FROM client_fichiers WHERE id = ?", [id]);
}

// === DOCUMENTS DE CHANTIER (permis, plans, garanties…) ===
/** La colonne `data` (le fichier en base64) est volontairement EXCLUE de la liste :
 *  quelques documents de 3 Mo suffiraient à rendre l'ouverture de l'onglet interminable.
 *  Le contenu passe par sa propre route, un fichier à la fois. */
export async function listerFichiersProjet(projet_id: number): Promise<any[]> {
  return await all<any>(
    "SELECT id, projet_id, nom, type, taille, categorie, description, ajoute_par, date_ajout FROM projet_fichiers WHERE projet_id = ? ORDER BY date_ajout DESC",
    [projet_id]
  );
}
export async function getFichierProjet(id: number): Promise<{ data: string; type: string; nom: string } | null> {
  return await one<any>("SELECT data, type, nom FROM projet_fichiers WHERE id = ?", [id]);
}
export async function ajouterFichierProjet(f: {
  projet_id: number; nom: string; type: string; data: string;
  taille?: number; categorie?: string; description?: string; ajoute_par?: string;
}): Promise<number> {
  const r = await run(
    "INSERT INTO projet_fichiers (projet_id, nom, type, taille, categorie, description, data, ajoute_par, date_ajout) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [f.projet_id, f.nom, f.type, f.taille || null, f.categorie || null, f.description || null, f.data, f.ajoute_par || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function modifierFichierProjet(id: number, f: { nom?: string; categorie?: string; description?: string }): Promise<boolean> {
  const sets: string[] = []; const args: any[] = [];
  if (f.nom !== undefined) { const n = String(f.nom || "").trim(); if (!n) return false; sets.push("nom = ?"); args.push(n.slice(0, 200)); }
  if (f.categorie !== undefined) { sets.push("categorie = ?"); args.push(f.categorie || null); }
  if (f.description !== undefined) { sets.push("description = ?"); args.push(f.description || null); }
  if (!sets.length) return true;
  const r = await run(`UPDATE projet_fichiers SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
  return r.rowsAffected > 0;
}
export async function supprimerFichierProjet(id: number): Promise<void> {
  await run("DELETE FROM projet_fichiers WHERE id = ?", [id]);
}
export async function compterFichiersProjet(projet_id: number): Promise<number> {
  const r = await one<{ n: number }>("SELECT COUNT(*) AS n FROM projet_fichiers WHERE projet_id = ?", [projet_id]);
  return r?.n || 0;
}

/** Catégorie la plus utilisée par fournisseur (auto-suggestion). */
export async function categoriesParFournisseur(): Promise<Record<string, string>> {
  const rows = await all<any>(
    `SELECT fournisseur, categorie, COUNT(*) as n
     FROM depenses_projet
     WHERE fournisseur IS NOT NULL AND fournisseur != '' AND categorie IS NOT NULL AND categorie != ''
     GROUP BY fournisseur, categorie
     ORDER BY n DESC`
  );
  const out: Record<string, string> = {};
  for (const r of rows) {
    const f = String(r.fournisseur || "").toLowerCase().trim();
    if (!f || out[f]) continue; // garde le plus fréquent
    out[f] = r.categorie;
  }
  return out;
}

// === SOUS-TÂCHES (checklist d'une carte pipeline) ===
export async function listerTachesClient(client_id: number): Promise<any[]> {
  return await all<any>("SELECT * FROM client_taches WHERE client_id = ? ORDER BY ordre, id", [client_id]);
}
export async function ajouterTacheClient(client_id: number, titre: string, assignee?: string, date_echeance?: string): Promise<number> {
  const o = (await one<{ n: number }>("SELECT COALESCE(MAX(ordre),0)+1 as n FROM client_taches WHERE client_id = ?", [client_id]))?.n || 1;
  const r = await run(
    "INSERT INTO client_taches (client_id, titre, complete, assignee, date_echeance, ordre, date_creation) VALUES (?, ?, 0, ?, ?, ?, ?)",
    [client_id, titre.trim(), assignee || null, date_echeance || null, o, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function modifierTacheClient(id: number, champs: { titre?: string; complete?: boolean; assignee?: string | null; date_echeance?: string | null }): Promise<void> {
  const sets: string[] = [], args: any[] = [];
  if (champs.titre !== undefined) { sets.push("titre = ?"); args.push(champs.titre); }
  if (champs.complete !== undefined) { sets.push("complete = ?"); sets.push("date_completion = ?"); args.push(champs.complete ? 1 : 0); args.push(champs.complete ? new Date().toISOString() : null); }
  if (champs.assignee !== undefined) { sets.push("assignee = ?"); args.push(champs.assignee || null); }
  if (champs.date_echeance !== undefined) { sets.push("date_echeance = ?"); args.push(champs.date_echeance || null); }
  if (!sets.length) return;
  args.push(id);
  await run(`UPDATE client_taches SET ${sets.join(", ")} WHERE id = ?`, args);
}

// Liste les tâches d'un utilisateur précis (pour tableau de bord)
export async function tachesPourUtilisateur(assignee: string): Promise<any[]> {
  return await all<any>(`
    SELECT t.*, c.nom AS client_nom
    FROM client_taches t
    LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.assignee = ? AND (t.complete IS NULL OR t.complete = 0)
    ORDER BY (t.date_echeance IS NULL) ASC, t.date_echeance ASC, t.id DESC
  `, [assignee]);
}
export async function supprimerTacheClient(id: number): Promise<void> {
  await run("DELETE FROM client_taches WHERE id = ?", [id]);
}

// === COMMENTAIRES (fil de discussion) ===
export async function listerCommentairesClient(client_id: number): Promise<any[]> {
  return await all<any>("SELECT * FROM client_commentaires WHERE client_id = ? ORDER BY date_creation ASC", [client_id]);
}
export async function ajouterCommentaireClient(c: { client_id: number; auteur: string | null; texte: string; mentions?: string[] }): Promise<number> {
  const r = await run(
    "INSERT INTO client_commentaires (client_id, auteur, texte, mentions, date_creation) VALUES (?, ?, ?, ?, ?)",
    [c.client_id, c.auteur, c.texte, (c.mentions && c.mentions.length) ? c.mentions.join(",") : null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function supprimerCommentaireClient(id: number): Promise<void> {
  await run("DELETE FROM client_commentaires WHERE id = ?", [id]);
}

// === PROFIL UTILISATEUR ===
export async function getProfilUtilisateur(username: string): Promise<any | null> {
  return await one<any>("SELECT * FROM utilisateur_profil WHERE username = ?", [username]);
}
export async function majProfilUtilisateur(username: string, p: { nom_affichage?: string; telephone?: string; courriel?: string; role?: string; photo_data?: string; photo_type?: string }): Promise<void> {
  const existant = await getProfilUtilisateur(username);
  const champs = ['nom_affichage', 'telephone', 'courriel', 'role', 'photo_data', 'photo_type'];
  if (existant) {
    const sets: string[] = [], args: any[] = [];
    for (const c of champs) if ((p as any)[c] !== undefined) { sets.push(`${c} = ?`); args.push((p as any)[c] || null); }
    if (!sets.length) return;
    sets.push("date_modif = ?"); args.push(new Date().toISOString());
    args.push(username);
    await run(`UPDATE utilisateur_profil SET ${sets.join(", ")} WHERE username = ?`, args);
  } else {
    const now = new Date().toISOString();
    await run(
      `INSERT INTO utilisateur_profil (username, nom_affichage, telephone, courriel, role, photo_data, photo_type, date_creation, date_modif) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, p.nom_affichage || null, p.telephone || null, p.courriel || null, p.role || null, p.photo_data || null, p.photo_type || null, now, now]
    );
  }
}

// === NOTIFICATIONS PIPELINE par utilisateur ===
export async function mentionsRecentes(user: string, depuisJours = 7): Promise<any[]> {
  const seuil = new Date(Date.now() - depuisJours * 86400000).toISOString();
  return await all<any>(
    `SELECT c.id, c.client_id, c.auteur, c.texte, c.mentions, c.date_creation,
            cl.nom as client_nom
     FROM client_commentaires c
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE c.date_creation >= ? AND c.mentions LIKE ?
     ORDER BY c.date_creation DESC LIMIT 50`,
    [seuil, `%${user}%`]
  );
}
export async function relancesPourUser(user: string): Promise<any[]> {
  const today = aujourdhuiMontreal();
  return await all<any>(
    `SELECT id, nom, adresse, telephone, courriel, pipeline_stage, date_relance
     FROM clients
     WHERE date_relance IS NOT NULL AND date_relance != '' AND date_relance <= ?
       AND (assignee = ? OR assignee IS NULL OR assignee = '')
     ORDER BY date_relance ASC`,
    [today, user]
  );
}
/** Compteurs par client (sous-tâches, commentaires, fichiers) pour les badges du pipeline */
export async function statsPipelineParClient(): Promise<Record<number, { taches_total: number; taches_done: number; commentaires: number; fichiers: number }>> {
  const t = await all<any>("SELECT client_id, COUNT(*) as n, SUM(complete) as done FROM client_taches GROUP BY client_id");
  const co = await all<any>("SELECT client_id, COUNT(*) as n FROM client_commentaires GROUP BY client_id");
  const f = await all<any>("SELECT client_id, COUNT(*) as n FROM client_fichiers GROUP BY client_id");
  const out: Record<number, any> = {};
  for (const r of t) out[r.client_id] = { ...(out[r.client_id] || {}), taches_total: Number(r.n) || 0, taches_done: Number(r.done) || 0 };
  for (const r of co) out[r.client_id] = { ...(out[r.client_id] || {}), commentaires: Number(r.n) || 0 };
  for (const r of f) out[r.client_id] = { ...(out[r.client_id] || {}), fichiers: Number(r.n) || 0 };
  return out;
}

// === RELANCES — clients dont la date de relance est due ===
export async function relancesDues(): Promise<{ id: number; nom: string; courriel?: string; telephone?: string; adresse?: string; pipeline_stage?: string; assignee?: string; date_relance: string }[]> {
  const today = aujourdhuiMontreal();
  return await all<any>(
    `SELECT id, nom, courriel, telephone, adresse, pipeline_stage, assignee, date_relance
     FROM clients
     WHERE date_relance IS NOT NULL AND date_relance != '' AND date_relance <= ?
     ORDER BY date_relance ASC`,
    [today]
  );
}

// === CATÉGORIES DE DÉPENSES ===
export async function listerCategoriesDepense(actives = true): Promise<{ id: number; nom: string; ordre: number; actif: number }[]> {
  const where = actives ? "WHERE actif = 1" : "";
  return await all<any>(`SELECT id, nom, ordre, actif FROM categories_depense ${where} ORDER BY ordre, nom`);
}
export async function ajouterCategorieDepense(nom: string): Promise<number> {
  const ordre = (await one<{ n: number }>("SELECT COALESCE(MAX(ordre), 0) + 1 as n FROM categories_depense"))?.n || 1;
  const r = await run(
    "INSERT INTO categories_depense (nom, ordre, actif, date_creation) VALUES (?, ?, 1, ?)",
    [nom.trim(), ordre, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function renommerCategorieDepense(id: number, nouveau: string): Promise<void> {
  const old = await one<{ nom: string }>("SELECT nom FROM categories_depense WHERE id = ?", [id]);
  if (!old) return;
  const nv = nouveau.trim();
  await run("UPDATE categories_depense SET nom = ? WHERE id = ?", [nv, id]);
  // Cascade : renomme aussi dans les dépenses existantes
  await run("UPDATE depenses_projet SET categorie = ? WHERE categorie = ?", [nv, old.nom]);
}
export async function supprimerCategorieDepense(id: number): Promise<void> {
  // Soft delete : on désactive (on ne casse pas l'historique des dépenses)
  await run("UPDATE categories_depense SET actif = 0 WHERE id = ?", [id]);
}
export async function reactiverCategorieDepense(id: number): Promise<void> {
  await run("UPDATE categories_depense SET actif = 1 WHERE id = ?", [id]);
}

// === NOTIFICATIONS PUSH (PWA) ===
export async function ajouterPushSubscription(p: { utilisateur: string; endpoint: string; p256dh: string; auth: string; user_agent?: string }): Promise<void> {
  await run(
    `INSERT OR REPLACE INTO push_subscriptions (utilisateur, endpoint, p256dh, auth, user_agent, date_creation) VALUES (?, ?, ?, ?, ?, ?)`,
    [p.utilisateur, p.endpoint, p.p256dh, p.auth, p.user_agent || null, new Date().toISOString()]
  );
}
export async function supprimerPushSubscription(endpoint: string): Promise<void> {
  await run("DELETE FROM push_subscriptions WHERE endpoint = ?", [endpoint]);
}
export async function listerPushSubscriptionsUser(user: string): Promise<{ endpoint: string; p256dh: string; auth: string }[]> {
  return await all<any>("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE utilisateur = ?", [user]);
}

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
    // « actif » veut dire « chantier en activité » : il couvre AUSSI « en_cours », posé
    // par le bouton « Commencer ce chantier ». Sans ça, démarrer un chantier le faisait
    // disparaître du tableau de bord et des sélecteurs de projet.
    if (statut === "actif") sql += ` WHERE p.${SQL_PROJET_ACTIF}`;
    else if (statut) { sql += ` WHERE p.statut = ?`; args.push(statut); }
    sql += ` ORDER BY p.date_creation DESC`;
    const rows = await all<any>(sql, args);
    return rows.map(calculerTotaux);
  });
}
// Version LÉGÈRE pour les menus déroulants : pas de sous-requêtes coûts/marges
// (PROJ_SQL en fait 5 par projet). Beaucoup plus rapide quand on n'a besoin que
// de l'id + nom + statut (page Heures, filtres, etc.).
export async function listerProjetsLite(statut?: string): Promise<any[]> {
  return cacheLecture(`projets_lite:${statut || "all"}`, 10000, async () => {
    let sql = `SELECT p.id, p.numero, p.nom, p.adresse_chantier, p.statut, p.date_creation, p.budget_estime, p.date_fin_reelle, p.date_fin_prevue, c.nom as client_nom
               FROM projets p LEFT JOIN clients c ON c.id = p.client_id`;
    const args: any[] = [];
    // « actif » veut dire « chantier en activité » : il couvre AUSSI « en_cours », posé
    // par le bouton « Commencer ce chantier ». Sans ça, démarrer un chantier le faisait
    // disparaître du tableau de bord et des sélecteurs de projet.
    if (statut === "actif") sql += ` WHERE p.${SQL_PROJET_ACTIF}`;
    else if (statut) { sql += ` WHERE p.statut = ?`; args.push(statut); }
    sql += ` ORDER BY p.date_creation DESC`;
    return await all<any>(sql, args);
  });
}
/** Projets complétés mais PAS encore marqués facturés (rappel "à facturer"). */
export async function listerProjetsAFacturer(): Promise<any[]> {
  return await all<any>(
    `SELECT p.id, p.nom, p.prix_contrat, p.budget_estime, p.date_fin_reelle, c.nom as client_nom
     FROM projets p LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.statut = 'complete' AND COALESCE(p.facturee, 0) = 0
     ORDER BY COALESCE(p.date_fin_reelle, p.date_fin_prevue, p.date_creation) DESC LIMIT 50`
  );
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
    `INSERT INTO projets (numero, client_id, nom, adresse_chantier, description, statut, date_debut, date_fin_prevue, soumission_numero, budget_estime, heures_estimees, prix_contrat, cree_par, date_creation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [numero, p.client_id || null, p.nom, p.adresse_chantier || null, p.description || null,
     p.statut || 'actif', p.date_debut || null, p.date_fin_prevue || null,
     p.soumission_numero || null, p.budget_estime || null, p.heures_estimees || null,
     (p as any).prix_contrat || null, (p as any).cree_par || null,
     new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function modifierProjet(id: number, p: Partial<Projet>) {
  const champs = ['client_id', 'nom', 'adresse_chantier', 'description', 'statut', 'date_debut', 'date_fin_prevue', 'date_fin_reelle', 'duree_jours', 'budget_estime', 'heures_estimees', 'prix_contrat', 'facture_finale_data', 'facture_finale_type', 'contrat_signe_data', 'contrat_signe_type', 'reno_assistance', 'facturee', 'modifie_par'];
  const definis = champs.filter(k => (p as any)[k] !== undefined);
  if (!definis.length) return;
  const sets = definis.map(k => `${k} = ?`).join(', ');
  const valeurs = definis.map(k => (p as any)[k]);
  await run(`UPDATE projets SET ${sets} WHERE id = ?`, [...valeurs, id]);
}
export async function supprimerProjet(id: number): Promise<{ ok: boolean; raison?: string }> {
  // Un contrat signé téléversé sur le projet est une pièce à conserver.
  const p = await one<any>("SELECT (contrat_signe_data IS NOT NULL) AS a_contrat FROM projets WHERE id = ?", [id]);
  if (p && Number(p.a_contrat)) {
    return { ok: false, raison: "Ce projet porte un contrat signé joint. Retire-le d'abord si la suppression est vraiment voulue." };
  }
  await run("DELETE FROM heures_projet WHERE projet_id = ?", [id]);
  await run("DELETE FROM factures_projet WHERE projet_id = ?", [id]);
  await run("DELETE FROM depenses_projet WHERE projet_id = ?", [id]);
  // Étaient laissés orphelins : les PHOTOS (blobs, hors sauvegarde → invisibles et
  // impurgeables), les EXTRAS (qui continuaient d'alimenter le badge « à facturer »
  // sans pouvoir être rattachés), les tâches et les notes.
  await run("DELETE FROM photos_chantier WHERE projet_id = ?", [id]).catch(() => {});
  await run("DELETE FROM extras WHERE projet_id = ?", [id]).catch(() => {});
  // Les DOCUMENTS de chantier tombent dans le même piège que les photos : des blobs qui
  // survivraient au projet, invisibles (plus aucune fiche ne les affiche) et impurgeables.
  await run("DELETE FROM projet_fichiers WHERE projet_id = ?", [id]).catch(() => {});
  await run("UPDATE taches_client SET projet_id = NULL WHERE projet_id = ?", [id]).catch(() => {});
  await run("UPDATE notes_rapides SET projet_id = NULL WHERE projet_id = ?", [id]).catch(() => {});
  // Le contrat signé, lui, se GARDE (pièce juridique) : on coupe seulement le lien vers
  // un projet qui n'existe plus, sinon il pointerait dans le vide.
  await run("UPDATE pipeline_contrats SET projet_id = NULL WHERE projet_id = ?", [id]).catch(() => {});
  await run("UPDATE contrats SET projet_id = NULL WHERE projet_id = ?", [id]).catch(() => {});
  await run("DELETE FROM projets WHERE id = ?", [id]);
  return { ok: true };
}

// === HEURES ===
export interface HeureProjet {
  id?: number; projet_id: number; date: string; heures: number;
  description?: string; employe?: string; taux_horaire?: number;
}
export async function listerHeuresProjet(projet_id: number) {
  return await all<HeureProjet>("SELECT * FROM heures_projet WHERE projet_id = ? ORDER BY date DESC, id DESC", [projet_id]);
}
export async function ajouterHeureProjet(h: HeureProjet & { ajoute_par?: string }): Promise<number> {
  const r = await run(
    `INSERT INTO heures_projet (projet_id, date, heures, description, employe, taux_horaire, ajoute_par, date_saisie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [h.projet_id, h.date, h.heures, h.description || null, h.employe || null, h.taux_horaire ?? 90, h.ajoute_par || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
/** Vrai si la date/employé d'une entrée d'heures tombe dans une paie DÉJÀ VERSÉE. */
export async function heureDansPaiePayee(employe: string | null, date: string): Promise<boolean> {
  if (!employe || !date) return false;
  const r = await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM paies_periodes WHERE employe = ? AND paye = 1 AND ? BETWEEN debut AND fin",
    [employe, String(date).slice(0, 10)]
  ).catch(() => ({ n: 0 }));
  return Number(r?.n || 0) > 0;
}

export async function supprimerHeureProjet(id: number): Promise<{ ok: boolean; raison?: string }> {
  // Une paie versée a été calculée sur ces heures. Les effacer fait diverger le talon
  // remis à l'employé de ce que montre l'écran, et recalcule la banque d'heures des
  // périodes suivantes sur des chiffres qui n'ont plus rien à voir avec ce qui a été payé.
  const h = await one<any>("SELECT employe, date FROM heures_projet WHERE id = ?", [id]);
  if (h && await heureDansPaiePayee(h.employe, h.date)) {
    return { ok: false, raison: `Ces heures (${h.employe}, ${String(h.date).slice(0, 10)}) font partie d'une paie DÉJÀ VERSÉE. Les modifier fausserait le talon remis à l'employé et la banque d'heures.` };
  }
  await run("DELETE FROM heures_projet WHERE id = ?", [id]);
  return { ok: true };
}
export async function getHeureProjet(id: number) {
  return await one<any>("SELECT * FROM heures_projet WHERE id = ?", [id]);
}
// Résultat d'une modification avec verrouillage optimiste (B7).
export type ResultatMaj = { ok: true } | { ok: false; conflit?: true; introuvable?: true; versionActuelle?: number };

export async function modifierHeureProjet(id: number, h: Partial<HeureProjet>, versionAttendue?: number): Promise<ResultatMaj> {
  const champs = ['projet_id', 'date', 'heures', 'description', 'employe', 'taux_horaire'];
  const definis = champs.filter(k => (h as any)[k] !== undefined);
  if (!definis.length) return { ok: true };
  const sets = definis.map(k => `${k} = ?`).join(', ');
  const valeurs = definis.map(k => (h as any)[k]);
  if (versionAttendue != null) {
    // Maj conditionnelle : ne passe que si la version n'a pas bougé depuis le chargement.
    const r = await run(`UPDATE heures_projet SET ${sets}, version = version + 1 WHERE id = ? AND version = ?`, [...valeurs, id, versionAttendue]);
    if (r.rowsAffected === 0) {
      const actuel = await one<{ version: number }>("SELECT version FROM heures_projet WHERE id = ?", [id]);
      return actuel ? { ok: false, conflit: true, versionActuelle: actuel.version } : { ok: false, introuvable: true };
    }
    return { ok: true };
  }
  // Rétrocompat : sans version fournie, maj inconditionnelle (mais on incrémente quand même).
  await run(`UPDATE heures_projet SET ${sets}, version = version + 1 WHERE id = ?`, [...valeurs, id]);
  return { ok: true };
}
export async function listerToutesHeures(filtres?: { employe?: string; projet_id?: number; depuis?: string; jusqu_a?: string; limit?: number }): Promise<any[]> {
  // `limit` borné : un appelant qui ne veut que la dernière entrée n'a pas à recevoir 120 Ko.
  const lim = Math.min(5000, Math.max(1, Math.floor(filtres?.limit || 5000)));
  const conds: string[] = []; const args: any[] = [];
  if (filtres?.employe) { conds.push("h.employe = ?"); args.push(filtres.employe); }
  if (filtres?.projet_id) { conds.push("h.projet_id = ?"); args.push(filtres.projet_id); }
  if (filtres?.depuis) { conds.push("h.date >= ?"); args.push(filtres.depuis); }
  if (filtres?.jusqu_a) { conds.push("h.date <= ?"); args.push(filtres.jusqu_a); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return await all<any>(
    `SELECT h.*, p.nom as projet_nom FROM heures_projet h LEFT JOIN projets p ON p.id = h.projet_id ${where} ORDER BY h.date DESC, h.id DESC LIMIT ${lim}`,
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
  const m = q.replace(",", ".").match(/\d+(\.\d+)?/);
  const n = m ? Number(m[0]) : null;

  // Les 8 recherches partent EN PARALLÈLE (avant : séquentielles → ~8 allers-retours
  // Turso par frappe). allSettled : une table absente sur une vieille base ne casse
  // pas les autres résultats. L'ordre d'affichage est reconstruit après coup.
  const vide: any[] = [];
  const [clients, projets, soums, depMontant, depTxt, comms, taches, fichiers] = (await Promise.allSettled([
    all<any>(`SELECT id, nom, telephone FROM clients WHERE LOWER(nom) LIKE ? OR LOWER(courriel) LIKE ? OR telephone LIKE ? LIMIT 5`, [like, like, like]),
    all<any>(`SELECT id, nom, adresse_chantier FROM projets WHERE LOWER(nom) LIKE ? OR LOWER(adresse_chantier) LIKE ? LIMIT 5`, [like, like]),
    all<any>(`SELECT numero, client_nom, total FROM soumissions WHERE LOWER(numero) LIKE ? OR LOWER(client_nom) LIKE ? LIMIT 5`, [like, like]),
    // Dépenses : par MONTANT (ex. "45" ou "45,33")…
    n == null ? Promise.resolve(vide) : all<any>(
      `SELECT dp.id, dp.montant, dp.fournisseur, dp.date, dp.categorie, dp.projet_id, p.nom as projet_nom
       FROM depenses_projet dp LEFT JOIN projets p ON p.id = dp.projet_id
       WHERE dp.montant = ? OR CAST(dp.montant AS TEXT) LIKE ?
       ORDER BY ABS(dp.montant - ?) ASC, dp.date DESC LIMIT 6`,
      [n, `${m![0]}%`, n]
    ),
    // …sinon par fournisseur/description.
    all<any>(
      `SELECT dp.id, dp.montant, dp.fournisseur, dp.date, dp.categorie, dp.projet_id, p.nom as projet_nom
       FROM depenses_projet dp LEFT JOIN projets p ON p.id = dp.projet_id
       WHERE LOWER(dp.fournisseur) LIKE ? OR LOWER(dp.description) LIKE ?
       ORDER BY dp.date DESC LIMIT 4`,
      [like, like]
    ),
    // Recherche étendue : commentaires pipeline + sous-tâches + fichiers attachés
    all<any>(
      `SELECT cc.id, cc.client_id, cc.texte, cc.auteur, cl.nom as client_nom
       FROM client_commentaires cc LEFT JOIN clients cl ON cl.id = cc.client_id
       WHERE LOWER(cc.texte) LIKE ? LIMIT 4`,
      [like]
    ),
    all<any>(
      `SELECT ct.id, ct.client_id, ct.titre, ct.complete, cl.nom as client_nom
       FROM client_taches ct LEFT JOIN clients cl ON cl.id = ct.client_id
       WHERE LOWER(ct.titre) LIKE ? LIMIT 4`,
      [like]
    ),
    all<any>(
      `SELECT cf.id, cf.client_id, cf.nom, cl.nom as client_nom
       FROM client_fichiers cf LEFT JOIN clients cl ON cl.id = cf.client_id
       WHERE LOWER(cf.nom) LIKE ? LIMIT 4`,
      [like]
    ),
  ])).map((r) => (r.status === "fulfilled" ? r.value : vide));

  const out: any[] = [];
  for (const c of clients) out.push({ type: "client", id: c.id, titre: c.nom, sous: c.telephone || "" });
  for (const p of projets) out.push({ type: "projet", id: p.id, titre: p.nom, sous: p.adresse_chantier || "" });
  for (const s of soums) out.push({ type: "soumission", id: s.numero, titre: s.numero, sous: s.client_nom || "" });
  const vus = new Set<number>();
  const ajouterDep = (d: any) => {
    if (vus.has(d.id)) return; vus.add(d.id);
    out.push({ type: "depense", id: d.id, montant: d.montant,
      titre: `💸 ${(+d.montant).toFixed(2)} $ — ${d.fournisseur || "?"}`,
      sous: `${d.categorie || ""}${d.projet_nom ? " · " + d.projet_nom : ""} · ${String(d.date).slice(0, 10)}` });
  };
  for (const d of depMontant) ajouterDep(d);
  for (const d of depTxt) ajouterDep(d);
  for (const c of comms) out.push({ type: "commentaire", id: c.client_id, titre: `💬 ${String(c.texte).slice(0, 60)}…`, sous: `${c.auteur || "—"} → ${c.client_nom || "?"}` });
  for (const t of taches) out.push({ type: "sous-tâche", id: t.client_id, titre: `${t.complete ? "✅" : "☐"} ${t.titre}`, sous: t.client_nom || "?" });
  for (const f of fichiers) out.push({ type: "fichier", id: f.client_id, titre: `📎 ${f.nom}`, sous: f.client_nom || "?" });
  return out;
}
export async function finances(annee: number): Promise<any> {
  // Cache 30 s invalidé par toute écriture (cacheLecture). En plus du cache, le calcul
  // est fait en 5 requêtes GROUP BY mois LANCÉES EN PARALLÈLE, au lieu de 60 requêtes
  // séquentielles (12 mois × 5). Sur Turso en prod, chaque requête est un aller-retour
  // réseau (~20-50 ms) : le chargement à froid passait ~1,5-3 s → ~1 aller-retour.
  return cacheLecture(`finances:${annee}`, 30000, async () => {
  const prefixe = `${annee}-%`;
  // Mois de complétion d'un projet (date fin réelle, sinon prévue, sinon début/création).
  // substr(...,1,7) = « AAAA-MM » ; fonctionne pour les dates courtes et les ISO complets.
  const moisCompl = `substr(COALESCE(p.date_fin_reelle, p.date_fin_prevue, p.date_debut, p.date_creation), 1, 7)`;
  const [rFact, rPaye, rDep, rMo, rRev] = await Promise.all([
    all<any>(`SELECT substr(date, 1, 7) ym, COALESCE(SUM(montant), 0) v
              FROM factures_projet WHERE date LIKE ? GROUP BY ym`, [prefixe]),
    all<any>(`SELECT substr(date_paiement, 1, 7) ym, COALESCE(SUM(montant), 0) v
              FROM factures_projet WHERE payee = 1 AND date_paiement LIKE ? GROUP BY ym`, [prefixe]),
    // Dépenses & M.O. : on ne compte QUE les projets COMPLÉTÉS, attribués à leur mois
    // de complétion — pour faire correspondre les coûts au revenu reconnu (sinon on
    // compterait les coûts de chantiers en cours dont le revenu n'est pas encore reconnu).
    all<any>(`SELECT ${moisCompl} ym, COALESCE(SUM(dp.montant), 0) v,
                     COALESCE(SUM(CASE WHEN dp.detaxe = 1 THEN dp.montant ELSE 0 END), 0) detaxe
              FROM depenses_projet dp JOIN projets p ON p.id = dp.projet_id
              WHERE p.statut = 'complete' AND ${moisCompl} LIKE ? GROUP BY ym`, [prefixe]),
    all<any>(`SELECT ${moisCompl} ym, COALESCE(SUM(hp.heures * hp.taux_horaire), 0) v
              FROM heures_projet hp JOIN projets p ON p.id = hp.projet_id
              WHERE p.statut = 'complete' AND ${moisCompl} LIKE ? GROUP BY ym`, [prefixe]),
    // Revenu reconnu à la complétion : contrat (sinon estimé) + EXTRAS FACTURÉS
    // (même règle qu'au niveau projet — un extra chargé est un revenu réel).
    all<any>(`SELECT ${moisCompl} ym, COALESCE(SUM(
                COALESCE(p.prix_contrat, p.budget_estime, 0)
                + COALESCE((SELECT SUM(e.montant) FROM extras e
                            WHERE e.projet_id = p.id AND e.statut = 'charge'), 0)
              ), 0) v
              FROM projets p
              WHERE p.statut = 'complete' AND ${moisCompl} LIKE ? GROUP BY ym`, [prefixe]),
  ]);
  const parMois = (rows: any[]) => {
    const m = new Map<string, any>();
    for (const r of rows) if (r?.ym) m.set(String(r.ym), r);
    return m;
  };
  const mFact = parMois(rFact), mPaye = parMois(rPaye), mDep = parMois(rDep), mMo = parMois(rMo), mRev = parMois(rRev);

  const mois: any[] = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${annee}-${String(m).padStart(2, "0")}`;
    const depenses = +(mDep.get(ym)?.v || 0);
    const depensesDetaxe = +(mDep.get(ym)?.detaxe || 0);
    const mo = +(mMo.get(ym)?.v || 0);
    const revenu = +(mRev.get(ym)?.v || 0);
    // Marge nette RÉELLE = tout AVANT taxes. Revenu et dépenses sont saisis taxes
    // incluses ; on les ramène avant taxes (÷ 1,14975). La MO (salaires) n'a pas de
    // taxe. marge = revenu_avant_taxes − depenses_avant_taxes − MO.
    const revenu_avant_taxes = revenuAvantTaxes(revenu);
    // Les factures détaxées n'ont pas de taxes à retirer : on ne ramène que la part taxable.
    const depenses_avant_taxes = depensesAvantTaxes(depenses, depensesDetaxe);
    mois.push({
      mois: m, facture: +(mFact.get(ym)?.v || 0), paye: +(mPaye.get(ym)?.v || 0),
      depenses, depenses_avant_taxes, mo, contrats: revenu, revenu, revenu_avant_taxes,
      marge: revenu_avant_taxes - depenses_avant_taxes - mo,
    });
  }
  return { annee, mois };
  });
}
export async function heuresParEmploye(depuis: string): Promise<{ employe: string; total_heures: number; cout_total: number; n_jours: number }[]> {
  return await all<any>(
    `SELECT employe, SUM(heures) as total_heures, SUM(heures * taux_horaire) as cout_total, COUNT(DISTINCT date) as n_jours
     FROM heures_projet WHERE date >= ? AND employe IS NOT NULL
     GROUP BY employe ORDER BY total_heures DESC`,
    [depuis]
  );
}

/** TOUTES les heures (sans limite) avec nom de projet — pour l'export Drive (back-up). */
export async function toutesHeuresPourExport(): Promise<any[]> {
  return await all<any>(
    `SELECT h.date, h.employe, p.nom as projet_nom, h.heures, h.taux_horaire, h.description, h.ajoute_par
     FROM heures_projet h LEFT JOIN projets p ON p.id = h.projet_id
     ORDER BY h.date DESC, h.id DESC`
  );
}

// === RÉGLAGES APPLICATIFS (clé/valeur) ===
export async function getParametre(cle: string): Promise<string | null> {
  const r = await one<{ valeur: string }>("SELECT valeur FROM parametres_app WHERE cle = ?", [cle]);
  return r?.valeur ?? null;
}
export async function setParametre(cle: string, valeur: string): Promise<void> {
  await run("INSERT INTO parametres_app (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur", [cle, valeur]);
}

// === EXTRAS À FACTURER ===
export interface Extra {
  id?: number; projet_id?: number | null; date: string; nature?: string; description: string;
  montant?: number | null; heures?: number | null; photo_data?: string | null; thumb_data?: string | null;
  statut?: string; saisi_par?: string;
}
// Colonnes "lites" : sans les blobs photo (flag a_photo seulement) + nom de projet.
const EXTRAS_COLS_LITES = "e.id, e.projet_id, e.date, e.nature, e.description, e.montant, e.heures, e.statut, e.saisi_par, e.date_creation, e.date_charge, (e.photo_data IS NOT NULL) as a_photo, p.nom as projet_nom";
export async function ajouterExtra(x: Extra): Promise<number> {
  const r = await run(
    `INSERT INTO extras (projet_id, date, nature, description, montant, heures, photo_data, thumb_data, statut, saisi_par, date_creation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'a_charger', ?, ?)`,
    [x.projet_id || null, x.date, x.nature || null, x.description, x.montant ?? null, x.heures ?? null,
     x.photo_data || null, x.thumb_data || null, x.saisi_par || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function listerExtras(statut?: string, projet_id?: number | null): Promise<any[]> {
  // Chaque condition est poussée séparément puis jointe par AND : construire la clause
  // à la main invite les OR non parenthésés qui annulent les autres filtres.
  const conds: string[] = [];
  const args: any[] = [];
  if (statut) { conds.push("e.statut = ?"); args.push(statut); }
  if (projet_id != null) { conds.push("e.projet_id = ?"); args.push(projet_id); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  return await all<any>(`SELECT ${EXTRAS_COLS_LITES} FROM extras e LEFT JOIN projets p ON p.id = e.projet_id ${where} ORDER BY e.date DESC, e.id DESC LIMIT 500`, args);
}
export async function compterExtrasACharger(): Promise<{ n: number; total: number }> {
  const r = await one<any>("SELECT COUNT(*) as n, COALESCE(SUM(montant),0) as total FROM extras WHERE statut = 'a_charger'");
  return { n: r?.n || 0, total: r?.total || 0 };
}
export async function getExtraPhoto(id: number): Promise<{ photo_data?: string; thumb_data?: string } | null> {
  return await one<any>("SELECT photo_data, thumb_data FROM extras WHERE id = ?", [id]);
}
export async function marquerExtraCharge(id: number, charge: boolean): Promise<void> {
  await run("UPDATE extras SET statut = ?, date_charge = ? WHERE id = ?",
    [charge ? "charge" : "a_charger", charge ? new Date().toISOString() : null, id]);
}
/** Modifie le texte ou les montants d'un extra.
 *
 *  REFUSE un extra déjà FACTURÉ : le montant a servi à facturer le client, le changer
 *  après coup ferait diverger la facture et le dossier sans laisser de trace. Il faut le
 *  rouvrir (« ↩ Rouvrir »), corriger, puis le remarquer facturé — trois gestes explicites
 *  et journalisés plutôt qu'une modification silencieuse. */
export async function modifierExtra(
  id: number,
  x: { description?: string; montant?: number | null; heures?: number | null; nature?: string; date?: string; projet_id?: number | null },
): Promise<{ ok: boolean; raison?: string }> {
  const e = await one<{ statut: string; description: string }>("SELECT statut, description FROM extras WHERE id = ?", [id]);
  if (!e) return { ok: false, raison: "Extra introuvable." };
  if (e.statut === "charge") {
    return { ok: false, raison: "Cet extra est déjà marqué FACTURÉ. Rouvre-le d'abord (↩ Rouvrir), corrige-le, puis remets-le à facturé." };
  }

  const sets: string[] = [];
  const args: any[] = [];
  if (x.description !== undefined) {
    const d = String(x.description || "").trim();
    if (!d) return { ok: false, raison: "La description ne peut pas être vide." };
    sets.push("description = ?"); args.push(d.slice(0, 500));
  }
  if (x.nature !== undefined) { sets.push("nature = ?"); args.push(x.nature || null); }
  if (x.date !== undefined) { sets.push("date = ?"); args.push(x.date || null); }
  if (x.projet_id !== undefined) { sets.push("projet_id = ?"); args.push(x.projet_id || null); }
  // montant et heures : 0 est une valeur, pas une absence — on ne passe donc PAS par
  // `valeur || null` (le piège qui transformait un montant à 0 en null ailleurs).
  if (x.montant !== undefined) {
    if (x.montant !== null && !Number.isFinite(Number(x.montant))) return { ok: false, raison: "Montant invalide." };
    sets.push("montant = ?"); args.push(x.montant === null ? null : Number(x.montant));
  }
  if (x.heures !== undefined) {
    if (x.heures !== null && !Number.isFinite(Number(x.heures))) return { ok: false, raison: "Heures invalides." };
    sets.push("heures = ?"); args.push(x.heures === null ? null : Number(x.heures));
  }
  if (!sets.length) return { ok: true };
  await run(`UPDATE extras SET ${sets.join(", ")} WHERE id = ?`, [...args, id]);
  return { ok: true };
}

export async function supprimerExtra(id: number): Promise<void> {
  await run("DELETE FROM extras WHERE id = ?", [id]);
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
/** Annule un paiement marqué par erreur (le geste inverse manquait). */
export async function annulerPaiementFacture(id: number) {
  await run("UPDATE factures_projet SET payee = 0, date_paiement = NULL WHERE id = ?", [id]);
}
/** Supprime une facture. REFUSE une facture déjà encaissée : c'est la trace d'un
 *  paiement reçu, et il n'y a pas de corbeille dans cette app — une suppression efface
 *  définitivement de l'argent entré. Pour corriger une erreur, il faut d'abord annuler
 *  le paiement (le geste est explicite et journalisé), puis supprimer. */
export async function supprimerFactureProjet(id: number): Promise<{ ok: boolean; raison?: string }> {
  const f = await one<{ payee: number; montant: number; numero: string | null; date_paiement: string | null }>(
    "SELECT payee, montant, numero, date_paiement FROM factures_projet WHERE id = ?", [id]
  );
  if (!f) return { ok: false, raison: "Facture introuvable." };
  if (f.payee) {
    return {
      ok: false,
      raison: `Cette facture (${f.numero || `#${id}`} · ${f.montant} $) est marquée ENCAISSÉE${f.date_paiement ? ` le ${f.date_paiement}` : ""}. Annule d'abord le paiement, puis supprime-la.`,
    };
  }
  await run("DELETE FROM factures_projet WHERE id = ?", [id]);
  return { ok: true };
}

/** Le projet référencé existe-t-il ? `null`/absent = dépense générale, c'est permis.
 *  Un id qui ne pointe sur RIEN ne l'est pas : la ligne devient un orphelin invisible
 *  (aucune fiche projet ne l'affiche) mais bien compté dans les totaux globaux. */
export async function projetReferenceValide(projet_id: any): Promise<boolean> {
  if (projet_id === null || projet_id === undefined || projet_id === "") return true;
  const n = Number(projet_id);
  if (!Number.isFinite(n)) return false;
  const r = await one<{ id: number }>("SELECT id FROM projets WHERE id = ?", [n]);
  return !!r;
}

// === DÉPENSES ===
export interface DepenseProjet {
  id?: number; projet_id?: number | null; date: string; montant: number;
  fournisseur?: string; description?: string; categorie?: string;
  recu_data?: string; recu_type?: string; detaxe?: number | boolean;
}
// Colonnes sans le blob recu_data (perf : envoie juste un flag a_recu)
const DEPENSES_COLS_LITES = "id, projet_id, date, montant, fournisseur, description, categorie, detaxe, recu_type, ajoute_par, version, (recu_data IS NOT NULL) as a_recu";
export async function listerDepensesProjet(projet_id: number | null, options: { sansData?: boolean } = {}) {
  const cols = options.sansData ? DEPENSES_COLS_LITES : "*";
  if (projet_id === null) return await all<DepenseProjet>(`SELECT ${cols} FROM depenses_projet WHERE projet_id IS NULL ORDER BY date DESC`);
  return await all<DepenseProjet>(`SELECT ${cols} FROM depenses_projet WHERE projet_id = ? ORDER BY date DESC`, [projet_id]);
}
// LIMIT 5000 : la vue Dépenses charge en mode "lite" (sansData) puis pagine côté
// client. Ce plafond borne la requête sans tronquer en pratique (années de données).
export async function listerToutesDepenses(options: { sansData?: boolean } = {}) {
  const cols = options.sansData ? DEPENSES_COLS_LITES : "*";
  return await all<DepenseProjet>(`SELECT ${cols} FROM depenses_projet ORDER BY date DESC LIMIT 5000`);
}
export async function fournisseursConnus(): Promise<string[]> {
  const rows = await all<{ fournisseur: string }>("SELECT DISTINCT fournisseur FROM depenses_projet WHERE fournisseur IS NOT NULL AND fournisseur != '' ORDER BY fournisseur ASC");
  return rows.map(r => r.fournisseur);
}
export async function ajouterDepenseProjet(d: DepenseProjet & { ajoute_par?: string }): Promise<number> {
  const r = await run(
    `INSERT INTO depenses_projet (projet_id, date, montant, fournisseur, description, categorie, recu_data, recu_type, detaxe, ajoute_par, date_saisie) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.projet_id || null, d.date, d.montant, d.fournisseur || null, d.description || null, d.categorie || null, d.recu_data || null, d.recu_type || null, d.detaxe ? 1 : 0, d.ajoute_par || null, new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function supprimerDepenseProjet(id: number) {
  await run("DELETE FROM depenses_projet WHERE id = ?", [id]);
}
export async function modifierDepenseProjet(id: number, d: Partial<DepenseProjet>, versionAttendue?: number): Promise<ResultatMaj> {
  // `valeur || null` était appliqué à TOUS les champs. Le commentaire plus bas notait
  // déjà le piège pour `detaxe`, mais `montant` avait exactement le même : un montant à 0
  // devenait null et violait la contrainte NOT NULL → 500 en pleine modification de
  // dépense (mesuré). Or un champ « montant » vidé dans l'écran donne `+""` = 0.
  // On sépare donc par nature : montant est un nombre (0 compris), date une chaîne
  // obligatoire, le reste du texte optionnel où « vide » veut bien dire null.
  const champsTexte = ["fournisseur", "description", "categorie"];
  const sets: string[] = [];
  const args: any[] = [];
  if (d.projet_id !== undefined) { sets.push("projet_id = ?"); args.push(d.projet_id || null); }
  if (d.date !== undefined) {
    const dt = String(d.date || "").trim();
    if (!dt) throw new Error("date requise");
    sets.push("date = ?"); args.push(dt);
  }
  if (d.montant !== undefined) {
    const m = Number(d.montant);
    if (!Number.isFinite(m)) throw new Error("montant invalide");
    sets.push("montant = ?"); args.push(m);   // 0 est une valeur, pas une absence
  }
  for (const c of champsTexte) {
    if ((d as any)[c] !== undefined) { sets.push(`${c} = ?`); args.push((d as any)[c] || null); }
  }
  // detaxe est un booléen 0/1 : à traiter à part (sinon `0 || null` l'écraserait).
  if (d.detaxe !== undefined) { sets.push("detaxe = ?"); args.push(d.detaxe ? 1 : 0); }
  if (sets.length === 0) return { ok: true };
  if (versionAttendue != null) {
    const r = await run(`UPDATE depenses_projet SET ${sets.join(", ")}, version = version + 1 WHERE id = ? AND version = ?`, [...args, id, versionAttendue]);
    if (r.rowsAffected === 0) {
      const actuel = await one<{ version: number }>("SELECT version FROM depenses_projet WHERE id = ?", [id]);
      return actuel ? { ok: false, conflit: true, versionActuelle: actuel.version } : { ok: false, introuvable: true };
    }
    return { ok: true };
  }
  args.push(id);
  await run(`UPDATE depenses_projet SET ${sets.join(", ")}, version = version + 1 WHERE id = ?`, args);
  return { ok: true };
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
    ? "id, projet_id, date, employes, photo_type, description, date_saisie, drive_file_id, (thumb_data IS NOT NULL) as a_thumb"
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
/** Marqueur posé AVANT de lancer l'envoi vers Drive. Une fonction serverless peut être
 *  arrêtée dès la réponse envoyée : sans cette trace, une photo n'arrivait ni sur Drive ni
 *  dans le journal d'erreurs, donc restait invisible du bouton « Resynchroniser ». */
export const DRIVE_EN_ATTENTE = "en attente d'envoi";
/** Au-delà de ce délai, une photo encore « en attente » est considérée comme bloquée. */
const DRIVE_ATTENTE_MAX_MS = 5 * 60 * 1000;
function seuilAttenteDrive(): string { return new Date(Date.now() - DRIVE_ATTENTE_MAX_MS).toISOString(); }

export async function marquerDriveSync(id: number, drive_file_id: string | null, error: string | null) {
  await run("UPDATE photos_chantier SET drive_file_id = ?, drive_sync_error = ? WHERE id = ?", [drive_file_id, error, id]);
}
export async function marquerDriveEnAttente(id: number) {
  await run("UPDATE photos_chantier SET drive_sync_error = ? WHERE id = ?", [DRIVE_EN_ATTENTE, id]);
}
// Une photo tout juste déposée est « en attente » quelques secondes : on ne la compte comme
// problème qu'au-delà du délai, sinon la cloche clignoterait à chaque photo.
const OU_DRIVE_A_REPRENDRE = `drive_sync_error IS NOT NULL AND (drive_sync_error <> ? OR date_saisie < ?)`;

export async function compterPhotosErreursDrive(): Promise<number> {
  const r = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM photos_chantier WHERE ${OU_DRIVE_A_REPRENDRE}`,
    [DRIVE_EN_ATTENTE, seuilAttenteDrive()]
  );
  return r?.n || 0;
}
/** Photos dont la synchro Drive a échoué (pour réessayer). */
export async function listerPhotosErreursDrive(): Promise<any[]> {
  return await all<any>(
    `SELECT id, projet_id, date, photo_data, photo_type, description, drive_sync_error
     FROM photos_chantier WHERE ${OU_DRIVE_A_REPRENDRE} LIMIT 50`,
    [DRIVE_EN_ATTENTE, seuilAttenteDrive()]
  );
}

// === BIBLIOTHÈQUE ===
export interface JobBiblio {
  id?: number; date_ajout: string; adresse?: string; type_materiau?: string;
  parement_pi2?: number; fascia_pi_lin?: number; soffite_pi2?: number;
  nb_etages?: number; total_soumission?: number; heures_reelles?: number;
  hover_data_json?: string; soumission_data_json?: string; photos_json?: string;
  notes_chantier?: string; complexite?: string;
  photo_ids?: string | null;   // « 3,7,12 » — ids des photos en base (voir listerJobsBiblio)
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
  // `photo_ids` : la liste des id de photos, PAS les images elles-mêmes — la liste resterait
  // sinon plombée par des méga-octets de base64. Les vignettes se chargent une par une.
  return await all<JobBiblio>(
    `SELECT b.*, (SELECT GROUP_CONCAT(p.id) FROM bibliotheque_photos p WHERE p.job_id = b.id) as photo_ids
     FROM bibliotheque_jobs b ORDER BY b.date_ajout DESC LIMIT 200`
  );
}
export async function supprimerJobBiblio(id: number) {
  // Sans ça, les photos restaient en base pour toujours après la suppression de la job.
  await run("DELETE FROM bibliotheque_photos WHERE job_id = ?", [id]).catch(() => {});
  await run("DELETE FROM bibliotheque_jobs WHERE id = ?", [id]);
}
export async function ajouterPhotoBiblio(job_id: number, data: string, type?: string): Promise<number> {
  const r = await run(
    "INSERT INTO bibliotheque_photos (job_id, data, type, date_ajout) VALUES (?, ?, ?, ?)",
    [job_id, data, type || "image/jpeg", new Date().toISOString()]
  );
  return r.lastInsertRowid;
}
export async function getPhotoBiblio(id: number): Promise<{ data: string; type: string } | null> {
  return await one<{ data: string; type: string }>("SELECT data, type FROM bibliotheque_photos WHERE id = ?", [id]);
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
  recoit_talon?: number;
  telephone?: string; courriel?: string; adresse?: string;
  date_naissance?: string; nas?: string; date_embauche?: string; poste?: string;
  contact_urgence_nom?: string; contact_urgence_lien?: string; contact_urgence_tel?: string;
  specimen_cheque_data?: string; specimen_cheque_type?: string;
  notes?: string;
}
async function seedEmployes() {
  // Cette désactivation tournait à CHAQUE listerEmployes() : Frédéric réembauché et
  // réactivé se retrouvait désactivé au prochain écran ouvert, sans explication possible.
  // Elle est jouée UNE seule fois, comme une vraie migration. (Effet de bord réglé au
  // passage : cette écriture invalidait le cache de lecture à chaque chargement.)
  try {
    const fait = await one<{ valeur: string }>("SELECT valeur FROM parametres_app WHERE cle = 'mig_frederic_inactif'");
    if (!fait) {
      await run("UPDATE employes SET actif = 0 WHERE nom = 'Frédéric'", []);
      await run("INSERT OR REPLACE INTO parametres_app (cle, valeur) VALUES ('mig_frederic_inactif', '1')");
    }
  } catch { /* table pas encore prête sur une base neuve : rien à migrer de toute façon */ }
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
  const champs = ['nom', 'taux_horaire', 'das_pct', 'actif', 'recoit_talon',
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
export async function supprimerVehicule(id: number) {
  // Détache les polices d'assurance liées : sans ça, elles gardaient un vehicule_id
  // pointant dans le vide et disparaissaient silencieusement de l'affichage.
  await run("UPDATE assurances SET vehicule_id = NULL WHERE vehicule_id = ?", [id]).catch(() => {});
  await run("DELETE FROM vehicules WHERE id = ?", [id]);
}

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
  heures_travaillees?: number;
  /** Heures travaillées mais NON payées dans une période déjà versée (feuille de temps
   *  saisie après le versement). Calculé à la lecture, jamais stocké. */
  heures_non_payees?: number;
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

  // 2. Grouper par (employe, période bi-hebdo). On garde le taux PAR entrée : un
  //    employé peut avoir des taux différents dans la même quinzaine (augmentation
  //    en cours de période, ou taux distinct selon le chantier).
  const groupes = new Map<string, { employe: string; debut: string; fin: string; heures: { date: string; heures: number; taux: number }[] }>();
  for (const h of heures) {
    const p = periodeBiHebdo(h.date);
    const key = `${h.employe}|${p.debut}`;
    if (!groupes.has(key)) groupes.set(key, { employe: h.employe, debut: p.debut, fin: p.fin, heures: [] });
    groupes.get(key)!.heures.push({ date: h.date, heures: h.heures || 0, taux: h.taux_horaire || 0 });
  }

  // 3. BANQUE D'HEURES — traitement CHRONOLOGIQUE par employé.
  //    Pas de prime ×1.5 : les heures au-delà de 80h/quinzaine sont ACCUMULÉES
  //    dans une banque, et servent à compléter une quinzaine sous 80h plus tard.
  // Même seuil que la logique paie centralisée — le bandeau « heures dues » s'y accroche
  // aussi, les deux doivent bouger ensemble ou la banque redevient une dette fantôme.
  const SEUIL = SEUIL_SUP_PERIODE;
  // Regrouper les groupes par employé, triés par date de début (ancien → récent)
  const parEmploye = new Map<string, typeof groupes extends Map<string, infer V> ? V[] : never>();
  for (const g of groupes.values()) {
    if (!parEmploye.has(g.employe)) parEmploye.set(g.employe, [] as any);
    (parEmploye.get(g.employe) as any).push(g);
  }
  // Périodes déjà en base, chargées EN UNE FOIS et indexées : avant, un SELECT par
  // quinzaine puis un UPDATE/INSERT par quinzaine — 376 requêtes mesurées pour trois
  // employés. Les écritures sont accumulées et envoyées en un seul lot, et une période
  // dont rien ne change n'est pas réécrite : au régime de croisière, zéro écriture.
  const existants = new Map<string, any>();
  for (const p of await all<any>(`SELECT * FROM paies_periodes ${employe ? "WHERE employe = ?" : ""}`, employe ? [employe] : [])) {
    existants.set(`${p.employe}|${p.debut}|${p.fin}`, p);
  }
  const ecritures: { sql: string; args: any[] }[] = [];
  const egal = (a: any, b: any) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.000001;
  for (const [, liste] of parEmploye) {
    (liste as any[]).sort((a, b) => a.debut.localeCompare(b.debut));
    let banque = 0; // solde courant de la banque (heures accumulées non payées)
    for (const g of liste as any[]) {
      const travaillees = g.heures.reduce((s: number, e: any) => s + (e.heures || 0), 0);
      // Taux MOYEN PONDÉRÉ par les heures : respecte les taux réels par entrée.
      // Avant, on payait toute la quinzaine à UN taux (celui de la 1re entrée vue) →
      // un employé avec 40 h @ 50 $ + 40 h @ 60 $ était payé 80 h × 60 $ au lieu de
      // 40×50 + 40×60. Pour un taux unique (cas normal), la moyenne = ce taux.
      const montantHeures = g.heures.reduce((s: number, e: any) => s + (e.heures || 0) * (e.taux || 0), 0);
      const taux = travaillees > 0 ? montantHeures / travaillees : 0;
      const base = Math.min(travaillees, SEUIL);          // heures payées d'office (max 80)
      const surplus = Math.max(0, travaillees - SEUIL);   // surplus → accumulé en banque
      const dispoAvant = banque;                          // banque disponible AVANT cette période

      const existant = existants.get(`${g.employe}|${g.debut}|${g.fin}`) || null;

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
      const brut = payees * taux;
      const dasMontant = brut * 0.15;
      const net = brut - dasMontant;

      if (existant) {
        if (!existant.paye) {
          const inchangee = egal(existant.heures_normales, payees) && egal(existant.heures_travaillees, travaillees)
            && egal(existant.banque_dispo, dispoAvant) && egal(existant.banque_appliquee, appliquee) && egal(existant.banque_solde, banque)
            && egal(existant.taux_horaire, taux) && egal(existant.montant_brut, brut) && egal(existant.das_montant, dasMontant) && egal(existant.montant_net, net);
          if (!inchangee) ecritures.push({
            sql: `UPDATE paies_periodes SET heures_normales=?, heures_sup=0, heures_travaillees=?, banque_dispo=?, banque_appliquee=?, banque_solde=?, taux_horaire=?, montant_brut=?, das_montant=?, montant_net=? WHERE id=?`,
            args: [payees, travaillees, dispoAvant, appliquee, banque, taux, brut, dasMontant, net, existant.id],
          });
        } else {
          // Période payée : on ne touche JAMAIS aux montants versés. En revanche on
          // rafraîchit `heures_travaillees`, le fait brut.
          // Avant, il restait figé : une feuille de temps oubliée et saisie APRÈS le
          // versement était acceptée en base (donc comptée dans le coût du chantier)
          // mais n'atteignait jamais la paie, et RIEN ne le signalait. Mesuré : Gabriel
          // travaille 53 h, la période reste à « 45 h · 1 800 $ payé », les 8 h
          // disparaissent. Maintenant l'écart travaillées − payées est visible et
          // remonté comme heures dues (voir heures_non_payees plus bas).
          if (!(egal(existant.banque_dispo, dispoAvant) && egal(existant.banque_solde, banque) && egal(existant.heures_travaillees, travaillees))) {
            ecritures.push({ sql: `UPDATE paies_periodes SET banque_dispo=?, banque_solde=?, heures_travaillees=? WHERE id=?`, args: [dispoAvant, banque, travaillees, existant.id] });
          }
        }
      } else {
        ecritures.push({
          sql: `INSERT OR IGNORE INTO paies_periodes (employe, debut, fin, heures_normales, heures_sup, heures_travaillees, banque_dispo, banque_appliquee, banque_solde, taux_horaire, das_pct, montant_brut, das_montant, montant_net, paye, date_creation) VALUES (?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, ?, ?, ?, 0, ?)`,
          args: [g.employe, g.debut, g.fin, payees, travaillees, dispoAvant, banque, taux, 0.15, brut, dasMontant, net, new Date().toISOString()],
        });
      }
    }
  }
  await runBatch(ecritures);

  // 4. Retourner la liste
  const list = employe
    ? await all<PaiePeriode>("SELECT * FROM paies_periodes WHERE employe = ? ORDER BY debut DESC LIMIT ?", [employe, limit])
    : await all<PaiePeriode>("SELECT * FROM paies_periodes ORDER BY debut DESC, employe ASC LIMIT ?", [limit * 5]);
  // `heures_non_payees` : heures réellement travaillées dans une période DÉJÀ VERSÉE qui
  // n'ont pas été payées. C'est de l'argent dû à un employé, jusqu'ici invisible.
  // Calculé à la lecture (aucune colonne à migrer) et jamais négatif.
  // L'écart brut travaillées − payées ne suffit PAS : au-delà de 80 h, l'écart est le
  // surplus qui part en banque d'heures, pas une dette (voir heuresDuesPeriodePayee).
  return list.map((p: any) => ({
    ...p,
    heures_non_payees: p.paye
      ? heuresDuesPeriodePayee(p.heures_travaillees || 0, p.heures_normales || 0)
      : 0,
  }));
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
  // Les (employé, période) qui ont encore des heures — calculé EN MÉMOIRE à partir des
  // dates déjà chargées. Avant : un COUNT(*) par période, à chaque ouverture de la paie.
  // Mesuré : 376 requêtes pour trois employés sur deux ans et demi ; sur une base distante
  // c'est plusieurs secondes. Maintenant : deux lectures et un lot de suppressions.
  const avecHeures = new Set<string>();
  for (const h of heuresExistantes) {
    const p = periodeBiHebdoCalc(h.date);
    avecHeures.add(`${h.employe}|${p.debut}|${p.fin}`);
  }
  const aSupprimer: number[] = [];
  for (const p of periodes) {
    if (p.paye) continue; // jamais supprimer une paye marquée payée
    // 1. Borne mal alignée avec l'ancrage de paie actuel → période obsolète, on supprime.
    const aligne = periodeBiHebdoCalc(p.debut);
    if (aligne.debut !== p.debut || aligne.fin !== p.fin) { aSupprimer.push(p.id); continue; }
    // 2. Aucune heure réelle dans la période → orpheline, on supprime.
    if (!avecHeures.has(`${p.employe}|${p.debut}|${p.fin}`)) aSupprimer.push(p.id);
  }
  await runBatch(aSupprimer.map((id) => ({ sql: "DELETE FROM paies_periodes WHERE id = ?", args: [id] })));
  return aSupprimer.length;
}
export async function marquerPayePeriode(id: number, paye: boolean, date_paiement?: string, note?: string) {
  await run(
    `UPDATE paies_periodes SET paye = ?, date_paiement = ?, note = ? WHERE id = ?`,
    [paye ? 1 : 0, paye ? (date_paiement || aujourdhuiMontreal()) : null, note || null, id]
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

// ============================================================================
// SAUVEGARDE / RESTAURATION — une seule liste, partagée par les deux sens.
// ============================================================================
// Avant, /api/backup listait ses tables à la main et /api/restore avait sa propre liste :
// les deux ont dérivé et 9 tables seulement sur 38 étaient sauvegardées. Manquaient entre
// autres les CONTRATS SIGNÉS (valeur juridique), les factures et les extras. Une seule
// source ici, donc plus de dérive possible.
//
// `champ` = clé dans le fichier JSON. NE JAMAIS RENOMMER un champ existant : les anciens
// fichiers de sauvegarde deviendraient illisibles. On ne fait qu'ajouter.
export const TABLES_SAUVEGARDE: { champ: string; table: string; tri?: string; sansColonnes?: string[] }[] = [
  // — les 9 d'origine (noms de champs figés pour rester compatible avec les vieux fichiers)
  { champ: "soumissions", table: "soumissions", tri: "date_creation DESC" },
  { champ: "clients", table: "clients", tri: "nom ASC" },
  { champ: "projets", table: "projets", tri: "id ASC" },
  { champ: "employes", table: "employes", tri: "nom ASC" },   // inactifs inclus
  { champ: "heures", table: "heures_projet", tri: "date DESC, id DESC" },
  // Les photos de reçus sont écartées : c'est la table la plus nombreuse, et joindre une
  // image à chaque dépense ferait exploser la taille du fichier. Les montants, eux, restent.
  { champ: "depenses", table: "depenses_projet", tri: "date DESC", sansColonnes: ["recu_data"] },
  { champ: "contrats", table: "contrats", tri: "date_emission DESC" },
  { champ: "paies", table: "paies_periodes", tri: "debut DESC" },
  { champ: "biblio", table: "bibliotheque_jobs", tri: "date_ajout DESC" },
  // — ajoutées : elles manquaient toutes à la sauvegarde
  // Le PDF SIGNÉ et son empreinte sont conservés (pièce juridique irremplaçable) ; le
  // brouillon est écarté, il se régénère depuis data_json.
  { champ: "contrats_signes", table: "pipeline_contrats", tri: "date_creation DESC", sansColonnes: ["pdf_brouillon"] },
  { champ: "factures", table: "factures_projet", tri: "date DESC" },
  { champ: "extras", table: "extras", tri: "id DESC" },
  { champ: "assurances", table: "assurances", tri: "id ASC" },
  { champ: "vehicules", table: "vehicules", tri: "nom ASC" },
  { champ: "inventaire", table: "inventaire", tri: "id ASC" },
  { champ: "inventaire_mouvements", table: "inventaire_mouvements", tri: "id ASC" },
  { champ: "taches", table: "taches_client", tri: "id ASC" },
  { champ: "client_taches", table: "client_taches", tri: "id ASC" },
  { champ: "interactions", table: "interactions_client", tri: "id ASC" },
  { champ: "client_commentaires", table: "client_commentaires", tri: "id ASC" },
  { champ: "outils", table: "outils", tri: "id ASC" },
  { champ: "catalogue", table: "catalogue_materiaux", tri: "id ASC" },
  { champ: "categories_depense", table: "categories_depense", tri: "id ASC" },
  { champ: "rendements", table: "rendements_reels", tri: "id ASC" },
  { champ: "notes_rapides", table: "notes_rapides", tri: "id ASC" },
  { champ: "cameras", table: "cameras", tri: "id ASC" },
  { champ: "parametres", table: "parametres_app" },
  { champ: "parametres_ia", table: "parametres_ia" },
  { champ: "profils", table: "utilisateur_profil", tri: "id ASC" },
  // Documents de chantier : on garde l'INVENTAIRE (nom, type, taille, catégorie, qui et
  // quand) mais pas les octets — même arbitrage que les reçus de dépense, sinon quelques
  // PDF de 3 Mo suffisent à faire exploser le fichier de sauvegarde. Après une restauration
  // on sait donc quels documents existaient et lesquels sont à retrouver.
  { champ: "projet_fichiers", table: "projet_fichiers", tri: "date_ajout DESC", sansColonnes: ["data"] },
  // Tables qui MANQUAIENT à la sauvegarde (audit) — même arbitrage inventaire-sans-octets :
  // - photos de chantier : sans ces lignes, une restauration perd la date, la description,
  //   le projet ET le lien Drive de chaque photo, alors que le fichier existe toujours
  //   chez Google. L'inventaire suffit à tout recoller ;
  // - fichiers de client, photos de bibliothèque, documents IA : idem, on garde le nom,
  //   le type, la date et qui l'a déposé ; l'octet reste « à retrouver » ;
  // - journal d'activité et retours IA : texte seulement, et c'est la trace de qui a
  //   fait quoi — la perdre à la restauration effacerait l'historique.
  // Volontairement écartés : oauth_tokens (secrets), push_subscriptions (propres à un
  // appareil), prix_cache_v2 et ia_couts (caches et télémétrie, se reconstruisent).
  { champ: "photos_chantier", table: "photos_chantier", tri: "date DESC, id DESC", sansColonnes: ["photo_data", "thumb_data"] },
  { champ: "client_fichiers", table: "client_fichiers", tri: "date_ajout DESC", sansColonnes: ["data"] },
  { champ: "bibliotheque_photos", table: "bibliotheque_photos", tri: "id ASC", sansColonnes: ["data"] },
  { champ: "documents_ia", table: "documents_ia", tri: "id ASC", sansColonnes: ["data_b64"] },
  { champ: "journal_activite", table: "journal_activite", tri: "id ASC" },
  { champ: "ia_feedback", table: "ia_feedback", tri: "id ASC" },
];

/** Volontairement HORS sauvegarde — chaque exclusion doit avoir sa raison ici. */
export const TABLES_EXCLUES_SAUVEGARDE: Record<string, string> = {
  oauth_tokens: "SECRETS (jetons Google Drive) — le fichier de sauvegarde est justement déposé sur Drive, ils n'ont rien à y faire",
  prix_cache_v2: "cache régénérable",
  push_subscriptions: "propre à chaque appareil, se recrée à la reconnexion",
  ia_couts: "journal de dépense IA, propre à l'instance et reconstituable par la facturation Anthropic",
  erreurs_client: "journal d'erreurs du navigateur, purgé automatiquement",
  // Les photos de chantier, fichiers de client, photos de bibliothèque et documents IA ne
  // sont PLUS exclus : leur INVENTAIRE est sauvegardé (voir TABLES_SAUVEGARDE), seules
  // les colonnes d'octets sont écartées. Le journal d'activité et les retours IA sont
  // sauvegardés en entier.
};

/** Export brut d'une table : colonnes réelles complètes, sans troncature ni jointure —
 *  contrairement aux listers d'affichage qui coupent à 200-5000 lignes et joignent des
 *  champs calculés. Indispensable pour que la restauration soit fidèle (ex. payload_json
 *  des soumissions, sans quoi une soumission restaurée perd ses lignes et ses prix). */
export async function exporterTable(table: string, tri?: string, sansColonnes?: string[]): Promise<any[]> {
  let cols = "*";
  if (sansColonnes?.length) {
    const info = await exec(`PRAGMA table_info(${table})`);
    const noms = (info.rows as any[]).map((r) => String(r.name)).filter((n) => !sansColonnes.includes(n));
    if (noms.length) cols = noms.join(", ");
  }
  return await all<any>(`SELECT ${cols} FROM ${table}${tri ? ` ORDER BY ${tri}` : ""}`);
}

/** Construit le contenu complet d'une sauvegarde : { champ: lignes[] } + le compte par champ.
 *  Une table absente (schéma plus ancien) donne un tableau vide au lieu de tout faire échouer. */
export async function contenuSauvegarde(): Promise<{ donnees: Record<string, any[]>; counts: Record<string, number> }> {
  await initDb();
  const donnees: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  for (const { champ, table, tri, sansColonnes } of TABLES_SAUVEGARDE) {
    const lignes = await exporterTable(table, tri, sansColonnes).catch(() => [] as any[]);
    donnees[champ] = lignes;
    counts[champ] = lignes.length;
  }
  return { donnees, counts };
}

// === RESTAURATION DEPUIS UN BACKUP JSON (réparation après sinistre) ===
// Additive et idempotente : INSERT OR IGNORE en conservant les id d'origine, donc ne modifie
// ni ne supprime jamais une ligne déjà présente — rejouable sans risque. Les colonnes sont
// filtrées dynamiquement via PRAGMA table_info pour ignorer les champs de jointure/calculés
// présents dans certains exports (client_nom, total_heures, projet_nom…).

export interface ResultatRestaurationTable { inseres: number; ignores: number; total: number; erreur?: string }

export async function restaurerBackup(dump: any): Promise<Record<string, ResultatRestaurationTable>> {
  await initDb();
  const client = getLibsqlClient();
  const resultat: Record<string, ResultatRestaurationTable> = {};
  for (const { champ, table, sansColonnes } of TABLES_SAUVEGARDE) {
    const lignes: any[] = Array.isArray(dump?.[champ]) ? dump[champ] : [];
    resultat[champ] = { inseres: 0, ignores: 0, total: lignes.length };
    if (!lignes.length) continue;
    const infoCols = await exec(`PRAGMA table_info(${table})`);
    const colsReelles = new Set((infoCols.rows as any[]).map((r) => String(r.name)));
    // Colonnes ÉCARTÉES de la sauvegarde (blobs) mais NOT NULL sans valeur par défaut :
    // sans bouche-trou, l'INSERT viole la contrainte et c'est TOUTE la table qui échoue
    // — la restauration renvoyait « 0 inséré » sur projet_fichiers alors que le
    // commentaire de la sauvegarde promettait de retrouver l'inventaire. On insère une
    // chaîne vide : la ligne revient (nom, date, projet, lien Drive…), l'octet, lui,
    // est perdu et reste « à retrouver », comme annoncé.
    const boucheTrous = (infoCols.rows as any[])
      .filter((r) => (sansColonnes || []).includes(String(r.name)) && Number(r.notnull) === 1 && r.dflt_value == null)
      .map((r) => String(r.name));
    const stmts: { sql: string; args: any[] }[] = [];
    for (const ligne of lignes) {
      // Pas d'exigence d'`id` : certaines tables ont une autre clé primaire (parametres_app
      // est clé/valeur). On se contente d'exiger un objet ayant au moins une colonne connue.
      if (!ligne || typeof ligne !== "object" || Array.isArray(ligne)) continue;
      const cols = Object.keys(ligne).filter((k) => colsReelles.has(k));
      if (!cols.length) continue;
      const args = cols.map((k) => ligne[k] ?? null);
      for (const c of boucheTrous) if (!cols.includes(c)) { cols.push(c); args.push(""); }
      stmts.push({
        sql: `INSERT OR IGNORE INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
        args,
      });
    }
    if (!stmts.length) continue;
    try {
      // Un batch par table : une erreur sur une table n'empêche pas la restauration des autres.
      const resSets = await client.batch(stmts, "write");
      for (const rs of resSets) {
        if (Number(rs.rowsAffected || 0) > 0) resultat[champ].inseres++;
        else resultat[champ].ignores++;
      }
    } catch (e: any) {
      resultat[champ].erreur = e?.message || String(e);
    }
    _lastWrite = Date.now();
  }
  return resultat;
}

/** Employé ACTIF par son nom exact (insensible à la casse et aux espaces de bord). Sert à
 *  refuser une saisie d'heures sur un nom qui n'existe pas, et à prendre le taux horaire
 *  dans la fiche plutôt que dans la requête. */
export async function employeParNom(nom: string | null | undefined): Promise<Employe | null> {
  const n = String(nom || "").trim();
  if (!n) return null;
  return await one<Employe>("SELECT * FROM employes WHERE actif = 1 AND LOWER(TRIM(nom)) = LOWER(?)", [n]);
}

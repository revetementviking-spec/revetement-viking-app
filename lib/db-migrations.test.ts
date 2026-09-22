// Migrations sur une base ANCIENNE : la base temporaire est préparée AVANT d'importer
// lib/db (schéma d'époque), puis initDb() joue toutes les migrations. Base propre à ce
// fichier : Vitest isole les modules par fichier de test.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

let dossier = "";
let db: typeof import("./db");

beforeAll(async () => {
  dossier = mkdtempSync(path.join(tmpdir(), "viking-migr-"));
  const url = `file:${path.join(dossier, "ancienne.db").replace(/\\/g, "/")}`;
  // Schéma d'époque : depenses_projet avec projet_id NOT NULL (avant les dépenses
  // générales) et déjà les colonnes ajoutées par ALTER (ajoute_par, version, detaxe) ;
  // projets avec des numéros en double.
  const ancien = createClient({ url });
  await ancien.batch([
    `CREATE TABLE depenses_projet (
      id INTEGER PRIMARY KEY AUTOINCREMENT, projet_id INTEGER NOT NULL,
      date TEXT NOT NULL, montant REAL NOT NULL, fournisseur TEXT, description TEXT,
      categorie TEXT, date_saisie TEXT NOT NULL, ajoute_par TEXT,
      version INTEGER NOT NULL DEFAULT 0, detaxe INTEGER NOT NULL DEFAULT 0
    )`,
    `INSERT INTO depenses_projet (projet_id, date, montant, fournisseur, date_saisie, ajoute_par, version, detaxe)
     VALUES (1, '2026-09-01', 125.5, 'Rona', '2026-09-01T12:00:00Z', 'Francis', 3, 1)`,
    `CREATE TABLE projets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER, nom TEXT NOT NULL, adresse_chantier TEXT, description TEXT,
      statut TEXT DEFAULT 'actif',
      date_debut TEXT, date_fin_prevue TEXT, date_fin_reelle TEXT,
      soumission_numero TEXT, budget_estime REAL, heures_estimees REAL,
      numero TEXT, date_creation TEXT NOT NULL
    )`,
    `INSERT INTO projets (nom, numero, date_creation) VALUES ('A', '2026-001', '2026-01-01T00:00:00Z')`,
    `INSERT INTO projets (nom, numero, date_creation) VALUES ('B', '2026-001', '2026-01-02T00:00:00Z')`,
    `INSERT INTO projets (nom, numero, date_creation) VALUES ('C', '2026-001', '2026-01-03T00:00:00Z')`,
    `INSERT INTO projets (nom, numero, date_creation) VALUES ('D', '2026-002', '2026-01-04T00:00:00Z')`,
  ], "write");
  ancien.close();

  process.env.TURSO_URL = url;
  delete process.env.TURSO_AUTH_TOKEN;
  db = await import("./db");
  await db.initDb();
}, 60_000);

afterAll(() => {
  try { rmSync(dossier, { recursive: true, force: true }); } catch { /* verrou Windows */ }
});

describe("M2 — reconstruction de depenses_projet (projet_id NOT NULL → nullable)", () => {
  it("la table renaît avec le schéma COMPLET et les données sont conservées", async () => {
    const info = (await db.db().execute("PRAGMA table_info(depenses_projet)")).rows as any[];
    const cols = new Map(info.map((c) => [String(c.name), c]));
    for (const c of ["ajoute_par", "version", "detaxe", "recu_data", "recu_type"]) expect(cols.has(c), `colonne ${c}`).toBe(true);
    expect(Number(cols.get("projet_id")!.notnull)).toBe(0);
    const ligne = (await db.db().execute("SELECT * FROM depenses_projet")).rows[0] as any;
    expect(Number(ligne.montant)).toBe(125.5);
    expect(ligne.ajoute_par).toBe("Francis");
    expect(Number(ligne.version)).toBe(3);
    expect(Number(ligne.detaxe)).toBe(1);
    // Une dépense générale (sans projet) passe maintenant.
    const id = await db.ajouterDepenseProjet({ projet_id: null, date: "2026-09-02", montant: 10 });
    expect(id).toBeGreaterThan(0);
  });
});

describe("M5 — projets.numero UNIQUE", () => {
  it("les doublons existants sont suffixés (-2, -3) et l'index UNIQUE existe", async () => {
    const rows = (await db.db().execute("SELECT nom, numero FROM projets ORDER BY id")).rows as any[];
    expect(rows.map((r) => r.numero)).toEqual(["2026-001", "2026-001-2", "2026-001-3", "2026-002"]);
    const idx = (await db.db().execute("PRAGMA index_list(projets)")).rows as any[];
    const unique = idx.find((i) => String(i.name) === "idx_projets_numero_unique");
    expect(unique).toBeTruthy();
    expect(Number(unique.unique)).toBe(1);
    // Le dédoublonnage laisse une trace dans le journal.
    const j = (await db.db().execute("SELECT COUNT(*) AS n FROM journal_activite WHERE description LIKE 'Numéro de projet dédoublonné%'")).rows[0] as any;
    expect(Number(j.n)).toBe(2);
  });

  it("genererNumeroProjet : MAX+1 (les suffixes -2 ne comptent pas), un numéro imposé déjà pris est refusé", async () => {
    const annee = new Date().getFullYear();
    // Projet de l'année courante avec un suffixe dédoublonné : 014-2 compte pour 14.
    await db.db().execute({ sql: "INSERT INTO projets (nom, numero, date_creation) VALUES ('E', ?, '2026-01-05T00:00:00Z')", args: [`${annee}-014-2`] });
    expect(await db.genererNumeroProjet()).toBe(`${annee}-015`);
    const id = await db.ajouterProjet({ nom: "F" });
    expect((await db.getProjet(id))?.numero).toBe(`${annee}-015`);
    expect(await db.genererNumeroProjet()).toBe(`${annee}-016`);
    await expect(db.ajouterProjet({ nom: "G", numero: `${annee}-015` } as any)).rejects.toMatchObject({ code: "NUMERO_PROJET_PRIS" });
  });

  it("le schéma est marqué à SCHEMA_VERSION une fois les migrations passées", async () => {
    const r = (await db.db().execute("PRAGMA user_version")).rows[0] as any;
    expect(Number(r.user_version)).toBe(db.SCHEMA_VERSION);
  });
});

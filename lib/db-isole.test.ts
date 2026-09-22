// Tests qui ÉCRIVENT en base : ils ouvrent leur PROPRE base SQLite temporaire (TURSO_URL
// posé sur un fichier jetable AVANT d'importer lib/db), jamais data/soumissions.db ni
// la base de production. Le schéma complet est créé par initDb() (toutes les migrations).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let dossier = "";
let db: typeof import("./db");
let idem: typeof import("./idempotence");

beforeAll(async () => {
  dossier = mkdtempSync(path.join(tmpdir(), "viking-test-"));
  process.env.TURSO_URL = `file:${path.join(dossier, "test.db").replace(/\\/g, "/")}`;
  delete process.env.TURSO_AUTH_TOKEN;
  db = await import("./db");
  idem = await import("./idempotence");
  await db.initDb();
}, 60_000);

afterAll(() => {
  try { rmSync(dossier, { recursive: true, force: true }); } catch { /* verrou Windows : le dossier temporaire sera purgé par l'OS */ }
});

describe("idempotence (table + helper avecIdempotence)", () => {
  const { NextRequest, NextResponse } = require("next/server") as typeof import("next/server");
  const requete = (cle?: string) => new NextRequest("http://localhost/api/heures", { method: "POST", headers: cle ? { "X-Idempotence-Cle": cle } : {} });

  it("sans en-tête : le handler s'exécute à chaque appel", async () => {
    let n = 0;
    const h = async () => { n++; return NextResponse.json({ ok: true, id: n }); };
    await idem.avecIdempotence(requete(), h);
    await idem.avecIdempotence(requete(), h);
    expect(n).toBe(2);
  });

  it("avec la même clé : la 2e requête rejoue la réponse stockée sans réexécuter", async () => {
    let n = 0;
    const h = async () => { n++; return NextResponse.json({ ok: true, id: 41 + n }, { status: 201 }); };
    const r1 = await idem.avecIdempotence(requete("cle-a"), h);
    const r2 = await idem.avecIdempotence(requete("cle-a"), h);
    expect(n).toBe(1);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(await r2.json()).toEqual({ ok: true, id: 42 });
    expect(r2.headers.get("X-Idempotence-Rejouee")).toBe("1");
    expect(await r1.json()).toEqual({ ok: true, id: 42 }); // la réponse d'origine reste lisible
  });

  it("un refus (4xx) n'est PAS mémorisé : la même clé peut être renvoyée corrigée", async () => {
    let n = 0;
    const h = async () => { n++; return n === 1 ? NextResponse.json({ error: "x" }, { status: 400 }) : NextResponse.json({ ok: true }); };
    const r1 = await idem.avecIdempotence(requete("cle-b"), h);
    const r2 = await idem.avecIdempotence(requete("cle-b"), h);
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(200);
    expect(n).toBe(2);
  });

  it("la clé est propre à la ROUTE : même clé sur /api/depenses ne rejoue pas /api/heures", async () => {
    let n = 0;
    const h = async () => { n++; return NextResponse.json({ ok: true }); };
    await idem.avecIdempotence(requete("cle-c"), h);
    await idem.avecIdempotence(new NextRequest("http://localhost/api/depenses", { method: "POST", headers: { "X-Idempotence-Cle": "cle-c" } }), h);
    expect(n).toBe(2);
  });

  it("clé mal formée → 400 sans exécuter", async () => {
    let n = 0;
    const r = await idem.avecIdempotence(requete("a".repeat(65)), async () => { n++; return NextResponse.json({ ok: true }); });
    expect(r.status).toBe(400);
    expect(n).toBe(0);
    const r2 = await idem.avecIdempotence(requete("espace interdit"), async () => { n++; return NextResponse.json({ ok: true }); });
    expect(r2.status).toBe(400);
  });

  it("purge : une entrée de plus de 7 jours disparaît, une récente reste", async () => {
    await db.ecrireIdempotence("/x|vieille", 200, "{}");
    await db.db().execute({ sql: "UPDATE idempotence SET cree_le = ? WHERE cle = ?", args: [new Date(Date.now() - 8 * 86400000).toISOString(), "/x|vieille"] });
    await db.ecrireIdempotence("/x|recente", 200, "{}");
    expect(await db.purgerIdempotence(7)).toBeGreaterThanOrEqual(1);
    expect(await db.lireIdempotence("/x|vieille")).toBeNull();
    expect(await db.lireIdempotence("/x|recente")).not.toBeNull();
  });
});

describe("contrats en ligne : numéro séquentiel unique et rattachement du projet par id", () => {
  it("genererNumeroContratPipeline : MAX+1 dans l'année, même après un ancien numéro C-année-client", async () => {
    const annee = new Date().getFullYear();
    const clientId = await db.ajouterClient({ nom: "Client Test Contrats" } as any);
    // Ancien format : C-2026-007 (client_id 7). Le prochain doit être > 007, jamais 007.
    await db.creerContratPipeline({ client_id: clientId, numero: `C-${annee}-007`, token: "tok-ancien", data_json: {}, pdf_brouillon: "" });
    const n1 = await db.genererNumeroContratPipeline();
    expect(n1).toBe(`C-${annee}-008`);
    await db.creerContratPipeline({ client_id: clientId, numero: n1, token: "tok-n1", data_json: {}, pdf_brouillon: "" });
    expect(await db.genererNumeroContratPipeline()).toBe(`C-${annee}-009`);
  });

  it("deux contrats signés du MÊME client avec le MÊME numéro donnent DEUX projets (plus d'écrasement)", async () => {
    const clientId = await db.ajouterClient({ nom: "Client Deux Contrats" } as any);
    const numero = "C-2025-003"; // ancien format non unique, tel qu'il existe en base
    const idA = await db.creerContratPipeline({ client_id: clientId, numero, token: "tok-A", data_json: { nom_projet: "Chantier A", prix_total: 1000 }, pdf_brouillon: "" });
    const idB = await db.creerContratPipeline({ client_id: clientId, numero, token: "tok-B", data_json: { nom_projet: "Chantier B", prix_total: 2000 }, pdf_brouillon: "" });
    for (const t of ["tok-A", "tok-B"]) {
      expect(await db.signerContratPipeline(t, { signature_dataurl: "data:image/png;base64,AA==", signature_nom: "Test", pdf_signe: "" })).toBe(true);
    }
    const rA = await db.creerProjetDepuisContrat("tok-A");
    const rB = await db.creerProjetDepuisContrat("tok-B");
    expect(rA.ok && rB.ok).toBe(true);
    expect(rA.cree).toBe(true);
    expect(rB.cree).toBe(true);
    expect(rA.projet_id).not.toBe(rB.projet_id);
    const pA = await db.getProjet(rA.projet_id!);
    const pB = await db.getProjet(rB.projet_id!);
    expect(pA?.nom).toBe("Chantier A");
    expect(pB?.nom).toBe("Chantier B");
    expect(pA?.prix_contrat).toBe(1000);
    expect(pB?.prix_contrat).toBe(2000);
    expect((pA as any)?.contrat_pipeline_id ?? (await db.db().execute({ sql: "SELECT contrat_pipeline_id AS c FROM projets WHERE id = ?", args: [rA.projet_id!] })).rows[0].c).toBe(idA);
    expect((await db.db().execute({ sql: "SELECT contrat_pipeline_id AS c FROM projets WHERE id = ?", args: [rB.projet_id!] })).rows[0].c).toBe(idB);
    // Rejouer la signature du contrat A retrouve SON projet (idempotent), pas un 3e.
    const rA2 = await db.creerProjetDepuisContrat("tok-A");
    expect(rA2.projet_id).toBe(rA.projet_id);
    expect(rA2.cree).toBe(false);
  });
});

describe("factures : numéro généré MAX+1, numéro pris refusé, montant_paye", () => {
  it("génère F-001 puis F-002, ne retombe jamais sur un numéro pris, et montant_paye suit « payée »", async () => {
    const pid = await db.ajouterProjet({ nom: "Projet Factures" });
    const f1 = await db.ajouterFactureProjet({ projet_id: pid, montant: 100, date: "2026-09-01" });
    const f2 = await db.ajouterFactureProjet({ projet_id: pid, montant: 200, date: "2026-09-02", numero: "F-010" });
    const f3 = await db.ajouterFactureProjet({ projet_id: pid, montant: 300, date: "2026-09-03" });
    const liste = await db.listerFacturesProjet(pid);
    const num = (id: number) => liste.find((f) => f.id === id)!.numero;
    expect(num(f1)).toBe("F-001");
    expect(num(f2)).toBe("F-010");
    expect(num(f3)).toBe("F-011"); // MAX+1, pas COUNT+1 (qui aurait redonné F-003… puis F-010 en double)
    expect(await db.numeroFactureExiste("F-010")).toBe(true);
    expect(await db.numeroFactureExiste("F-999")).toBe(false);
    expect(Number(liste.find((f) => f.id === f1)!.montant_paye)).toBe(0);
    await db.marquerFacturePayee(f1, "2026-09-10");
    expect(Number((await db.listerFacturesProjet(pid)).find((f) => f.id === f1)!.montant_paye)).toBe(100);
    await db.annulerPaiementFacture(f1);
    expect(Number((await db.listerFacturesProjet(pid)).find((f) => f.id === f1)!.montant_paye)).toBe(0);
  });
});

describe("cascades transactionnelles (M3) et gardes de la couche données", () => {
  it("supprimerProjet : heures, dépenses, factures, photos, extras et documents disparaissent ; tâches et contrats détachés", async () => {
    const pid = await db.ajouterProjet({ nom: "Projet à supprimer" });
    await db.ajouterEmploye({ nom: "Testeur Cascade", taux_horaire: 30 } as any);
    await db.ajouterHeureProjet({ projet_id: pid, date: "2026-09-01", heures: 4, employe: "Testeur Cascade", taux_horaire: 30 });
    await db.ajouterDepenseProjet({ projet_id: pid, date: "2026-09-01", montant: 50 });
    await db.ajouterFactureProjet({ projet_id: pid, montant: 100, date: "2026-09-01" });
    await db.ajouterPhotoChantier({ projet_id: pid, date: "2026-09-01", photo_data: "data:image/png;base64,AA==" });
    await db.ajouterExtra({ projet_id: pid, date: "2026-09-01", description: "extra" });
    await db.ajouterFichierProjet({ projet_id: pid, nom: "permis.pdf", type: "application/pdf", data: "data:application/pdf;base64,AA==" });
    const tid = await db.ajouterTache({ titre: "Tâche liée", projet_id: pid });
    const r = await db.supprimerProjet(pid);
    expect(r.ok).toBe(true);
    expect(await db.getProjet(pid)).toBeNull();
    for (const t of ["heures_projet", "depenses_projet", "factures_projet", "photos_chantier", "extras", "projet_fichiers"]) {
      const n = (await db.db().execute({ sql: `SELECT COUNT(*) AS n FROM ${t} WHERE projet_id = ?`, args: [pid] })).rows[0] as any;
      expect(Number(n.n), t).toBe(0);
    }
    const tache = (await db.db().execute({ sql: "SELECT projet_id FROM taches_client WHERE id = ?", args: [tid] })).rows[0] as any;
    expect(tache.projet_id).toBeNull();
  });

  it("supprimerProjet refuse quand un contrat signé est joint (rien n'est effacé)", async () => {
    const pid = await db.ajouterProjet({ nom: "Projet avec contrat" });
    await db.modifierProjet(pid, { contrat_signe_data: "data:application/pdf;base64,AA==", contrat_signe_type: "application/pdf" } as any);
    await db.ajouterDepenseProjet({ projet_id: pid, date: "2026-09-01", montant: 5 });
    const r = await db.supprimerProjet(pid);
    expect(r.ok).toBe(false);
    expect((await db.listerDepensesProjet(pid)).length).toBe(1);
  });

  it("terminerTache : clôture + prochaine occurrence dans la même transaction", async () => {
    const id = await db.ajouterTache({ titre: "Récurrente", date_due: "2026-09-07", recurrence: "hebdo" });
    const r = await db.terminerTache(id, "2026-09-07");
    expect(r.prochaine).toBeGreaterThan(0);
    const rows = (await db.db().execute({ sql: "SELECT id, statut, date_due FROM taches_client WHERE id IN (?, ?) ORDER BY id", args: [id, r.prochaine!] })).rows as any[];
    expect(rows[0].statut).toBe("complete");
    expect(rows[1].statut).toBe("a_faire");
    expect(rows[1].date_due).toBe("2026-09-14");
    // Sans récurrence : pas de nouvelle tâche.
    const id2 = await db.ajouterTache({ titre: "Unique" });
    expect(await db.terminerTache(id2, "2026-09-07")).toEqual({});
  });

  it("supprimer(soumission) coupe les liens des projets et contrats", async () => {
    const numero = await db.sauvegarder({ client: { nom: "Client S" }, total: 100, data: {} });
    const pid = await db.ajouterProjet({ nom: "Projet lié", soumission_numero: numero });
    await db.supprimer(numero);
    expect(await db.charger(numero)).toBeNull();
    expect((await db.getProjet(pid))?.soumission_numero).toBeNull();
  });

  it("ajouterHeureProjet exige un taux (plus de repli à 90 $/h)", async () => {
    const pid = await db.ajouterProjet({ nom: "Projet sans taux" });
    await expect(db.ajouterHeureProjet({ projet_id: pid, date: "2026-09-01", heures: 1, employe: "X" })).rejects.toMatchObject({ code: "TAUX_REQUIS" });
    await expect(db.ajouterHeureProjet({ projet_id: pid, date: "2026-09-01", heures: 1, employe: "X", taux_horaire: 0 })).rejects.toMatchObject({ code: "TAUX_REQUIS" });
  });

  it("nettoyerPayePeriodesOrphelines (M14) : aucune heure lue → ne supprime RIEN", async () => {
    // Base isolée : on vide les heures pour simuler une lecture qui ne renvoie aucune ligne.
    await db.db().execute("DELETE FROM heures_projet");
    await db.db().execute({ sql: "INSERT OR IGNORE INTO paies_periodes (employe, debut, fin, paye, date_creation) VALUES ('Fantôme', '2026-06-01', '2026-06-14', 0, ?)", args: [new Date().toISOString()] });
    const avant = Number(((await db.db().execute("SELECT COUNT(*) AS n FROM paies_periodes WHERE paye = 0")).rows[0] as any).n);
    expect(avant).toBeGreaterThan(0);
    expect(await db.nettoyerPayePeriodesOrphelines()).toBe(0);
    const apres = Number(((await db.db().execute("SELECT COUNT(*) AS n FROM paies_periodes WHERE paye = 0")).rows[0] as any).n);
    expect(apres).toBe(avant);
  });

  it("inventaire (M4) : UPDATE conditionnel + mouvement « WHERE changes() = 1 » dans un lot — refus atomique, aucun mouvement fantôme", async () => {
    const c = db.db();
    const now = new Date().toISOString();
    const ins = await c.execute({ sql: "INSERT INTO inventaire (nom, quantite, unite, date_creation, date_modif) VALUES ('Vis', 3, 'bte', ?, ?)", args: [now, now] });
    const id = Number(ins.lastInsertRowid);
    const lot = (delta: number) => c.batch([
      { sql: "UPDATE inventaire SET quantite = quantite + ?, date_modif = ? WHERE id = ? AND quantite + ? >= 0", args: [delta, now, id, delta] },
      { sql: "INSERT INTO inventaire_mouvements (inventaire_id, delta, type, note, par, date_creation) SELECT ?, ?, ?, NULL, 'test', ? WHERE changes() = 1", args: [id, delta, delta > 0 ? "entree" : "sortie", now] },
    ], "write");
    const ok = await lot(-2);
    expect(Number(ok[0].rowsAffected)).toBe(1);
    const refus = await lot(-5); // 1 en stock : refusé, et AUCUN mouvement écrit
    expect(Number(refus[0].rowsAffected)).toBe(0);
    const q = (await c.execute({ sql: "SELECT quantite FROM inventaire WHERE id = ?", args: [id] })).rows[0] as any;
    expect(Number(q.quantite)).toBe(1);
    const mvts = (await c.execute({ sql: "SELECT delta FROM inventaire_mouvements WHERE inventaire_id = ?", args: [id] })).rows as any[];
    expect(mvts.map((m) => Number(m.delta))).toEqual([-2]);
  });

  it("detecterPertesLignes : signale une table qui a perdu plus de 20 % de ses lignes", () => {
    const alertes = db.detecterPertesLignes({ projets: 70, clients: 100, factures: 3, heures: 500 }, { projets: 100, clients: 90, factures: 4, heures: 500 });
    expect(alertes).toHaveLength(1);
    expect(alertes[0]).toMatch(/^projets : 100 → 70/);
    expect(db.detecterPertesLignes({ projets: 81 }, { projets: 100 })).toHaveLength(0);
    expect(db.detecterPertesLignes({ projets: 0 }, null)).toHaveLength(0);
  });

  it("purgerJournaux : vieux journal, empreintes > 24 h et idempotence > 7 j en un lot", async () => {
    const c = db.db();
    const maintenant = Date.now();
    const iso = (ms: number) => new Date(maintenant - ms).toISOString();
    await c.batch([
      { sql: "INSERT INTO journal_activite (date, type, description) VALUES (?, 'projet.cree', 'vieux')", args: [iso(91 * 86400000)] },
      { sql: "INSERT INTO journal_activite (date, type, description) VALUES (?, 'projet.cree', 'recent')", args: [iso(1000)] },
      { sql: "INSERT INTO journal_activite (date, type, ref_type, ref_id, description) VALUES (?, 'requete.empreinte', 'lead-web', 'e1', 'vieille empreinte')", args: [iso(25 * 3600000)] },
      { sql: "INSERT INTO journal_activite (date, type, ref_type, ref_id, description) VALUES (?, 'requete.empreinte', 'lead-web', 'e2', 'empreinte fraiche')", args: [iso(3600000)] },
      { sql: "INSERT OR IGNORE INTO idempotence (cle, statut, corps, cree_le) VALUES ('/p|vieille', 200, '{}', ?)", args: [iso(8 * 86400000)] },
      { sql: "INSERT OR IGNORE INTO idempotence (cle, statut, corps, cree_le) VALUES ('/p|fraiche', 200, '{}', ?)", args: [iso(1000)] },
    ], "write");
    await db.purgerJournaux(maintenant);
    const descs = ((await c.execute("SELECT description FROM journal_activite WHERE description IN ('vieux','recent','vieille empreinte','empreinte fraiche')")).rows as any[]).map((r) => r.description).sort();
    expect(descs).toEqual(["empreinte fraiche", "recent"]);
    expect(await db.lireIdempotence("/p|vieille")).toBeNull();
    expect(await db.lireIdempotence("/p|fraiche")).not.toBeNull();
  });
});

describe("heures : contrôles de saisie et paie par quinzaine (DAS de la fiche, ventilation)", () => {
  it("controlesSaisieHeures : cumul du jour et doublon récent, l'entrée modifiée exclue", async () => {
    const pid = await db.ajouterProjet({ nom: "Projet Heures" });
    await db.ajouterEmploye({ nom: "Testeur Heures", taux_horaire: 40, das_pct: 0.2 } as any);
    const id1 = await db.ajouterHeureProjet({ projet_id: pid, date: "2026-09-14", heures: 8, employe: "Testeur Heures", taux_horaire: 40 });
    const c = await db.controlesSaisieHeures({ employe: "Testeur Heures", date: "2026-09-14", projet_id: pid, heures: 8 });
    expect(c.total_jour).toBe(8);
    expect(c.doublons_recents).toBe(1);
    const c2 = await db.controlesSaisieHeures({ employe: "Testeur Heures", date: "2026-09-14", projet_id: pid, heures: 8, exclureId: id1 });
    expect(c2.total_jour).toBe(0);
    expect(c2.doublons_recents).toBe(0);
    const c3 = await db.controlesSaisieHeures({ employe: "Testeur Heures", date: "2026-09-14", projet_id: pid, heures: 7.5 });
    expect(c3.doublons_recents).toBe(0); // même jour, autre nombre d'heures : pas un doublon
  });

  it("listerPaiePeriodes : DAS de la fiche (20 %), deux taux ventilés, surplus en banque, relecture sans changement", async () => {
    const pid = await db.ajouterProjet({ nom: "Projet Paie" });
    await db.ajouterEmploye({ nom: "Testeur Paie", taux_horaire: 40, das_pct: 0.2 } as any);
    // Quinzaine ancrée sur le lundi 2026-05-18 : 2026-09-07 (lundi) → 2026-09-20 (dimanche).
    // 50 h à 40 $ (7 au 11 sept.) + 40 h à 50 $ (14 au 17 sept.) = 90 h.
    for (const d of ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"]) {
      await db.ajouterHeureProjet({ projet_id: pid, date: d, heures: 10, employe: "Testeur Paie", taux_horaire: 40 });
    }
    for (const d of ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17"]) {
      await db.ajouterHeureProjet({ projet_id: pid, date: d, heures: 10, employe: "Testeur Paie", taux_horaire: 50 });
    }
    const periodes = await db.listerPaiePeriodes("Testeur Paie");
    const p = periodes.find((x) => x.debut === "2026-09-07")!;
    expect(p).toBeTruthy();
    expect(p.fin).toBe("2026-09-20");
    expect(p.heures_travaillees).toBe(90);
    expect(p.heures_normales).toBe(80);
    expect(Number((p as any).banque_solde)).toBe(10);
    // Taux moyen pondéré : (50×40 + 40×50) / 90 = 44,44… ; brut = 80 × 44,44 = 3 555,56
    expect(p.taux_horaire).toBeCloseTo(4000 / 90, 6);
    expect(p.montant_brut).toBeCloseTo(80 * 4000 / 90, 4);
    expect(p.das_pct).toBeCloseTo(0.2, 6);                 // fiche employé, pas 0,15 codé en dur
    expect(p.das_montant).toBeCloseTo(p.montant_brut * 0.2, 4);
    expect(p.gains_par_taux).toHaveLength(2);
    expect(p.gains_par_taux!.reduce((s, g) => s + g.montant, 0)).toBeCloseTo(p.montant_brut, 4);
    // Relecture : mêmes chiffres, même id (pas de doublon de période).
    const encore = await db.listerPaiePeriodes("Testeur Paie");
    const p2 = encore.find((x) => x.debut === "2026-09-07")!;
    expect(p2.id).toBe(p.id);
    expect(p2.montant_brut).toBe(p.montant_brut);
    // Paie versée → modifier une heure de la période est refusé (heureDansPaiePayee).
    await db.marquerPayePeriode(p.id!, true, "2026-10-01");
    expect(await db.heureDansPaiePayee("Testeur Paie", "2026-09-16")).toBe(true);
    expect(await db.heureDansPaiePayee("Testeur Paie", "2026-09-28")).toBe(false);
  });
});

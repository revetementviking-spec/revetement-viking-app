// Jarvis — outils de données (lecture seule) que Claude peut appeler pour répondre
// aux questions de Francis à partir de ses vraies données.
import {
  db, finances, listerProjets, statistiques, listerClients,
  listerTaches, listerExtras, listerToutesDepenses,
  getProjet, rechercheGlobale, listerVehicules, listerAssurances, listerFacturesProjet,
} from "@/lib/db";

// === DÉFINITIONS D'OUTILS (format Anthropic tool-use) ===
export const OUTILS_JARVIS = [
  {
    name: "apercu_entreprise",
    description: "Vue d'ensemble rapide : nombre de projets par statut, CA et dépenses de l'année, marge, factures impayées, tâches ouvertes, extras à facturer. À appeler en premier pour une question générale.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "finances_mensuelles",
    description: "Détail financier mois par mois pour une année : revenus (avant taxes), dépenses (avant taxes), main-d'œuvre, marge nette.",
    input_schema: { type: "object", properties: { annee: { type: "number", description: "Année, ex: 2026" } }, required: ["annee"], additionalProperties: false },
  },
  {
    name: "projets",
    description: "Liste des projets avec leurs chiffres : prix contrat, extras facturés, dépenses, main-d'œuvre, coût total, marge $ et %. Filtrable par statut.",
    input_schema: { type: "object", properties: { statut: { type: "string", enum: ["actif", "a_venir", "complete", "annule"], description: "Filtre optionnel" } }, additionalProperties: false },
  },
  {
    name: "depenses",
    description: "Dépenses filtrées par période, fournisseur ou catégorie. Retourne les lignes (max 100 récentes) + total.",
    input_schema: { type: "object", properties: {
      depuis: { type: "string", description: "Date début AAAA-MM-JJ" },
      jusqu: { type: "string", description: "Date fin AAAA-MM-JJ" },
      fournisseur: { type: "string" },
      categorie: { type: "string" },
    }, additionalProperties: false },
  },
  {
    name: "heures",
    description: "Heures travaillées agrégées par employé (et coût) sur une période, optionnellement pour un projet.",
    input_schema: { type: "object", properties: {
      depuis: { type: "string", description: "AAAA-MM-JJ" },
      jusqu: { type: "string", description: "AAAA-MM-JJ" },
      projet_id: { type: "number" },
    }, additionalProperties: false },
  },
  {
    name: "taches",
    description: "Tâches à faire / complétées, filtrables par statut et personne assignée (Francis ou Gabriel).",
    input_schema: { type: "object", properties: {
      statut: { type: "string", enum: ["a_faire", "complete"] },
      assigne_a: { type: "string", enum: ["Francis", "Gabriel"] },
    }, additionalProperties: false },
  },
  {
    name: "clients",
    description: "Liste des clients (nom, coordonnées, statut, nb de projets). Recherche optionnelle par nom.",
    input_schema: { type: "object", properties: { recherche: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "soumissions_stats",
    description: "Statistiques des soumissions : nombre et montants par statut, pipeline, taux de conversion.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "extras",
    description: "Extras (travaux/matériaux hors soumission) à facturer ou déjà facturés.",
    input_schema: { type: "object", properties: { statut: { type: "string", enum: ["a_charger", "charge"] } }, additionalProperties: false },
  },
  {
    name: "factures_impayees",
    description: "Factures non payées avec leur ancienneté (aging) et le total dû, par projet. Pour savoir qui doit de l'argent.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "paie",
    description: "Sommaire des paies : périodes récentes par employé (heures normales/sup, brut, net, payé ou non).",
    input_schema: { type: "object", properties: { employe: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "client_details",
    description: "Fiche complète d'un client par son nom : coordonnées, ses projets (marge, solde dû), tâches ouvertes.",
    input_schema: { type: "object", properties: { nom: { type: "string" } }, required: ["nom"], additionalProperties: false },
  },
  {
    name: "projet_details",
    description: "Analyse détaillée d'un projet par son nom : revenu, dépenses, heures par employé, extras, factures, marge.",
    input_schema: { type: "object", properties: { nom: { type: "string" } }, required: ["nom"], additionalProperties: false },
  },
  {
    name: "recherche",
    description: "Recherche libre dans toute l'app (clients, projets, soumissions, dépenses par montant, commentaires…). Utile quand on ne sait pas dans quelle catégorie chercher.",
    input_schema: { type: "object", properties: { terme: { type: "string" } }, required: ["terme"], additionalProperties: false },
  },
  {
    name: "inventaire",
    description: "État de l'inventaire (matériaux/outils en stock) : quantités, emplacement, valeur. Filtrable par nom/catégorie.",
    input_schema: { type: "object", properties: { recherche: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "vehicules_assurances",
    description: "Véhicules de l'entreprise et assurances, avec les renouvellements d'assurance à venir.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  // === ACTIONS (mode PROPOSITION : n'écrit rien, Francis confirme d'un clic) ===
  {
    name: "proposer_creer_tache",
    description: "PROPOSE de créer une tâche/rappel (n'exécute rien — l'utilisateur confirme d'un bouton). Utilise dès qu'on te demande d'ajouter, créer ou planifier une tâche ou un rappel.",
    input_schema: { type: "object", properties: {
      titre: { type: "string" }, assigne_a: { type: "string", enum: ["Francis", "Gabriel"] },
      date_due: { type: "string", description: "AAAA-MM-JJ" }, priorite: { type: "number", description: "2=basse,3=normale,4=haute,5=urgente" },
      recurrence: { type: "string", enum: ["quotidien", "hebdo", "2sem", "mensuel"] },
    }, required: ["titre"], additionalProperties: false },
  },
  {
    name: "proposer_completer_projet",
    description: "PROPOSE de marquer un projet comme complété (= facturé). N'exécute rien — confirmation requise.",
    input_schema: { type: "object", properties: { nom: { type: "string" } }, required: ["nom"], additionalProperties: false },
  },
  {
    name: "proposer_creer_depense",
    description: "PROPOSE d'enregistrer une dépense. N'exécute rien — confirmation requise.",
    input_schema: { type: "object", properties: {
      montant: { type: "number" }, fournisseur: { type: "string" }, categorie: { type: "string" },
      date: { type: "string", description: "AAAA-MM-JJ (défaut: aujourd'hui)" }, projet_nom: { type: "string" }, description: { type: "string" },
    }, required: ["montant"], additionalProperties: false },
  },
];

// Noms des outils qui PROPOSENT une action (aucune écriture — confirmation UI requise).
export const OUTILS_ACTION = new Set(["proposer_creer_tache", "proposer_completer_projet", "proposer_creer_depense"]);

const num = (v: any) => Math.round((+v || 0) * 100) / 100;

// === EXÉCUTEURS ===
export async function executerOutilJarvis(nom: string, input: any): Promise<any> {
  try {
    switch (nom) {
      case "apercu_entreprise": {
        const annee = new Date().getFullYear();
        const [projets, fin, extrasAC] = await Promise.all([
          listerProjets(), finances(annee), listerExtras("a_charger"),
        ]);
        const parStatut: Record<string, number> = {};
        for (const p of projets) parStatut[p.statut || "?"] = (parStatut[p.statut || "?"] || 0) + 1;
        const ca = fin.mois.reduce((s: number, m: any) => s + (m.revenu_avant_taxes || 0), 0);
        const dep = fin.mois.reduce((s: number, m: any) => s + (m.depenses_avant_taxes || 0), 0);
        const mo = fin.mois.reduce((s: number, m: any) => s + (m.mo || 0), 0);
        const marge = fin.mois.reduce((s: number, m: any) => s + (m.marge || 0), 0);
        const actifs = projets.filter((p) => p.statut === "actif");
        const totMargeAct = actifs.reduce((s, p) => s + (p.marge || 0), 0);
        const totRevAct = actifs.reduce((s, p) => s + (p.revenu_avant_taxes || 0), 0);
        const factImp = await db().execute({ sql: "SELECT COALESCE(SUM(montant),0) t, COUNT(*) n FROM factures_projet WHERE payee=0 OR payee IS NULL", args: [] }).catch(() => ({ rows: [{ t: 0, n: 0 }] }));
        const nbTaches = await db().execute({ sql: "SELECT COUNT(*) n FROM taches_client WHERE statut != 'complete'", args: [] }).catch(() => ({ rows: [{ n: 0 }] }));
        return {
          annee, projets_total: projets.length, projets_par_statut: parStatut,
          ca_annee_avant_taxes: num(ca), depenses_annee_avant_taxes: num(dep), main_oeuvre_annee: num(mo),
          marge_nette_annee_avant_taxes: num(marge),
          marge_moyenne_projets_actifs_pct: totRevAct > 0 ? num((totMargeAct / totRevAct) * 100) : 0,
          factures_impayees: { nombre: +(factImp.rows[0] as any).n, montant: num((factImp.rows[0] as any).t) },
          taches_a_faire: +(nbTaches.rows[0] as any).n,
          extras_a_facturer: { nombre: extrasAC.length, montant: num(extrasAC.reduce((s: number, e: any) => s + (e.montant || 0), 0)) },
        };
      }
      case "finances_mensuelles": {
        const fin = await finances(+input.annee || new Date().getFullYear());
        return { annee: fin.annee, mois: fin.mois.map((m: any) => ({
          mois: m.mois, revenu_avant_taxes: num(m.revenu_avant_taxes), depenses_avant_taxes: num(m.depenses_avant_taxes),
          main_oeuvre: num(m.mo), marge_nette: num(m.marge), encaisse: num(m.paye),
        })) };
      }
      case "projets": {
        const p = await listerProjets(input.statut || undefined);
        return { nombre: p.length, projets: p.slice(0, 60).map((x) => ({
          nom: x.nom, client: x.client_nom || null, statut: x.statut,
          prix_contrat: num(x.prix_contrat || x.budget_estime || 0), extras_factures: num((x as any).extras_factures || 0),
          depenses: num(x.total_depenses), main_oeuvre: num(x.cout_main_oeuvre), cout_total: num(x.cout_total),
          marge: num(x.marge), marge_pct: num(x.marge_pct),
          facture: num(x.total_facture), paye: num(x.total_paye), date_fin_prevue: x.date_fin_prevue || null,
        })) };
      }
      case "depenses": {
        let arr = await listerToutesDepenses({ sansData: true });
        if (input.depuis) arr = arr.filter((d: any) => d.date >= input.depuis);
        if (input.jusqu) arr = arr.filter((d: any) => d.date <= input.jusqu);
        if (input.fournisseur) arr = arr.filter((d: any) => (d.fournisseur || "").toLowerCase().includes(String(input.fournisseur).toLowerCase()));
        if (input.categorie) arr = arr.filter((d: any) => (d.categorie || "").toLowerCase().includes(String(input.categorie).toLowerCase()));
        const total = arr.reduce((s: number, d: any) => s + (d.montant || 0), 0);
        return { nombre: arr.length, total: num(total), lignes: arr.slice(0, 100).map((d: any) => ({
          date: d.date, fournisseur: d.fournisseur, categorie: d.categorie, montant: num(d.montant), detaxe: !!d.detaxe, description: d.description || null,
        })) };
      }
      case "heures": {
        const conds: string[] = []; const args: any[] = [];
        if (input.depuis) { conds.push("date >= ?"); args.push(input.depuis); }
        if (input.jusqu) { conds.push("date <= ?"); args.push(input.jusqu); }
        if (input.projet_id) { conds.push("projet_id = ?"); args.push(+input.projet_id); }
        const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
        const r = await db().execute({ sql: `SELECT COALESCE(employe,'?') employe, COALESCE(SUM(heures),0) h, COALESCE(SUM(heures*taux_horaire),0) cout FROM heures_projet ${where} GROUP BY employe ORDER BY h DESC`, args });
        const rows = (r.rows as any[]).map((x) => ({ employe: x.employe, heures: num(x.h), cout: num(x.cout) }));
        return { par_employe: rows, total_heures: num(rows.reduce((s, x) => s + x.heures, 0)), total_cout: num(rows.reduce((s, x) => s + x.cout, 0)) };
      }
      case "taches": {
        const t = await listerTaches({ statut: input.statut || undefined, assigne_a: input.assigne_a || undefined });
        const auj = new Date().toISOString().slice(0, 10);
        return { nombre: t.length, taches: t.slice(0, 80).map((x: any) => ({
          titre: x.titre, statut: x.statut, assigne_a: x.assigne_a || null, echeance: x.date_due || null,
          en_retard: !!(x.date_due && x.date_due < auj && x.statut !== "complete"),
          recurrence: x.recurrence || null, client: x.client_nom || null, projet: x.projet_nom || null,
        })) };
      }
      case "clients": {
        let c = await listerClients();
        if (input.recherche) { const q = String(input.recherche).toLowerCase(); c = c.filter((x: any) => (x.nom || "").toLowerCase().includes(q)); }
        return { nombre: c.length, clients: c.slice(0, 80).map((x: any) => ({
          nom: x.nom, statut: x.statut || null, telephone: x.telephone || null, courriel: x.courriel || null, ville: x.adresse || null,
        })) };
      }
      case "soumissions_stats":
        return await statistiques();
      case "extras": {
        const e = await listerExtras(input.statut || undefined);
        return { nombre: e.length, total: num(e.reduce((s: number, x: any) => s + (x.montant || 0), 0)), extras: e.slice(0, 60).map((x: any) => ({
          projet: x.projet_nom || null, nature: x.nature, description: x.description, montant: num(x.montant), heures: x.heures || null, statut: x.statut, date: x.date,
        })) };
      }
      case "factures_impayees": {
        const auj = new Date();
        const r = await db().execute({
          sql: `SELECT fp.montant, fp.date, fp.numero, p.nom projet, c.nom client
                FROM factures_projet fp LEFT JOIN projets p ON p.id=fp.projet_id LEFT JOIN clients c ON c.id=p.client_id
                WHERE fp.payee=0 OR fp.payee IS NULL ORDER BY fp.date ASC`, args: [],
        });
        const lignes = (r.rows as any[]).map((x) => {
          const jours = Math.max(0, Math.round((auj.getTime() - new Date(x.date).getTime()) / 86400000));
          return { client: x.client || null, projet: x.projet || null, numero: x.numero || null, montant: num(x.montant), date: x.date, jours_ecoules: jours };
        });
        const total = lignes.reduce((s, x) => s + x.montant, 0);
        const plus30 = lignes.filter((x) => x.jours_ecoules > 30);
        return { nombre: lignes.length, total_du: num(total), en_retard_plus_30j: { nombre: plus30.length, montant: num(plus30.reduce((s, x) => s + x.montant, 0)) }, factures: lignes };
      }
      case "paie": {
        const conds: string[] = []; const args: any[] = [];
        if (input.employe) { conds.push("employe = ?"); args.push(input.employe); }
        const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
        const r = await db().execute({ sql: `SELECT employe, debut, fin, heures_normales, heures_sup, montant_brut, montant_net, paye, date_paiement FROM paies_periodes ${where} ORDER BY fin DESC LIMIT 40`, args });
        const rows = (r.rows as any[]).map((x) => ({ employe: x.employe, periode: `${x.debut} → ${x.fin}`, heures_normales: num(x.heures_normales), heures_sup: num(x.heures_sup), brut: num(x.montant_brut), net: num(x.montant_net), paye: !!x.paye, date_paiement: x.date_paiement || null }));
        return { periodes: rows };
      }
      case "client_details": {
        const clients = await listerClients();
        const q = String(input.nom || "").toLowerCase();
        const cl = clients.find((c: any) => (c.nom || "").toLowerCase() === q) || clients.find((c: any) => (c.nom || "").toLowerCase().includes(q));
        if (!cl) return { trouve: false, message: `Aucun client trouvé pour « ${input.nom} ».` };
        const projets = (await listerProjets()).filter((p) => p.client_id === (cl as any).id);
        const taches = await listerTaches({ client_id: (cl as any).id, statut: "a_faire" }).catch(() => []);
        const soldeDu = projets.reduce((s, p) => s + ((p.total_facture || 0) - (p.total_paye || 0)), 0);
        return {
          trouve: true,
          client: { nom: (cl as any).nom, statut: (cl as any).statut, telephone: (cl as any).telephone, courriel: (cl as any).courriel, adresse: (cl as any).adresse },
          nb_projets: projets.length, solde_du: num(soldeDu), taches_ouvertes: taches.length,
          projets: projets.map((p) => ({ nom: p.nom, statut: p.statut, prix: num(p.prix_contrat || p.budget_estime || 0), marge: num(p.marge), marge_pct: num(p.marge_pct), a_recevoir: num((p.total_facture || 0) - (p.total_paye || 0)) })),
        };
      }
      case "projet_details": {
        const projets = await listerProjets();
        const q = String(input.nom || "").toLowerCase();
        const base = projets.find((p) => (p.nom || "").toLowerCase() === q) || projets.find((p) => (p.nom || "").toLowerCase().includes(q));
        if (!base || !base.id) return { trouve: false, message: `Aucun projet trouvé pour « ${input.nom} ».` };
        const p = await getProjet(base.id) || base;
        const [hr, factures, extrasAll] = await Promise.all([
          db().execute({ sql: "SELECT COALESCE(employe,'?') employe, COALESCE(SUM(heures),0) h, COALESCE(SUM(heures*taux_horaire),0) cout FROM heures_projet WHERE projet_id=? GROUP BY employe ORDER BY h DESC", args: [base.id] }).catch(() => ({ rows: [] })),
          listerFacturesProjet(base.id).catch(() => []),
          listerExtras().catch(() => []),
        ]);
        const extras = (extrasAll as any[]).filter((e) => e.projet_id === base.id);
        return {
          trouve: true,
          projet: { nom: p.nom, client: p.client_nom || null, statut: p.statut, date_fin_prevue: p.date_fin_prevue || null },
          revenu: { prix_contrat: num(p.prix_contrat || p.budget_estime || 0), extras_factures: num((p as any).extras_factures || 0), avant_taxes: num((p as any).revenu_avant_taxes || 0) },
          couts: { depenses: num(p.total_depenses), main_oeuvre: num(p.cout_main_oeuvre), total: num(p.cout_total) },
          marge: num(p.marge), marge_pct: num(p.marge_pct),
          facturation: { facture: num(p.total_facture), paye: num(p.total_paye), a_recevoir: num((p.total_facture || 0) - (p.total_paye || 0)) },
          heures_par_employe: (hr.rows as any[]).map((x) => ({ employe: x.employe, heures: num(x.h), cout: num(x.cout) })),
          nb_factures: (factures as any[]).length,
          extras: extras.map((e) => ({ nature: e.nature, description: e.description, montant: num(e.montant), statut: e.statut })),
        };
      }
      case "recherche": {
        const res = await rechercheGlobale(String(input.terme || ""));
        return { nombre: res.length, resultats: res.slice(0, 20) };
      }
      case "inventaire": {
        const conds: string[] = []; const args: any[] = [];
        if (input.recherche) { conds.push("(LOWER(nom) LIKE ? OR LOWER(categorie) LIKE ? OR LOWER(emplacement) LIKE ?)"); const l = `%${String(input.recherche).toLowerCase()}%`; args.push(l, l, l); }
        const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
        const r = await db().execute({ sql: `SELECT nom, categorie, quantite, unite, emplacement, cout_unit FROM inventaire ${where} ORDER BY nom ASC LIMIT 200`, args }).catch(() => ({ rows: [] }));
        const items = (r.rows as any[]).map((x) => ({ nom: x.nom, categorie: x.categorie, quantite: num(x.quantite), unite: x.unite, emplacement: x.emplacement, valeur: num((x.quantite || 0) * (x.cout_unit || 0)) }));
        return { nombre: items.length, valeur_totale: num(items.reduce((s, x) => s + x.valeur, 0)), items };
      }
      case "vehicules_assurances": {
        const [veh, ass] = await Promise.all([listerVehicules().catch(() => []), listerAssurances().catch(() => [])]);
        const dans60j = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
        const renouv = (ass as any[]).filter((a) => a.date_renouvellement && a.date_renouvellement <= dans60j);
        return {
          vehicules: (veh as any[]).map((v: any) => ({ nom: v.nom, marque: v.marque || null, annee: v.annee || null, plaque: v.plaque || null })),
          assurances: (ass as any[]).map((a) => ({ type: a.type, compagnie: a.compagnie, renouvellement: a.date_renouvellement, prime_annuelle: num(a.prime_annuelle) })),
          renouvellements_60j: renouv.map((a) => ({ type: a.type, compagnie: a.compagnie, date: a.date_renouvellement })),
        };
      }
      case "proposer_creer_tache":
        return { propose: true, action: { type: "creer_tache", params: {
          titre: input.titre, assigne_a: input.assigne_a || null, date_due: input.date_due || null,
          priorite: input.priorite ?? 3, recurrence: input.recurrence || null,
        }, resume: `Créer la tâche « ${input.titre} »${input.assigne_a ? ` pour ${input.assigne_a}` : ""}${input.date_due ? ` — échéance ${input.date_due}` : ""}${input.recurrence ? ` [🔁 ${input.recurrence}]` : ""}` } };
      case "proposer_completer_projet": {
        const projets = await listerProjets();
        const q = String(input.nom || "").toLowerCase();
        const p = projets.find((x) => (x.nom || "").toLowerCase() === q) || projets.find((x) => (x.nom || "").toLowerCase().includes(q));
        if (!p) return { propose: false, message: `Projet « ${input.nom} » introuvable.` };
        return { propose: true, action: { type: "completer_projet", params: { id: p.id, nom: p.nom }, resume: `Marquer « ${p.nom} » comme complété (et facturé)` } };
      }
      case "proposer_creer_depense": {
        let projet_id: number | null = null, projet_nom: string | null = null;
        if (input.projet_nom) {
          const projets = await listerProjets();
          const q = String(input.projet_nom).toLowerCase();
          const p = projets.find((x) => (x.nom || "").toLowerCase().includes(q));
          if (p) { projet_id = p.id!; projet_nom = p.nom; }
        }
        const date = input.date || new Date().toISOString().slice(0, 10);
        return { propose: true, action: { type: "creer_depense", params: {
          montant: num(input.montant), fournisseur: input.fournisseur || null, categorie: input.categorie || "matériaux",
          date, projet_id, description: input.description || null,
        }, resume: `Dépense de ${num(input.montant)} $${input.fournisseur ? ` chez ${input.fournisseur}` : ""}${projet_nom ? ` — projet ${projet_nom}` : ""}` } };
      }
      default:
        return { erreur: `Outil inconnu : ${nom}` };
    }
  } catch (e: any) {
    return { erreur: e?.message || "erreur d'exécution de l'outil" };
  }
}

// Module central des optimisations IA pour les soumissions Viking.
// 1. Sélection modèle (Haiku vs Sonnet par étape)
// 2. Règles métier Viking (toujours appliquées dans le prompt)
// 3. Recherche de projets similaires par cosine similarity
// 4. Few-shot examples chargés depuis l'historique
// 5. Cache prix web 7 jours

import { db } from "@/lib/db";

// === MODÈLES ===
// Hover/PDF parsing → Haiku (rapide, suffit pour extraire mesures)
// Stratégie + construction soumission → Sonnet (raisonnement complexe)
// Vision photos multi → Sonnet (vision avancée)
export const MODELES = {
  parse_hover: "claude-haiku-4-5",
  parse_pdf: "claude-haiku-4-5",
  vision_photos: "claude-sonnet-4-5",
  strategie: "claude-sonnet-4-5",
  construction: "claude-sonnet-4-5",
  chat_simple: "claude-haiku-4-5",
} as const;

// === RÈGLES MÉTIER VIKING ===
// Injectées dans tous les prompts auto-estimateur / construction.
// Mises à jour ici → effet immédiat partout.
export const REGLES_METIER_VIKING = `
=== RÈGLES MÉTIER VIKING — TOUJOURS APPLIQUER ===

GÉNÉRAL
- Marge plancher : 30 %. Si une soumission descend en-dessous, ajuster les coûts d'installation à la hausse.
- Frais fixes structurels : 15 % du revenu (admin, véhicules, RBQ, assurance, comptable) — déjà inclus dans le 30 %.
- Toujours inclure : démolition (0.8 h/100pi²), pose membrane pare-air (Tyvek/Typar), installation soffites et fascia neufs si rénovation totale.
- Toujours ajouter une ligne « Disposition des déchets / location conteneur » : forfait 350-600 $ selon volume.

MAJORATION MATÉRIAUX (sur prix coûtant brut)
- Maibec / cèdre véritable : +18 %
- Canexel / fibrociment Hardie : +22 %
- James Hardie planks : +22 %
- Vinyle / aluminium : +25 %
- Quincaillerie, vis, clous : +30 %
- Membrane, isolant : +20 %

MAIN-D'ŒUVRE (taux standard)
- Installation revêtement : 1.2 h / 100pi² (Maibec) · 1.5 h / 100pi² (Canexel/Hardie)
- Démolition : 0.8 h / 100pi²
- Coins / moulures : +0.3 h par coin
- Fenêtres/portes habillage : 1.5 h chacune
- Soffites/fascia : 0.6 h / pi linéaire
- Taux interne main-d'œuvre : 55 $/h coûtant (à facturer en fonction de la marge cible)

INCLUSIONS STANDARD (toujours dans une soumission complète)
1. Démolition + disposition
2. Membrane pare-air (Typar ou équivalent)
3. Tasseaux 1x3 si nécessaire (mur ventilé)
4. Revêtement choisi
5. Moulures, coins extérieurs et intérieurs
6. Habillage portes/fenêtres
7. Soffites + fascia (si applicable)
8. Calfeutrage haute qualité (OSI Quad Max)
9. Nettoyage du chantier

EXCLUSIONS À MENTIONNER
- Réparation de la charpente (sur estimation séparée)
- Isolation rigide extérieure (option)
- Peinture
- Réparation gypse intérieur autour des fenêtres

RBQ ET LÉGAL
- Toujours mentionner la licence RBQ 5811-4299-01.
- Période de validité de la soumission : 30 jours.
- Acompte standard à la signature : 30 % à la signature, 40 % à mi-projet, 30 % à la livraison.

STYLE DE COMMUNICATION
- Ton professionnel et précis, sans jargon technique excessif.
- Détailler chaque ligne avec quantité, unité, prix unitaire, sous-total.
- Toujours faire un sommaire avant le détail.
- Mentionner les marques exactes (Maibec « Statera » par exemple).
`.trim();

// === SCHÉMA JSON STRICT pour auto-estimateur ===
// Force Claude à retourner exactement cette structure (response_format strict).
export const SCHEMA_SOUMISSION = {
  type: "object",
  properties: {
    resume_strategie: { type: "string", description: "1-2 phrases : pourquoi ce choix de matériaux" },
    heures_totales_estimees: { type: "number" },
    articles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          categorie: { type: "string", enum: ["Démolition", "Préparation", "Matériaux", "Revêtement", "Moulures", "Main-d'œuvre", "Disposition", "Calfeutrage", "Autre"] },
          description: { type: "string" },
          quantite: { type: "number" },
          unite: { type: "string" },
          cout_unit: { type: "number", description: "Coût unitaire brut SANS majoration" },
          majoration_pct: { type: "number", description: "Ex: 22 pour 22%" },
          prix_unit_final: { type: "number", description: "cout_unit * (1 + majoration_pct/100)" },
          sous_total: { type: "number" },
        },
        required: ["categorie", "description", "quantite", "unite", "prix_unit_final", "sous_total"],
        additionalProperties: false,
      },
    },
    total_avant_taxes: { type: "number" },
    marge_pct_estimee: { type: "number", description: "Marge nette après 15% fixes" },
    inclusions: { type: "array", items: { type: "string" } },
    exclusions: { type: "array", items: { type: "string" } },
    notes_importantes: { type: "array", items: { type: "string" } },
  },
  required: ["resume_strategie", "heures_totales_estimees", "articles", "total_avant_taxes"],
  additionalProperties: false,
};

// === CACHE PRIX WEB 7 jours ===
const TTL_PRIX_MS = 7 * 24 * 60 * 60 * 1000;
const c: any = () => db();

export interface PrixCache { produit: string; prix_unit: number; unite: string; source?: string; note?: string }

export async function lirePrixCache(produit: string): Promise<PrixCache | null> {
  const cle = produit.toLowerCase().trim();
  const r = await c().execute({
    sql: "SELECT produit, prix_unit, unite, source, note FROM prix_cache_v2 WHERE cle = ? AND date_expire > ?",
    args: [cle, new Date().toISOString()],
  }).catch(() => ({ rows: [] }));
  return r.rows[0] || null;
}

export async function ecrirePrixCache(p: PrixCache): Promise<void> {
  const cle = p.produit.toLowerCase().trim();
  const expire = new Date(Date.now() + TTL_PRIX_MS).toISOString();
  await c().execute({
    sql: `INSERT INTO prix_cache_v2 (cle, produit, prix_unit, unite, source, note, date_creation, date_expire)
          VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(cle) DO UPDATE SET prix_unit=excluded.prix_unit, unite=excluded.unite, source=excluded.source, note=excluded.note, date_expire=excluded.date_expire`,
    args: [cle, p.produit, p.prix_unit, p.unite, p.source || null, p.note || null, new Date().toISOString(), expire],
  }).catch(() => {});
}

export async function nettoyerCacheExpire(): Promise<number> {
  const r = await c().execute({ sql: "DELETE FROM prix_cache_v2 WHERE date_expire < ?", args: [new Date().toISOString()] }).catch(() => ({ rowsAffected: 0 }));
  return r.rowsAffected || 0;
}

// === RECHERCHE PROJETS SIMILAIRES ===
// Cosine similarity bag-of-words sur (description + adresse + mots-clés matériaux).
// Filtre aussi sur surface ± 15 % si renseignée.

function tokenize(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const mots = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  for (const w of mots) m.set(w, (m.get(w) || 0) + 1);
  return m;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; if (b.has(k)) dot += v * b.get(k)!; }
  for (const v of b.values()) nb += v * v;
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

export interface ProjetSimilaire {
  numero: string;
  client_nom: string;
  date: string;
  total: number;
  similarity: number;
  payload_resume: string;
}

export async function trouverProjetsSimilaires(description: string, surfacePi2?: number, max = 3): Promise<ProjetSimilaire[]> {
  // Charger les 50 soumissions les plus récentes ACCEPTÉES
  const r = await c().execute({
    sql: "SELECT numero, client_nom, date_creation, total, payload_json FROM soumissions WHERE statut IN ('acceptee', 'facturee') ORDER BY date_creation DESC LIMIT 50",
    args: [],
  }).catch(() => ({ rows: [] }));
  if (r.rows.length === 0) return [];

  const tokensCible = tokenize(description);
  const candidats: ProjetSimilaire[] = [];
  for (const row of r.rows as any[]) {
    let payload: any = {};
    try { payload = JSON.parse(row.payload_json); } catch {}
    const projet = payload.client?.projet || payload.projet || "";
    const articles = (payload.articles || []).map((a: any) => `${a.description || ""} ${a.categorie || ""}`).join(" ");
    const blob = `${projet} ${row.client_nom || ""} ${articles}`;
    const sim = cosine(tokensCible, tokenize(blob));

    // Bonus si la surface match ± 15 %
    let bonus = 1;
    if (surfacePi2 && payload.surface_totale) {
      const ecart = Math.abs(surfacePi2 - payload.surface_totale) / surfacePi2;
      if (ecart < 0.15) bonus = 1.3;
      else if (ecart > 0.5) bonus = 0.7;
    }

    if (sim > 0.05) {
      candidats.push({
        numero: row.numero,
        client_nom: row.client_nom || "?",
        date: (row.date_creation || "").slice(0, 10),
        total: +row.total || 0,
        similarity: sim * bonus,
        payload_resume: articles.slice(0, 500),
      });
    }
  }
  return candidats.sort((a, b) => b.similarity - a.similarity).slice(0, max);
}

// === FEW-SHOT EXAMPLES depuis l'historique ===
// Retourne 2 soumissions acceptées récentes en format text → injectable dans le prompt système.
export async function fewShotExemples(maxExemples = 2): Promise<string> {
  const r = await c().execute({
    sql: "SELECT numero, client_nom, total, payload_json FROM soumissions WHERE statut IN ('acceptee', 'facturee') ORDER BY date_creation DESC LIMIT ?",
    args: [maxExemples],
  }).catch(() => ({ rows: [] }));

  if (r.rows.length === 0) return "";

  const blocs: string[] = [];
  for (const row of r.rows as any[]) {
    let p: any = {};
    try { p = JSON.parse(row.payload_json); } catch { continue; }
    const articles = (p.articles || []).slice(0, 10).map((a: any) => `   • ${a.description || a.nom} — ${a.quantite || "?"} ${a.unite || "u"} × ${(a.prix_unit_final || a.cout_unit || 0).toFixed(2)}$ = ${(a.sous_total || 0).toFixed(2)}$`).join("\n");
    blocs.push(`
--- EXEMPLE ACCEPTÉ (${row.numero}, ${row.client_nom || "?"}, total ${(+row.total).toFixed(0)}$) ---
Projet : ${p.client?.projet || p.projet || "—"}
Articles principaux :
${articles}
`.trim());
  }
  return blocs.join("\n\n");
}

// === FEEDBACK LOOP ===
// Compare l'output IA initial avec la version finale (sauvée par l'humain).
// Sauve le diff pour ré-injection dans le prompt mensuel.
export async function enregistrerFeedback(args: { numero: string; avant: any; apres: any; par?: string }): Promise<void> {
  const diff: any = { articles_modifies: [], articles_ajoutes: [], articles_supprimes: [], champs_modifies: {} };
  const avA = (args.avant?.articles || []).map((a: any) => `${a.description}|${a.quantite}|${a.prix_unit_final}`);
  const apA = (args.apres?.articles || []).map((a: any) => `${a.description}|${a.quantite}|${a.prix_unit_final}`);
  for (const a of apA) if (!avA.includes(a)) diff.articles_ajoutes.push(a);
  for (const a of avA) if (!apA.includes(a)) diff.articles_supprimes.push(a);
  if (args.avant?.total !== args.apres?.total) diff.champs_modifies.total = { avant: args.avant?.total, apres: args.apres?.total };

  await c().execute({
    sql: "INSERT INTO ia_feedback (soumission_numero, avant_json, apres_json, differences, par, date_creation) VALUES (?,?,?,?,?,?)",
    args: [args.numero, JSON.stringify(args.avant), JSON.stringify(args.apres), JSON.stringify(diff), args.par || null, new Date().toISOString()],
  }).catch(() => {});
}

/** Charge un résumé des corrections fréquentes (à injecter dans le prompt comme « erreurs à ne plus refaire »). */
export async function resumeFeedbackHistorique(): Promise<string> {
  const r = await c().execute({
    sql: "SELECT differences FROM ia_feedback ORDER BY date_creation DESC LIMIT 30",
    args: [],
  }).catch(() => ({ rows: [] }));
  if (r.rows.length === 0) return "";

  // Compte fréquences d'articles ajoutés (oubliés par l'IA) et supprimés (faux positifs)
  const ajoutes = new Map<string, number>();
  const supprimes = new Map<string, number>();
  for (const row of r.rows as any[]) {
    try {
      const d = JSON.parse(row.differences);
      for (const a of d.articles_ajoutes || []) {
        const desc = a.split("|")[0];
        ajoutes.set(desc, (ajoutes.get(desc) || 0) + 1);
      }
      for (const a of d.articles_supprimes || []) {
        const desc = a.split("|")[0];
        supprimes.set(desc, (supprimes.get(desc) || 0) + 1);
      }
    } catch {}
  }

  const oublis = Array.from(ajoutes.entries()).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const fauxPositifs = Array.from(supprimes.entries()).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!oublis.length && !fauxPositifs.length) return "";

  const lignes: string[] = ["=== CORRECTIONS APPRISES DES HUMAINS (historique 30 dernières soumissions) ==="];
  if (oublis.length) {
    lignes.push("\nNE PAS OUBLIER ces articles que Francis ajoute systématiquement :");
    for (const [d, n] of oublis) lignes.push(`  • ${d} (ajouté ${n}× après ta première version)`);
  }
  if (fauxPositifs.length) {
    lignes.push("\nNE PAS INCLURE ces articles que Francis retire systématiquement :");
    for (const [d, n] of fauxPositifs) lignes.push(`  • ${d} (retiré ${n}×)`);
  }
  return lignes.join("\n");
}

// Journal des coûts IA — tokens et coût estimé de CHAQUE appel au modèle.
import { db, initDb } from "@/lib/db";
import { aujourdhuiMontreal } from "@/lib/date";

// Tarifs USD par 1M de tokens, PAR MODÈLE. L'app en utilise trois niveaux (Haiku, Sonnet,
// Opus) : appliquer le tarif Opus à un appel Haiku surestimait la dépense de 5×, et
// l'inverse la sous-estimait d'autant.
// Convention Anthropic : écriture de cache = 1,25× l'entrée, lecture de cache = 0,1×.
type Tarif = { input: number; output: number; cacheWrite: number; cacheRead: number };
const tarif = (input: number, output: number): Tarif => ({ input, output, cacheWrite: input * 1.25, cacheRead: input * 0.1 });

const PRIX_PAR_MODELE: Record<string, Tarif> = {
  "claude-opus-4-8": tarif(5, 25),
  "claude-opus-4-7": tarif(5, 25),
  "claude-sonnet-4-5": tarif(3, 15),
  "claude-sonnet-4-6": tarif(3, 15),
  "claude-haiku-4-5": tarif(1, 5),
};
// Modèle inconnu : on prend le tarif le plus élevé, pour ne jamais sous-estimer la facture.
const PRIX_DEFAUT = tarif(5, 25);

function tarifDe(model?: string): Tarif {
  if (!model) return PRIX_DEFAUT;
  if (PRIX_PAR_MODELE[model]) return PRIX_PAR_MODELE[model];
  // Tolère les identifiants datés (« claude-haiku-4-5-20251001 »).
  const base = Object.keys(PRIX_PAR_MODELE).find((k) => model.startsWith(k));
  return base ? PRIX_PAR_MODELE[base] : PRIX_DEFAUT;
}

export interface UsageIA { input?: number; output?: number; cacheWrite?: number; cacheRead?: number; }

/** Coût USD d'un usage de tokens, au tarif du modèle appelé. */
export function coutUSD(u: UsageIA, model?: string): number {
  const p = tarifDe(model);
  const c =
    (u.input || 0) * p.input +
    (u.output || 0) * p.output +
    (u.cacheWrite || 0) * p.cacheWrite +
    (u.cacheRead || 0) * p.cacheRead;
  return c / 1_000_000;
}

/** Extrait l'usage d'une réponse de l'API (formes create() et stream()). */
export function usageDeReponse(resp: any): UsageIA {
  const u: any = resp?.usage || {};
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheWrite: u.cache_creation_input_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
  };
}

/** À appeler après CHAQUE appel au modèle. Best-effort : n'attend pas et n'échoue jamais,
 *  pour ne jamais retarder ni casser la réponse rendue à l'utilisateur. */
export function journaliserCoutReponse(outil: string, model: string, resp: any, user?: string | null): void {
  enregistrerCoutIA({ outil, model, usage: usageDeReponse(resp), user }).catch(() => {});
}

// La table est créée par doInitDb() (lib/db.ts), avec le reste du schéma : la recréer à
// chaque appel coûtait un aller-retour réseau supplémentaire par requête IA.
async function assurerTable(): Promise<void> {
  await initDb();
}

/** Enregistre un appel IA (best-effort — ne fait jamais échouer l'appel). Retourne le coût USD. */
export async function enregistrerCoutIA(p: { outil: string; model: string; usage: UsageIA; user?: string | null }): Promise<number> {
  const cout = coutUSD(p.usage, p.model);
  try {
    await assurerTable();
    await db().execute({
      sql: `INSERT INTO ia_couts (outil, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cout_usd, utilisateur, date)
            VALUES (?,?,?,?,?,?,?,?,?)`,
      args: [
        p.outil, p.model,
        p.usage.input || 0, p.usage.output || 0, p.usage.cacheWrite || 0, p.usage.cacheRead || 0,
        cout, p.user || null, new Date().toISOString(),
      ],
    });
  } catch { /* best-effort */ }
  return cout;
}

/** Total du mois courant (USD) + nombre d'appels. */
export async function coutMoisCourantIA(): Promise<{ mois: string; total_usd: number; nb: number }> {
  // Mois de MONTRÉAL (le 1er du mois à 21 h au Québec est encore « ce mois-ci »).
  const mois = aujourdhuiMontreal().slice(0, 7); // AAAA-MM
  try {
    await assurerTable();
    const r = await db().execute({
      sql: "SELECT COALESCE(SUM(cout_usd),0) t, COUNT(*) n FROM ia_couts WHERE date LIKE ?",
      args: [`${mois}%`],
    });
    return { mois, total_usd: Number((r.rows[0] as any)?.t) || 0, nb: Number((r.rows[0] as any)?.n) || 0 };
  } catch {
    return { mois, total_usd: 0, nb: 0 };
  }
}

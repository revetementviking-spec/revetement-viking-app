import { NextRequest, NextResponse } from "next/server";
import { db, initDb } from "@/lib/db";
import { utilisateurActif } from "@/lib/authUser";
import { nombreSaisi } from "@/lib/calculs";
import { journaliser } from "@/lib/audit";

const c: any = () => db();

// Colonnes SANS le blob photo : la liste envoyait la photo base64 de CHAQUE item à chaque
// ouverture de l'écran. `a_photo` remplace le blob ; la photo d'un item se lit par `?id=`.
// `?photos=1` garde l'ancien comportement (liste avec photo_data) pour l'écran actuel.
const COLS_LITES = "id, nom, categorie, quantite, unite, emplacement, photo_type, notes, cout_unit, date_creation, date_modif, (photo_data IS NOT NULL AND photo_data != '') AS a_photo";

/** Convertit en nombre les champs numériques fournis (virgule québécoise acceptée).
 *  Retourne un message d'erreur si une valeur fournie est illisible. */
function normaliserNombres(b: any): string | null {
  for (const k of ["quantite", "cout_unit"]) {
    if (b[k] === undefined) continue;
    if (b[k] === null || b[k] === "") { b[k] = k === "quantite" ? 0 : null; continue; }
    const n = nombreSaisi(b[k]);
    if (!Number.isFinite(n)) return `${k} invalide (ex. : 12,50)`;
    if (n < 0) return k === "quantite" ? "quantité invalide (doit être ≥ 0)" : `${k} invalide (doit être ≥ 0)`;
    b[k] = n;
  }
  return null;
}

export async function GET(req: NextRequest) {
  await initDb();
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  if (id) {
    const r = await c().execute({ sql: "SELECT * FROM inventaire WHERE id = ?", args: [+id] });
    if (!r.rows.length) return NextResponse.json({ error: "item introuvable" }, { status: 404 });
    return NextResponse.json(r.rows[0]);
  }
  const emplacement = sp.get("emplacement");
  const cols = sp.get("photos") === "1" ? "*" : COLS_LITES;
  const sql = emplacement
    ? `SELECT ${cols} FROM inventaire WHERE emplacement = ? ORDER BY nom`
    : `SELECT ${cols} FROM inventaire ORDER BY emplacement, nom`;
  const r = await c().execute({ sql, args: emplacement ? [emplacement] : [] });
  return NextResponse.json(r.rows);
}

export async function POST(req: NextRequest) {
  await initDb();
  const b = await req.json();
  if (!b.nom) return NextResponse.json({ error: "nom requis" }, { status: 400 });
  // `+b.quantite || 0` laissait passer une quantité négative (-5 || 0 === -5 en JS) :
  // on créait un item déjà en stock négatif. Même garde que sur les retraits.
  // Les nombres sont convertis AVANT l'écriture : « 12,50 » restait sinon du TEXTE en base.
  const invalide = normaliserNombres(b);
  if (invalide) return NextResponse.json({ error: invalide }, { status: 400 });
  const r = await c().execute({
    sql: "INSERT INTO inventaire (nom, categorie, quantite, unite, emplacement, photo_data, photo_type, notes, cout_unit, date_creation, date_modif) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    args: [b.nom, b.categorie || null, b.quantite ?? 0, b.unite || "u", b.emplacement || null, b.photo_data || null, b.photo_type || null, b.notes || null, b.cout_unit ?? null, new Date().toISOString(), new Date().toISOString()],
  });
  return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid) });
}

export async function PATCH(req: NextRequest) {
  await initDb();
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const now = new Date().toISOString();
  // Si on modifie la quantité, journaliser le mouvement
  if (typeof b.delta === "number" && b.delta !== 0) {
    const par = (await utilisateurActif(req)) || "?";
    // Garde stock ATOMIQUE : la condition est dans le WHERE, donc deux retraits simultanés
    // ne peuvent pas passer tous les deux (un « SELECT puis compare puis UPDATE » laissait
    // filer le stock en négatif quand deux personnes retiraient en même temps).
    // UPDATE + mouvement dans UNE transaction : avant, une panne entre les deux laissait
    // un stock modifié sans trace, et un mouvement sans stock était impossible à démêler.
    const res = await c().batch([
      {
        sql: "UPDATE inventaire SET quantite = quantite + ?, date_modif = ? WHERE id = ? AND quantite + ? >= 0",
        args: [b.delta, now, b.id, b.delta],
      },
      {
        // Le mouvement n'est écrit QUE si l'UPDATE a touché la ligne (changes() = 1).
        sql: "INSERT INTO inventaire_mouvements (inventaire_id, delta, type, note, par, date_creation) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1",
        args: [b.id, b.delta, b.delta > 0 ? "entree" : "sortie", b.note || null, par, now],
      },
    ], "write");
    if (!res[0].rowsAffected) {
      const cur = await c().execute({ sql: "SELECT quantite FROM inventaire WHERE id = ?", args: [b.id] });
      if (!cur.rows.length) return NextResponse.json({ error: "item introuvable" }, { status: 404 });
      const q = Number((cur.rows[0] as any)?.quantite || 0);
      return NextResponse.json({ error: `Stock insuffisant : ${q} en inventaire, retrait de ${-b.delta} demandé.` }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }
  // Sinon, mise à jour des champs. La quantité saisie ici contourne le chemin `delta`
  // (et sa journalisation), mais elle ne doit pas davantage pouvoir devenir négative.
  const invalide = normaliserNombres(b);
  if (invalide) return NextResponse.json({ error: invalide }, { status: 400 });

  // VERROU OPTIMISTE sur la quantité. Le modal « Modifier » renvoie toujours `quantite`,
  // même si l'utilisateur n'a touché qu'au nom : sans ce garde, ouvrir la fiche puis
  // enregistrer écrasait en silence un retrait fait entre-temps par quelqu'un d'autre,
  // et sans laisser la moindre ligne dans inventaire_mouvements.
  // `!= null` et non `!== undefined` : un `quantite_connue: null` sérialisé ne doit pas
  // devenir 0 et déclencher un faux conflit.
  const verrouActif = b.quantite !== undefined && b.quantite_connue != null;
  let avant: number | null = null;
  if (b.quantite !== undefined) {
    const cur = await c().execute({ sql: "SELECT quantite FROM inventaire WHERE id = ?", args: [b.id] });
    if (!cur.rows.length) return NextResponse.json({ error: "item introuvable" }, { status: 404 });
    avant = Number((cur.rows[0] as any).quantite || 0);
  }

  const champs = ["nom", "categorie", "quantite", "unite", "emplacement", "photo_data", "photo_type", "notes", "cout_unit"];
  const sets: string[] = [], args: any[] = [];
  for (const k of champs) if (b[k] !== undefined) { sets.push(`${k} = ?`); args.push(b[k]); }
  if (!sets.length) return NextResponse.json({ error: "rien a modifier" }, { status: 400 });
  sets.push("date_modif = ?"); args.push(now);
  args.push(b.id);
  // Le témoin est vérifié DANS le WHERE : deux fiches ouvertes en parallèle ne peuvent pas
  // enregistrer toutes les deux, contrairement à une comparaison faite en mémoire.
  let sql = `UPDATE inventaire SET ${sets.join(", ")} WHERE id = ?`;
  if (verrouActif) { sql += " AND quantite = ?"; args.push(Number(b.quantite_connue)); }
  const ajustement = (avant != null && Number(b.quantite) !== avant) ? { avant, apres: Number(b.quantite) } : null;
  const par = ajustement ? (await utilisateurActif(req)) || "?" : null;

  // UPDATE + mouvement d'ajustement dans UNE transaction. Un changement de quantité par
  // l'écran d'édition laisse une trace, au même titre qu'une entrée/sortie — sinon un saut
  // de stock restait inexplicable. L'ancien `.catch(() => {})` sur le mouvement le rendait
  // muet : maintenant un échec fait échouer la requête et est journalisé.
  const enonces: { sql: string; args: any[] }[] = [{ sql, args }];
  if (ajustement) {
    enonces.push({
      sql: "INSERT INTO inventaire_mouvements (inventaire_id, delta, type, note, par, date_creation) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1",
      args: [b.id, ajustement.apres - ajustement.avant, "ajustement",
             `Correction par la fiche : ${ajustement.avant} → ${ajustement.apres}`, par, now],
    });
  }
  let res: any[];
  try {
    res = await c().batch(enonces, "write");
  } catch (e: any) {
    console.error("[/api/inventaire PATCH]", e);
    return NextResponse.json({ error: "Modification refusée par la base — rien n'a été enregistré." }, { status: 500 });
  }
  if (verrouActif && !res[0].rowsAffected) {
    const cur = await c().execute({ sql: "SELECT quantite FROM inventaire WHERE id = ?", args: [b.id] });
    const actuelle = Number((cur.rows[0] as any)?.quantite ?? 0);
    return NextResponse.json({
      error: `La quantité a changé pendant que tu modifiais la fiche : elle est passée de ${b.quantite_connue} à ${actuelle}. Rouvre la fiche pour repartir de la bonne valeur.`,
      conflit: true, quantite_actuelle: actuelle,
    }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await initDb();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const user = await utilisateurActif(req);
  const cur = await c().execute({ sql: "SELECT id, nom, quantite, unite, emplacement, cout_unit FROM inventaire WHERE id = ?", args: [+id] });
  const avant = (cur.rows[0] as any) || null;
  // Item + ses mouvements dans UNE transaction (avant : deux requêtes séparées).
  await c().batch([
    { sql: "DELETE FROM inventaire_mouvements WHERE inventaire_id = ?", args: [+id] },
    { sql: "DELETE FROM inventaire WHERE id = ?", args: [+id] },
  ], "write");
  journaliser("inventaire.supprime", {
    ref_type: "inventaire", ref_id: id, utilisateur: user || undefined,
    description: avant ? `${avant.nom} · ${avant.quantite} ${avant.unite || "u"} · ${avant.emplacement || "—"}` : `Item #${id}`,
    avant,
  });
  return NextResponse.json({ ok: true });
}

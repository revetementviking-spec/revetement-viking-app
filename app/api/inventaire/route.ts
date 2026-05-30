import { NextRequest, NextResponse } from "next/server";
import { db, initDb } from "@/lib/db";
import { utilisateurActif } from "@/lib/authUser";

const c: any = () => db();

export async function GET(req: NextRequest) {
  await initDb();
  const emplacement = req.nextUrl.searchParams.get("emplacement");
  const sql = emplacement
    ? "SELECT * FROM inventaire WHERE emplacement = ? ORDER BY nom"
    : "SELECT * FROM inventaire ORDER BY emplacement, nom";
  const r = await c().execute({ sql, args: emplacement ? [emplacement] : [] });
  return NextResponse.json(r.rows);
}

export async function POST(req: NextRequest) {
  await initDb();
  const b = await req.json();
  if (!b.nom) return NextResponse.json({ error: "nom requis" }, { status: 400 });
  const r = await c().execute({
    sql: "INSERT INTO inventaire (nom, categorie, quantite, unite, emplacement, photo_data, photo_type, notes, cout_unit, date_creation, date_modif) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    args: [b.nom, b.categorie || null, +b.quantite || 0, b.unite || "u", b.emplacement || null, b.photo_data || null, b.photo_type || null, b.notes || null, b.cout_unit ? +b.cout_unit : null, new Date().toISOString(), new Date().toISOString()],
  });
  return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid) });
}

export async function PATCH(req: NextRequest) {
  await initDb();
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  // Si on modifie la quantité, journaliser le mouvement
  if (typeof b.delta === "number" && b.delta !== 0) {
    const par = (await utilisateurActif(req)) || "?";
    await c().execute({ sql: "UPDATE inventaire SET quantite = quantite + ?, date_modif = ? WHERE id = ?", args: [b.delta, new Date().toISOString(), b.id] });
    await c().execute({
      sql: "INSERT INTO inventaire_mouvements (inventaire_id, delta, type, note, par, date_creation) VALUES (?,?,?,?,?,?)",
      args: [b.id, b.delta, b.delta > 0 ? "entree" : "sortie", b.note || null, par, new Date().toISOString()],
    });
    return NextResponse.json({ ok: true });
  }
  // Sinon, mise à jour des champs
  const champs = ["nom", "categorie", "quantite", "unite", "emplacement", "photo_data", "photo_type", "notes", "cout_unit"];
  const sets: string[] = [], args: any[] = [];
  for (const k of champs) if (b[k] !== undefined) { sets.push(`${k} = ?`); args.push(b[k]); }
  if (!sets.length) return NextResponse.json({ error: "rien a modifier" }, { status: 400 });
  sets.push("date_modif = ?"); args.push(new Date().toISOString());
  args.push(b.id);
  await c().execute({ sql: `UPDATE inventaire SET ${sets.join(", ")} WHERE id = ?`, args });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await initDb();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await c().execute({ sql: "DELETE FROM inventaire_mouvements WHERE inventaire_id = ?", args: [+id] });
  await c().execute({ sql: "DELETE FROM inventaire WHERE id = ?", args: [+id] });
  return NextResponse.json({ ok: true });
}

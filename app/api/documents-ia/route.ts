import { NextRequest, NextResponse } from "next/server";
import { db, initDb } from "@/lib/db";
import { utilisateurActif } from "@/lib/authUser";

const c: any = () => db();

export async function GET(req: NextRequest) {
  await initDb();
  // Liste : NE PAS retourner data_b64 (lourd) — juste les métadonnées
  const r = await c().execute({
    sql: "SELECT id, nom, type_mime, taille, contenu_texte IS NOT NULL AS a_texte, tags, actif, par, date_creation FROM documents_ia ORDER BY date_creation DESC",
    args: [],
  });
  return NextResponse.json(r.rows);
}

export async function POST(req: NextRequest) {
  await initDb();
  const b = await req.json();
  if (!b.nom || !b.data_b64) return NextResponse.json({ error: "nom + data_b64 requis" }, { status: 400 });
  const par = (await utilisateurActif(req)) || "?";
  const r = await c().execute({
    sql: "INSERT INTO documents_ia (nom, type_mime, taille, data_b64, contenu_texte, tags, actif, par, date_creation) VALUES (?,?,?,?,?,?,?,?,?)",
    args: [b.nom, b.type_mime || "application/octet-stream", b.taille || 0, b.data_b64, b.contenu_texte || null, b.tags || null, 1, par, new Date().toISOString()],
  });
  return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid) });
}

export async function PATCH(req: NextRequest) {
  await initDb();
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const sets: string[] = [], args: any[] = [];
  for (const k of ["nom", "tags", "actif", "contenu_texte"]) if (b[k] !== undefined) { sets.push(`${k} = ?`); args.push(b[k]); }
  if (!sets.length) return NextResponse.json({ error: "rien" }, { status: 400 });
  args.push(b.id);
  await c().execute({ sql: `UPDATE documents_ia SET ${sets.join(", ")} WHERE id = ?`, args });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await initDb();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await c().execute({ sql: "DELETE FROM documents_ia WHERE id = ?", args: [+id] });
  return NextResponse.json({ ok: true });
}

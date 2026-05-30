import { NextRequest, NextResponse } from "next/server";
import { db, initDb } from "@/lib/db";

const c: any = () => db();

export async function GET() {
  await initDb();
  const r = await c().execute({ sql: "SELECT * FROM cameras WHERE actif = 1 ORDER BY ordre, id", args: [] });
  return NextResponse.json(r.rows);
}

export async function POST(req: NextRequest) {
  await initDb();
  const b = await req.json();
  if (!b.nom) return NextResponse.json({ error: "nom requis" }, { status: 400 });
  const r = await c().execute({
    sql: "INSERT INTO cameras (nom, emplacement, url_embed, type, actif, ordre, date_creation) VALUES (?,?,?,?,?,?,?)",
    args: [b.nom, b.emplacement || null, b.url_embed || null, b.type || "iframe", 1, b.ordre || 0, new Date().toISOString()],
  });
  return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid) });
}

export async function PATCH(req: NextRequest) {
  await initDb();
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const sets: string[] = [], args: any[] = [];
  for (const k of ["nom", "emplacement", "url_embed", "type", "actif", "ordre"]) if (b[k] !== undefined) { sets.push(`${k} = ?`); args.push(b[k]); }
  if (!sets.length) return NextResponse.json({ error: "rien" }, { status: 400 });
  args.push(b.id);
  await c().execute({ sql: `UPDATE cameras SET ${sets.join(", ")} WHERE id = ?`, args });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await initDb();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await c().execute({ sql: "DELETE FROM cameras WHERE id = ?", args: [+id] });
  return NextResponse.json({ ok: true });
}

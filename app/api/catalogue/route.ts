import { NextRequest, NextResponse } from "next/server";
import { db, initDb } from "@/lib/db";

const c: any = () => db();

function calculerPrixVente(coutant: number | null, majPct: number | null): number | null {
  if (coutant == null || coutant <= 0) return null;
  const m = majPct == null ? 20 : majPct;
  return Math.round(coutant * (1 + m / 100) * 100) / 100;
}

export async function GET(req: NextRequest) {
  await initDb();
  const type = req.nextUrl.searchParams.get("type");
  const fournisseur = req.nextUrl.searchParams.get("fournisseur");
  const q = (req.nextUrl.searchParams.get("q") || "").trim().toLowerCase();

  let sql = "SELECT * FROM catalogue_materiaux WHERE actif = 1";
  const args: any[] = [];
  if (type) { sql += " AND type = ?"; args.push(type); }
  if (fournisseur) { sql += " AND fournisseur = ?"; args.push(fournisseur); }
  sql += " ORDER BY type, fournisseur, nom";
  const r = await c().execute({ sql, args });
  let rows = r.rows;
  if (q) rows = (rows as any[]).filter((m) => `${m.nom} ${m.type} ${m.fournisseur} ${m.notes || ""}`.toLowerCase().includes(q));
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  await initDb();
  const b = await req.json();
  if (!b.nom || !b.unite) return NextResponse.json({ error: "nom + unite requis" }, { status: 400 });
  const prix_vente = b.prix_vente != null ? +b.prix_vente : calculerPrixVente(b.prix_coutant ?? null, b.majoration_pct ?? null);
  const r = await c().execute({
    sql: `INSERT INTO catalogue_materiaux
          (nom, type, fournisseur, unite, format_paquet, format_paquet_label, prix_coutant, majoration_pct, prix_vente, notes, actif, date_creation, date_modif)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      b.nom, b.type || null, b.fournisseur || null, b.unite,
      b.format_paquet ? +b.format_paquet : null,
      b.format_paquet_label || null,
      b.prix_coutant != null ? +b.prix_coutant : null,
      b.majoration_pct != null ? +b.majoration_pct : 20,
      prix_vente,
      b.notes || null,
      b.actif === 0 ? 0 : 1,
      new Date().toISOString(), new Date().toISOString(),
    ],
  });
  return NextResponse.json({ ok: true, id: Number(r.lastInsertRowid) });
}

export async function PATCH(req: NextRequest) {
  await initDb();
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  // Recalcul prix_vente si coutant ou majoration change
  if (b.prix_coutant != null || b.majoration_pct != null) {
    if (b.prix_vente == null) {
      // Lire l'existant pour combiner
      const cur = await c().execute({ sql: "SELECT prix_coutant, majoration_pct FROM catalogue_materiaux WHERE id = ?", args: [b.id] });
      const old = cur.rows[0] as any;
      const cout = b.prix_coutant ?? old?.prix_coutant;
      const maj = b.majoration_pct ?? old?.majoration_pct;
      b.prix_vente = calculerPrixVente(cout, maj);
    }
  }
  const champs = ["nom", "type", "fournisseur", "unite", "format_paquet", "format_paquet_label", "prix_coutant", "majoration_pct", "prix_vente", "notes", "actif"];
  const sets: string[] = [], args: any[] = [];
  for (const k of champs) if (b[k] !== undefined) { sets.push(`${k} = ?`); args.push(b[k]); }
  if (!sets.length) return NextResponse.json({ error: "rien a modifier" }, { status: 400 });
  sets.push("date_modif = ?"); args.push(new Date().toISOString());
  args.push(b.id);
  await c().execute({ sql: `UPDATE catalogue_materiaux SET ${sets.join(", ")} WHERE id = ?`, args });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  await initDb();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  // Soft delete : on désactive plutôt que supprimer (pour préserver l'historique des soumissions)
  await c().execute({ sql: "UPDATE catalogue_materiaux SET actif = 0, date_modif = ? WHERE id = ?", args: [new Date().toISOString(), +id] });
  return NextResponse.json({ ok: true });
}

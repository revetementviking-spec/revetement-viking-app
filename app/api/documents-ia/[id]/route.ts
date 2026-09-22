import { NextRequest, NextResponse } from "next/server";
import { db, initDb } from "@/lib/db";
import { reponseFichier } from "@/lib/fichier-http";

const c: any = () => db();

/** GET /api/documents-ia/[id] — télécharge le binaire complet (data_b64 décodé). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await initDb();
  const { id } = await params;
  const r = await c().execute({ sql: "SELECT nom, type_mime, data_b64 FROM documents_ia WHERE id = ?", args: [+id] });
  const row = r.rows[0] as any;
  if (!row) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  // data_b64 peut être un data URL "data:application/pdf;base64,XYZ" ou juste le base64 brut.
  // NULL (document enregistré sans contenu) : 404 propre au lieu d'un `startsWith` qui lève.
  if (typeof row.data_b64 !== "string" || !row.data_b64) return NextResponse.json({ error: "document sans contenu" }, { status: 404 });
  let b64: string = row.data_b64;
  let type: string = row.type_mime || "application/octet-stream";
  if (b64.startsWith("data:")) {
    const m = b64.match(/^data:([^;,]*)(?:;[^,]*)?,(.*)$/);
    if (!m) return NextResponse.json({ error: "document illisible" }, { status: 500 });
    type = m[1] || type;
    b64 = m[2];
  }
  const buf = Buffer.from(b64, "base64");
  // Liste blanche des types rendus inline + nosniff (règle commune de lib/fichier-http.ts).
  return reponseFichier(buf, { type, nom: String(row.nom || "document"), cacheSecondes: 300 });
}

import { NextRequest, NextResponse } from "next/server";
import { db, initDb } from "@/lib/db";

const c: any = () => db();

/** GET /api/documents-ia/[id] — télécharge le binaire complet (data_b64 décodé). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await initDb();
  const { id } = await params;
  const r = await c().execute({ sql: "SELECT nom, type_mime, data_b64 FROM documents_ia WHERE id = ?", args: [+id] });
  const row = r.rows[0] as any;
  if (!row) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  // data_b64 peut être un data URL "data:application/pdf;base64,XYZ" ou juste le base64 brut
  let b64 = row.data_b64;
  if (b64.startsWith("data:")) b64 = b64.split(",")[1];
  const buf = Buffer.from(b64, "base64");
  return new NextResponse(buf as any, {
    headers: {
      "Content-Type": row.type_mime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(row.nom)}"`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

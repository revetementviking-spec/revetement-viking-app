// Sert le contrat signé d'un projet en binaire (PDF/image).
import { NextRequest, NextResponse } from "next/server";
import { db, initDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await initDb();
  const { id } = await ctx.params;
  // Requête directe : getProjet() ne renvoie PAS le blob contrat_signe_data (par perf).
  const c: any = db();
  const r = await c.execute({
    sql: "SELECT contrat_signe_data, contrat_signe_type FROM projets WHERE id = ?",
    args: [+id],
  });
  const row = r.rows[0] as any;
  if (!row || !row.contrat_signe_data) return new NextResponse("Not found", { status: 404 });
  const data = String(row.contrat_signe_data);
  const m = data.match(/^data:([^;]+);base64,(.+)$/);
  let mime: string;
  let buf: Buffer;
  if (m) {
    mime = m[1] || row.contrat_signe_type || "application/octet-stream";
    buf = Buffer.from(m[2], "base64");
  } else {
    mime = row.contrat_signe_type || "application/octet-stream";
    buf = Buffer.from(data, "base64");
  }
  const ext = (mime.split("/")[1] || "bin").split("+")[0];
  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="contrat-signe-projet-${id}.${ext}"`,
    },
  });
}

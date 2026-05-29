// Sert la facture finale d'un projet en binaire (PDF/image) — évite le popup bloqué sur mobile.
import { NextRequest, NextResponse } from "next/server";
import { getProjet } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = await getProjet(+id);
  if (!p || !(p as any).facture_finale_data) return new NextResponse("Not found", { status: 404 });
  const data = (p as any).facture_finale_data as string;
  const m = String(data).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return new NextResponse("Invalid", { status: 500 });
  const mime = m[1] || (p as any).facture_finale_type || "application/octet-stream";
  const buf = Buffer.from(m[2], "base64");
  const ext = (mime.split("/")[1] || "bin").split("+")[0];
  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="facture-projet-${id}.${ext}"`,
    },
  });
}

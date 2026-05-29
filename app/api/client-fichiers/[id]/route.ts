import { NextRequest, NextResponse } from "next/server";
import { getFichierClient } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const f = await getFichierClient(+id);
  if (!f || !f.data) return new NextResponse("Not found", { status: 404 });
  const m = String(f.data).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return new NextResponse("Invalid data", { status: 500 });
  const buf = Buffer.from(m[2], "base64");
  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      "Content-Type": m[1],
      "Content-Length": String(buf.length),
      "Cache-Control": "public, max-age=2592000, immutable",
      "Content-Disposition": `inline; filename="${(f.nom || "fichier").replace(/[^a-z0-9._-]/gi, "_")}"`,
    },
  });
}

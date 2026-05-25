// Sert la photo binaire directement avec cache HTTP agressif
// → 10-100x plus rapide qu'envoyer du base64 dans du JSON
import { NextRequest, NextResponse } from "next/server";
import { getPhotoChantier } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const photo = await getPhotoChantier(+id);
  if (!photo || !photo.photo_data) {
    return new NextResponse("Not found", { status: 404 });
  }
  const m = String(photo.photo_data).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return new NextResponse("Invalid data", { status: 500 });
  const mime = m[1];
  const buf = Buffer.from(m[2], "base64");
  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.length),
      // Cache 30 jours, immutable car les photos ne sont jamais modifiées (id == content)
      "Cache-Control": "public, max-age=2592000, immutable",
      "Content-Disposition": `inline; filename="photo-${id}.${mime.split("/")[1] || "bin"}"`,
    },
  });
}

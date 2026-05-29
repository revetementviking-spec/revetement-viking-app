// Sert la photo binaire directement avec cache HTTP agressif.
// ?thumb=1 → sert la vignette (~15ko) pour les grilles ; sinon le plein format.
import { NextRequest, NextResponse } from "next/server";
import { getVignettePhoto } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const veutThumb = req.nextUrl.searchParams.get("thumb") === "1";
  const photo = await getVignettePhoto(+id);
  if (!photo) return new NextResponse("Not found", { status: 404 });
  // Vignette demandée et dispo → sert la vignette ; sinon fallback plein format
  const source = veutThumb && photo.thumb_data ? photo.thumb_data : photo.photo_data;
  if (!source) return new NextResponse("Not found", { status: 404 });
  const m = String(source).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return new NextResponse("Invalid data", { status: 500 });
  const mime = m[1];
  const buf = Buffer.from(m[2], "base64");
  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(buf.length),
      "Cache-Control": "public, max-age=2592000, immutable",
      "Content-Disposition": `inline; filename="photo-${id}${veutThumb ? "-thumb" : ""}.${mime.split("/")[1] || "bin"}"`,
    },
  });
}

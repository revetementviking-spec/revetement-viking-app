import { NextRequest, NextResponse } from "next/server";
import { getExtraPhoto } from "@/lib/db";
import { reponseFichier, extensionDe } from "@/lib/fichier-http";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const x = await getExtraPhoto(+id);
  const source = x?.thumb_data || x?.photo_data;
  if (!source) return new NextResponse("Not found", { status: 404 });
  const m = String(source).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return new NextResponse("Invalid data", { status: 500 });
  const mime = m[1];
  const buf = Buffer.from(m[2], "base64");
  // `private` (derrière l'authentification) et type déclaré au dépôt filtré par la liste
  // blanche de lib/fichier-http.ts — jamais de HTML/SVG rendu sur l'origine de l'app.
  return reponseFichier(buf, { type: mime, nom: `extra-${+id || 0}.${extensionDe(mime)}`, cacheSecondes: 2592000 });
}

import { NextRequest, NextResponse } from "next/server";
import { getPhotoBiblio } from "@/lib/db";
import { reponseFichier, extensionDe } from "@/lib/fichier-http";

export const dynamic = "force-dynamic";

/** Sert une photo de la bibliothèque de jobs (stockée en base). Route authentifiée :
 *  elle n'est pas dans l'allowlist publique de proxy.ts. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const p = await getPhotoBiblio(+id);
  if (!p?.data) return new NextResponse("Not found", { status: 404 });
  const m = String(p.data).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return new NextResponse("Invalid image", { status: 500 });
  const mime = m[1] || p.type || "image/jpeg";
  const buf = Buffer.from(m[2], "base64");
  // Immuable côté client (une photo ne change jamais), mais le type déclaré au dépôt
  // passe par la liste blanche de lib/fichier-http.ts (jamais de HTML/SVG inline).
  return reponseFichier(buf, { type: mime, nom: `biblio-${+id || 0}.${extensionDe(mime)}`, cacheSecondes: 31536000 });
}

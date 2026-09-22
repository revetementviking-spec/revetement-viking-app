// Sert le devis joint au contrat, au client, depuis le lien public de signature.
// Route séparée du GET du contrat : le fichier fait souvent plusieurs Mo et n'a aucune
// raison d'être renvoyé en base64 à chaque affichage de la page.
import { NextRequest, NextResponse } from "next/server";
import { getContratPipelineBlobs } from "@/lib/db";

export const dynamic = "force-dynamic";

// Types servis en ligne. Tout le reste est forcé en téléchargement : on ne laisse pas le
// navigateur interpréter un fichier arbitraire dans le contexte du site.
const TYPES_AFFICHABLES = new Set([
  "application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif",
]);

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  // Le jeton EST l'autorisation : même barrière que pour le contrat lui-même.
  // Lecture des blobs seulement (cette route sert le fichier, pas les métadonnées).
  const c = await getContratPipelineBlobs(token);
  if (!c || !c.annexe_data) return NextResponse.json({ error: "aucune annexe" }, { status: 404 });

  const dataUrl: string = c.annexe_data;
  // `[\s\S]` plutôt que le drapeau `s` : la cible de compilation du projet ne l'accepte pas.
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return NextResponse.json({ error: "annexe illisible" }, { status: 500 });
  const type = c.annexe_type || m[1] || "application/octet-stream";
  const buf = Buffer.from(m[2], "base64");

  const affichable = TYPES_AFFICHABLES.has(type);
  const nom = (c.annexe_nom || "devis").replace(/[^\w.\-() ]+/g, "_").slice(0, 120);

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": affichable ? type : "application/octet-stream",
      "Content-Disposition": `${affichable ? "inline" : "attachment"}; filename="${nom}"`,
      "Content-Length": String(buf.length),
      // Pièce d'un dossier contractuel : jamais mise en cache par un intermédiaire.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

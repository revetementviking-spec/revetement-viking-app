import { NextRequest, NextResponse } from "next/server";
import { genererTokenProjet } from "@/lib/lien-public";

/** Génère l'URL publique signée pour partager un projet avec un client. */
export async function GET(req: NextRequest) {
  const id = +(req.nextUrl.searchParams.get("id") || 0);
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const token = await genererTokenProjet(id);
  const base = req.nextUrl.origin;
  return NextResponse.json({ url: `${base}/projet/${id}?t=${token}` });
}

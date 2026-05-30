import { NextRequest, NextResponse } from "next/server";
import { enregistrerFeedback, resumeFeedbackHistorique } from "@/lib/viking-ai";
import { utilisateurActif } from "@/lib/authUser";

/** POST : enregistre le diff entre version IA initiale et version humaine finale.
 *  GET : retourne le résumé des corrections apprises (debug). */
export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.numero || !b.avant || !b.apres) return NextResponse.json({ error: "numero, avant, apres requis" }, { status: 400 });
  const par = (await utilisateurActif(req)) || "?";
  await enregistrerFeedback({ numero: b.numero, avant: b.avant, apres: b.apres, par });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const r = await resumeFeedbackHistorique();
  return NextResponse.json({ resume: r });
}

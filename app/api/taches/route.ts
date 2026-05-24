import { NextRequest, NextResponse } from "next/server";
import { listerTaches, ajouterTache, modifierTache, supprimerTache } from "@/lib/db";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filtres: any = {};
  if (sp.get("statut")) filtres.statut = sp.get("statut");
  if (sp.get("client_id")) filtres.client_id = +sp.get("client_id")!;
  if (sp.get("projet_id")) filtres.projet_id = +sp.get("projet_id")!;
  return NextResponse.json(await listerTaches(filtres));
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.titre) return NextResponse.json({ error: "titre requis" }, { status: 400 });
  const id = await ajouterTache(b);
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  if (b.statut === "complete" && !b.date_completion) b.date_completion = new Date().toISOString().slice(0, 10);
  await modifierTache(+b.id, b);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await supprimerTache(+id);
  return NextResponse.json({ ok: true });
}

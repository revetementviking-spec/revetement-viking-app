import { NextRequest, NextResponse } from "next/server";
import { listerEmployes, ajouterEmploye, modifierEmploye, supprimerEmploye } from "@/lib/db";

export async function GET() {
  return NextResponse.json(await listerEmployes());
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.nom?.trim() || !b.taux_horaire) {
    return NextResponse.json({ error: "nom et taux_horaire requis" }, { status: 400 });
  }
  const id = await ajouterEmploye({ nom: b.nom.trim(), taux_horaire: +b.taux_horaire, das_pct: b.das_pct ?? 0.15 });
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await modifierEmploye(+b.id, b);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await supprimerEmploye(+id);
  return NextResponse.json({ ok: true });
}

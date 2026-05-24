import { NextRequest, NextResponse } from "next/server";
import { listerOutils, ajouterOutil, modifierOutil, supprimerOutil, getOutil } from "@/lib/db";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) return NextResponse.json(await getOutil(+id));
  return NextResponse.json(await listerOutils());
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.nom?.trim()) return NextResponse.json({ error: "nom requis" }, { status: 400 });
  const id = await ajouterOutil(b);
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await modifierOutil(+b.id, b);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await supprimerOutil(+id);
  return NextResponse.json({ ok: true });
}

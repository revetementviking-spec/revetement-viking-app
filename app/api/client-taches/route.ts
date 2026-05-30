import { NextRequest, NextResponse } from "next/server";
import { listerTachesClient, ajouterTacheClient, modifierTacheClient, supprimerTacheClient } from "@/lib/db";

export async function GET(req: NextRequest) {
  const cid = req.nextUrl.searchParams.get("client_id");
  if (!cid) return NextResponse.json({ error: "client_id requis" }, { status: 400 });
  return NextResponse.json(await listerTachesClient(+cid));
}
export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.client_id || !b.titre) return NextResponse.json({ error: "client_id et titre requis" }, { status: 400 });
  const id = await ajouterTacheClient(+b.client_id, b.titre, b.assignee, b.date_echeance);
  return NextResponse.json({ ok: true, id });
}
export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await modifierTacheClient(+b.id, { titre: b.titre, complete: typeof b.complete === "boolean" ? b.complete : undefined, assignee: b.assignee, date_echeance: b.date_echeance });
  return NextResponse.json({ ok: true });
}
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await supprimerTacheClient(+id);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { listerInteractions, ajouterInteraction, supprimerInteraction } from "@/lib/db";

export async function GET(req: NextRequest) {
  const client_id = req.nextUrl.searchParams.get("client_id");
  if (!client_id) return NextResponse.json({ error: "client_id requis" }, { status: 400 });
  return NextResponse.json(await listerInteractions(+client_id));
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.client_id || !b.type || !b.date) return NextResponse.json({ error: "client_id, type, date requis" }, { status: 400 });
  const id = await ajouterInteraction(b);
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await supprimerInteraction(+id);
  return NextResponse.json({ ok: true });
}

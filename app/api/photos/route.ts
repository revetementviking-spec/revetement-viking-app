import { NextRequest, NextResponse } from "next/server";
import { listerPhotosChantier, getPhotoChantier, ajouterPhotoChantier, supprimerPhotoChantier } from "@/lib/db";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  if (id) return NextResponse.json(await getPhotoChantier(+id));
  const projet_id = sp.get("projet_id");
  const sansData = sp.get("data") === "0";
  return NextResponse.json(await listerPhotosChantier(projet_id ? +projet_id : undefined, { sansData }));
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.projet_id || !b.date || !b.photo_data) {
    return NextResponse.json({ error: "projet_id, date et photo_data requis" }, { status: 400 });
  }
  const id = await ajouterPhotoChantier(b);
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await supprimerPhotoChantier(+id);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { listerFichiersClient, ajouterFichierClient, supprimerFichierClient } from "@/lib/db";
import { utilisateurActif } from "@/lib/authUser";

export async function GET(req: NextRequest) {
  const cid = req.nextUrl.searchParams.get("client_id");
  if (!cid) return NextResponse.json({ error: "client_id requis" }, { status: 400 });
  return NextResponse.json(await listerFichiersClient(+cid));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.client_id || !body.data) return NextResponse.json({ error: "client_id et data requis" }, { status: 400 });
  const user = await utilisateurActif(req);
  const id = await ajouterFichierClient({
    client_id: +body.client_id,
    nom: body.nom || "fichier",
    type: body.type || "application/octet-stream",
    data: body.data,
    taille: body.taille,
    ajoute_par: user || undefined,
  });
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await supprimerFichierClient(+id);
  return NextResponse.json({ ok: true });
}

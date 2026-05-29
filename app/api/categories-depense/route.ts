import { NextRequest, NextResponse } from "next/server";
import {
  listerCategoriesDepense, ajouterCategorieDepense,
  renommerCategorieDepense, supprimerCategorieDepense, reactiverCategorieDepense,
} from "@/lib/db";

export async function GET(req: NextRequest) {
  const toutes = req.nextUrl.searchParams.get("toutes") === "1";
  return NextResponse.json(await listerCategoriesDepense(!toutes));
}

export async function POST(req: NextRequest) {
  const { nom } = await req.json();
  if (!nom || !nom.trim()) return NextResponse.json({ error: "nom requis" }, { status: 400 });
  try {
    const id = await ajouterCategorieDepense(nom);
    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message?.includes("UNIQUE") ? "Catégorie déjà existante" : (e?.message || "Erreur") }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const { id, nom, action } = await req.json();
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  if (action === "reactiver") await reactiverCategorieDepense(+id);
  else if (nom) await renommerCategorieDepense(+id, nom);
  else return NextResponse.json({ error: "nom ou action requis" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await supprimerCategorieDepense(+id);
  return NextResponse.json({ ok: true });
}

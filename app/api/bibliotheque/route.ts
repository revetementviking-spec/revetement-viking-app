import { NextRequest, NextResponse } from "next/server";
import { ajouterJobBiblio, listerJobsBiblio, supprimerJobBiblio, jobsSimilaires, ajouterPhotosBiblio } from "@/lib/db";

// Les photos vont en BASE (table bibliotheque_photos), plus sur le disque local : sur Vercel
// le système de fichiers est éphémère, les fichiers écrits disparaissaient au déploiement
// suivant — et aucune route ne les servait de toute façon.
const MAX_PHOTOS = 10;
const MAX_PHOTO = 3 * 1024 * 1024; // 3 Mo par photo APRÈS compression côté navigateur

export async function GET(req: NextRequest) {
  const similaires = req.nextUrl.searchParams.get("similaires_pour");
  const materiau = req.nextUrl.searchParams.get("materiau") || undefined;
  if (similaires) {
    const jobs = await jobsSimilaires(+similaires, materiau, 5);
    return NextResponse.json(jobs);
  }
  return NextResponse.json(await listerJobsBiblio());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { photos, ...payload } = body || {};

    const id = await ajouterJobBiblio({ ...payload, photos_json: null, date_ajout: new Date().toISOString() });

    // Photos : dataURL déjà compressées côté navigateur (lib/img.ts). Un seul lot
    // d'INSERT (un aller-retour) au lieu d'un INSERT par photo.
    let enregistrees = 0, ignorees = 0;
    if (Array.isArray(photos)) {
      const valides: { data: string; type: string }[] = [];
      for (const p of photos.slice(0, MAX_PHOTOS)) {
        const m = typeof p === "string" ? p.match(/^data:(image\/[a-zA-Z+]+);base64,/) : null;
        if (!m || p.length > MAX_PHOTO) { ignorees++; continue; }
        valides.push({ data: p, type: m[1] });
      }
      enregistrees = await ajouterPhotosBiblio(id, valides);
    }
    return NextResponse.json({ ok: true, id, photos: enregistrees, photos_ignorees: ignorees });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e?.message || "Erreur" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await supprimerJobBiblio(+id);
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { ajouterPhotoChantier, marquerDriveSync, getProjet } from "@/lib/db";
import { trouverOuCreerSousDossier, trouverFichierParNom } from "@/lib/drive";

export const dynamic = "force-dynamic";

// Enregistre une vidéo déjà uploadée sur Drive (référence seulement, pas de base64).
export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.projet_id || !b.date || !b.nom) {
    return NextResponse.json({ error: "projet_id, date et nom requis" }, { status: 400 });
  }
  // Résout l'id Drive : fourni par le client, sinon retrouvé par nom dans le dossier.
  let driveId: string | null = b.drive_id || null;
  if (!driveId) {
    const projet = await getProjet(+b.projet_id);
    const dossierId = await trouverOuCreerSousDossier(`${projet?.nom || "Projet " + b.projet_id} - Photos`);
    const f = await trouverFichierParNom(b.nom, dossierId);
    if (!f) {
      return NextResponse.json({ error: "fichier_introuvable", message: "Vidéo introuvable sur Drive (upload incomplet ?)." }, { status: 404 });
    }
    driveId = f.id;
  }
  const id = await ajouterPhotoChantier({
    projet_id: +b.projet_id,
    date: b.date,
    employes: b.employes || "Manuel",
    photo_data: "", // pas de base64 : la vidéo vit sur Drive
    photo_type: b.mimeType || "video/mp4",
    description: b.description || b.nom,
  });
  await marquerDriveSync(id, driveId, null);
  return NextResponse.json({ ok: true, id, drive_id: driveId });
}

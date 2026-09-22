import { NextRequest, NextResponse } from "next/server";
import { listerPhotosErreursDrive, marquerDriveSync, nomsProjets } from "@/lib/db";
import { driveEstActif, trouverOuCreerSousDossier, uploaderFichier } from "@/lib/drive";

export const dynamic = "force-dynamic";

// Réessaie d'uploader sur Drive les photos dont la synchro avait échoué.
export async function POST(_req: NextRequest) {
  if (!(await driveEstActif())) {
    return NextResponse.json({ ok: false, error: "drive_inactif", message: "Connecte Google Drive d'abord." }, { status: 503 });
  }
  const photos = await listerPhotosErreursDrive();
  // Noms de projets préchargés en UNE requête (avant : un getProjet() — PROJ_SQL et ses
  // sept sous-requêtes — par photo), et un seul appel Drive par dossier de projet.
  const noms = await nomsProjets(photos.map((p) => Number(p.projet_id)));
  const dossiers = new Map<string, Promise<string>>();
  const dossierPour = (sousDossier: string) => {
    if (!dossiers.has(sousDossier)) dossiers.set(sousDossier, trouverOuCreerSousDossier(sousDossier));
    return dossiers.get(sousDossier)!;
  };
  let synced = 0, restants = 0, ignores = 0;
  let dernierErreur = "";
  for (const p of photos) {
    // Enregistrement sans données (ex. vidéo, déjà sur Drive) → on efface simplement l'erreur.
    if (!p.photo_data || !/^data:/.test(String(p.photo_data))) {
      await marquerDriveSync(p.id, null, null).catch(() => {});
      ignores++;
      continue;
    }
    try {
      const nomProjet = noms.get(Number(p.projet_id)) || "";
      const sousDossier = `${nomProjet || "Projet " + p.projet_id} - Photos`;
      const dossierId = await dossierPour(sousDossier);
      const ext = p.photo_type?.includes("png") ? "png" : p.photo_type?.includes("pdf") ? "pdf" : p.photo_type?.startsWith("video/") ? "mp4" : "jpg";
      const nom = `${p.date}_${(p.description || "photo")}_${p.id}.${ext}`.replace(/[/\\]/g, "-");
      const up = await uploaderFichier({ nom, dataUrl: p.photo_data, dossierId, description: `Projet ${nomProjet} · ${p.date}` });
      await marquerDriveSync(p.id, up.id, null);
      synced++;
    } catch (e: any) {
      restants++;
      dernierErreur = e?.message?.slice(0, 200) || "erreur";
      try { await marquerDriveSync(p.id, null, dernierErreur); } catch {}
    }
  }
  return NextResponse.json({ ok: true, synced, ignores, restants, dernierErreur });
}

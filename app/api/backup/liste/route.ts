// Liste les fichiers backup-*.json présents dans le dossier Drive Viking/Backups
// pour valider que les autobackups quotidiens (cron 8h UTC) tournent bien.
import { NextResponse } from "next/server";
import { driveEstActif, trouverOuCreerSousDossier, listerDossier } from "@/lib/drive";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!(await driveEstActif())) {
      return NextResponse.json({ ok: false, raison: "drive_non_connecte" });
    }
    const dossierId = await trouverOuCreerSousDossier("Backups");
    const fichiers = await listerDossier(dossierId);
    const backups = (fichiers || [])
      .filter((f: any) => f.name?.startsWith("backup-") && f.name.endsWith(".json"))
      .map((f: any) => ({
        id: f.id,
        nom: f.name,
        taille_ko: f.size ? Math.round(+f.size / 1024) : null,
        date: f.modifiedTime || f.createdTime,
        lien: f.webViewLink,
      }))
      .sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));

    // Calcul de fraîcheur
    const dernier = backups[0];
    let etat: "frais" | "vieux" | "tres_vieux" | "aucun" = "aucun";
    let heures_depuis: number | null = null;
    if (dernier?.date) {
      heures_depuis = Math.round((Date.now() - new Date(dernier.date).getTime()) / 3_600_000);
      if (heures_depuis < 30) etat = "frais";
      else if (heures_depuis < 72) etat = "vieux";
      else etat = "tres_vieux";
    }

    return NextResponse.json({
      ok: true,
      total: backups.length,
      etat,
      heures_depuis_dernier: heures_depuis,
      dernier,
      backups: backups.slice(0, 15),
    });
  } catch (e: any) {
    console.error("[/api/backup/liste]", e);
    return NextResponse.json({ ok: false, error: "Liste des sauvegardes indisponible — voir le journal serveur." }, { status: 500 });
  }
}

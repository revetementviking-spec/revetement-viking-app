// Backup complet de la DB → Drive (Viking/Backups/backup-YYYY-MM-DD-HHMM.json)
import { NextRequest, NextResponse } from "next/server";
import { lister, listerClients, listerProjets, listerEmployes, listerToutesHeures, listerToutesDepenses, listerContrats, listerPaiePeriodes, listerJobsBiblio } from "@/lib/db";
import { driveEstActif, trouverOuCreerSousDossier, uploaderFichier } from "@/lib/drive";

export const dynamic = "force-dynamic";

async function effectuerBackup(): Promise<{ ok: boolean; nom?: string; webViewLink?: string; tailles?: any; error?: string }> {
  if (!(await driveEstActif())) return { ok: false, error: "Drive non actif — connecte Drive avant de lancer un backup." };
  // Récupère toutes les tables principales (sans les blobs photos — trop lourd)
  const [soumissions, clients, projets, employes, heures, depenses, contrats, paies, biblio] = await Promise.all([
    lister().catch(() => []),
    listerClients().catch(() => []),
    listerProjets().catch(() => []),
    listerEmployes().catch(() => []),
    listerToutesHeures().catch(() => []),
    listerToutesDepenses().catch(() => []),
    listerContrats().catch(() => []),
    listerPaiePeriodes(undefined, 100).catch(() => []),
    listerJobsBiblio().catch(() => []),
  ]);
  const dump = {
    version: 1,
    date_backup: new Date().toISOString(),
    app: "Revêtement Viking",
    counts: {
      soumissions: soumissions.length, clients: clients.length, projets: projets.length,
      employes: employes.length, heures: heures.length, depenses: depenses.length,
      contrats: contrats.length, paies: paies.length, biblio: biblio.length,
    },
    soumissions, clients, projets, employes, heures, depenses, contrats, paies, biblio,
  };
  const json = JSON.stringify(dump, null, 2);
  const dataUrl = `data:application/json;base64,${Buffer.from(json).toString("base64")}`;
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const nom = `backup-${ts}.json`;
  const dossierId = await trouverOuCreerSousDossier("Backups");
  const r = await uploaderFichier({ nom, dataUrl, dossierId, description: `Backup DB · ${dump.counts.soumissions} soum · ${dump.counts.projets} projets · ${dump.counts.clients} clients` });
  return { ok: true, nom, webViewLink: r.webViewLink, tailles: dump.counts };
}

export async function POST(req: NextRequest) {
  try {
    const r = await effectuerBackup();
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// GET pour cron Vercel (header x-vercel-cron) ou test manuel
export async function GET(req: NextRequest) {
  try {
    const r = await effectuerBackup();
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { driveEstActif, testerConnexion, uploaderFichier, trouverOuCreerSousDossier, listerDossier, oauthClientConfigure } from "@/lib/drive";

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action");
  if (action === "list") {
    const dossierId = req.nextUrl.searchParams.get("dossier_id") || undefined;
    try { return NextResponse.json(await listerDossier(dossierId)); }
    catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
  }
  if (action === "config") {
    return NextResponse.json({
      oauth_client_configure: oauthClientConfigure(),
      drive_actif: await driveEstActif(),
    });
  }
  return NextResponse.json(await testerConnexion());
}

export async function POST(req: NextRequest) {
  if (!(await driveEstActif())) return NextResponse.json({ error: "Drive non actif" }, { status: 400 });
  const b = await req.json();
  if (!b.nom || !b.dataUrl) return NextResponse.json({ error: "nom et dataUrl requis" }, { status: 400 });
  try {
    let dossierId = b.dossier_id;
    if (!dossierId && b.sous_dossier_nom) {
      dossierId = await trouverOuCreerSousDossier(b.sous_dossier_nom);
    }
    const r = await uploaderFichier({ nom: b.nom, dataUrl: b.dataUrl, dossierId, description: b.description });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

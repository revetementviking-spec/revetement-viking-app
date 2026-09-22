import { NextRequest, NextResponse } from "next/server";
import { listerAssurances, ajouterAssurance, modifierAssurance, supprimerAssurance } from "@/lib/db";
import { nombreSaisi } from "@/lib/calculs";
import { validerEcritureArgent } from "@/lib/validation-argent";
import { journaliser } from "@/lib/audit";
import { utilisateurActif } from "@/lib/authUser";

export const dynamic = "force-dynamic";
function fail(e: any) { console.error("[/api/assurances]", e); return NextResponse.json({ error: e?.message || "erreur" }, { status: 500 }); }

// Contrôle de type AU DÉPÔT : seuls un PDF ou une image sont acceptés comme document
// d'assurance. Avant, n'importe quel data URL (text/html, image/svg+xml…) était stocké
// tel quel, puis servi par /api/assurances/[id]/document.
const TYPE_DOCUMENT_OK = /^data:(application\/pdf|image\/(jpeg|png|webp|heic));base64,/i;
function documentInvalide(b: any): string | null {
  if (b?.document_data == null || b.document_data === "") return null;
  if (typeof b.document_data !== "string" || !TYPE_DOCUMENT_OK.test(b.document_data)) {
    return "document refusé : seuls un PDF ou une image (JPEG, PNG, WebP, HEIC) sont acceptés";
  }
  return null;
}

/** Prime annuelle : bornée et CONVERTIE en nombre avant l'écriture (« 1 250,00 $ » restait
 *  sinon du texte en base, et la somme des primes donnait NaN). Dates au format réel. */
function normaliser(b: any): string | null {
  const invalide = validerEcritureArgent(b, { champsMontant: ["prime_annuelle"], champsDate: ["date_debut", "date_renouvellement"], refuserNegatif: true });
  if (invalide) return invalide;
  if (b.prime_annuelle !== undefined) b.prime_annuelle = (b.prime_annuelle === null || b.prime_annuelle === "") ? null : nombreSaisi(b.prime_annuelle);
  return null;
}

export async function GET() {
  try { return NextResponse.json(await listerAssurances(), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return fail(e); }
}
export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b?.compagnie?.trim() && !b?.type?.trim()) return NextResponse.json({ error: "type ou compagnie requis" }, { status: 400 });
    const refus = documentInvalide(b) || normaliser(b);
    if (refus) return NextResponse.json({ error: refus }, { status: 400 });
    const id = await ajouterAssurance(b);
    return NextResponse.json({ ok: true, id });
  } catch (e) { return fail(e); }
}
export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b?.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    const refus = documentInvalide(b) || normaliser(b);
    if (refus) return NextResponse.json({ error: refus }, { status: 400 });
    await modifierAssurance(+b.id, b);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    const user = await utilisateurActif(req);
    const avant = (await listerAssurances()).find((a: any) => Number(a.id) === +id) || null;
    await supprimerAssurance(+id);
    journaliser("assurance.supprimee", {
      ref_type: "assurance", ref_id: id, utilisateur: user || undefined,
      description: avant ? `${avant.type || "?"} · ${avant.compagnie || "?"} · ${avant.numero_police || "—"}` : `Assurance #${id}`,
      avant,
    });
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}

import { NextRequest, NextResponse } from "next/server";
import { listerDoublonsSuspects, compterDoublonsSuspects, ignorerDoublon, reactiverDoublon } from "@/lib/db";
import { utilisateurActif } from "@/lib/authUser";
import { journaliser } from "@/lib/audit";

export const dynamic = "force-dynamic";

function fail(e: any, status = 500) {
  console.error("[/api/doublons]", e);
  return NextResponse.json({ error: e?.message || "erreur" }, { status });
}

/** GET            → les paires suspectes, pièces comprises.
 *  GET ?compte=1  → juste le décompte (pastille, push du matin). */
export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("compte") === "1") {
      return NextResponse.json(await compterDoublonsSuspects(), { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await listerDoublonsSuspects(), { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return fail(e); }
}

/** POST { cle, note? } → « ce n'est pas un doublon ». Décision humaine, datée et signée.
 *  Rien n'est supprimé ni fusionné ici : les deux pièces restent telles quelles, seule
 *  l'alerte se tait. Supprimer la mauvaise facture reste un geste explicite, ailleurs. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const cle = String(body?.cle || "").trim();
    if (!cle) return NextResponse.json({ error: "cle requise" }, { status: 400 });
    const user = await utilisateurActif(req);
    await ignorerDoublon(cle, user, body?.note);
    journaliser("doublon.ignore", {
      req, utilisateur: user || undefined, ref_type: "doublon", ref_id: cle,
      description: `Écarté : ${cle}${body?.note ? ` — ${String(body.note).slice(0, 120)}` : ""}`,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}

/** DELETE ?cle=… → remet la paire sous surveillance (on l'avait écartée par erreur). */
export async function DELETE(req: NextRequest) {
  try {
    const cle = String(req.nextUrl.searchParams.get("cle") || "").trim();
    if (!cle) return NextResponse.json({ error: "cle requise" }, { status: 400 });
    const user = await utilisateurActif(req);
    await reactiverDoublon(cle);
    journaliser("doublon.reactive", {
      req, utilisateur: user || undefined, ref_type: "doublon", ref_id: cle,
      description: `Remis sous surveillance : ${cle}`,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}

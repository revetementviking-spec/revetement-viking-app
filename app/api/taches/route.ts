import { NextRequest, NextResponse } from "next/server";
import { listerTaches, ajouterTache, modifierTache, supprimerTache, terminerTache } from "@/lib/db";
import { aujourdhuiMontreal } from "@/lib/date";

function fail(e: any, status = 500) { console.error("[/api/taches]", e); return NextResponse.json({ error: e?.message || "erreur" }, { status }); }

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filtres: any = {};
    if (sp.get("statut")) filtres.statut = sp.get("statut");
    if (sp.get("client_id")) filtres.client_id = +sp.get("client_id")!;
    if (sp.get("projet_id")) filtres.projet_id = +sp.get("projet_id")!;
    if (sp.get("assigne_a")) filtres.assigne_a = sp.get("assigne_a");
    return NextResponse.json(await listerTaches(filtres));
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.titre) return NextResponse.json({ error: "titre requis" }, { status: 400 });
    const id = await ajouterTache(b);
    return NextResponse.json({ ok: true, id });
  } catch (e) { return fail(e); }
}

export async function PATCH(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    // Complétion : passe par terminerTache (recrée la prochaine occurrence si récurrente).
    if (b.statut === "complete") {
      const { prochaine } = await terminerTache(+b.id, b.date_completion || aujourdhuiMontreal());
      return NextResponse.json({ ok: true, prochaine });
    }
    await modifierTache(+b.id, b);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    await supprimerTache(+id);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}

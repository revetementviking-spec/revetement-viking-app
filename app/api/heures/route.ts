import { NextRequest, NextResponse } from "next/server";
import { listerHeuresProjet, ajouterHeureProjet, supprimerHeureProjet, modifierHeureProjet, listerToutesHeures } from "@/lib/db";
import { journaliser } from "@/lib/audit";

function ipDe(req: NextRequest) { return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined; }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const projet_id = sp.get("projet_id");
  if (projet_id) return NextResponse.json(await listerHeuresProjet(+projet_id));
  // Liste globale avec filtres
  const filtres: any = {};
  if (sp.get("employe")) filtres.employe = sp.get("employe");
  if (sp.get("depuis")) filtres.depuis = sp.get("depuis");
  if (sp.get("jusqu_a")) filtres.jusqu_a = sp.get("jusqu_a");
  return NextResponse.json(await listerToutesHeures(filtres));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.projet_id || !body.date || !body.heures) {
    return NextResponse.json({ error: "projet_id, date et heures requis" }, { status: 400 });
  }
  const id = await ajouterHeureProjet(body);
  await journaliser("heures.ajoutees", {
    ref_type: "heures", ref_id: id,
    description: `${body.employe || "?"} · ${body.heures}h · projet ${body.projet_id} · ${body.date}`,
    ip: ipDe(req),
  });
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await modifierHeureProjet(+body.id, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await supprimerHeureProjet(+id);
  return NextResponse.json({ ok: true });
}

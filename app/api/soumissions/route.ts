import { NextRequest, NextResponse } from "next/server";
import { sauvegarder, lister, charger, supprimer, changerStatut, enregistrerHeuresReelles, statistiques } from "@/lib/db";
import { journaliser } from "@/lib/audit";

function ipDe(req: NextRequest): string | undefined {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || undefined;
}

export async function GET(req: NextRequest) {
  const numero = req.nextUrl.searchParams.get("numero");
  const stats = req.nextUrl.searchParams.get("stats");
  const statut = req.nextUrl.searchParams.get("statut") as any;

  if (stats === "1") return NextResponse.json(await statistiques());

  if (numero) {
    const s = await charger(numero);
    if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ...s, payload: JSON.parse(s.payload_json) });
  }
  return NextResponse.json(await lister(statut || undefined));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const nouveau = !body.numero;
  const numero = await sauvegarder(body);
  await journaliser(nouveau ? "soumission.creee" : "soumission.modifiee", {
    ref_type: "soumission", ref_id: numero,
    description: `${body.client?.nom || "?"} · ${body.total ? body.total + " $" : "0 $"}`,
    ip: ipDe(req), user_agent: req.headers.get("user-agent") || undefined,
  });
  return NextResponse.json({ numero, ok: true });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (body.statut) {
    await changerStatut(body.numero, body.statut);
    const map: Record<string, any> = {
      envoyee: "soumission.envoyee", acceptee: "soumission.acceptee",
      refusee: "soumission.refusee", facturee: "soumission.facturee",
    };
    await journaliser(map[body.statut] || "soumission.statut_change", {
      ref_type: "soumission", ref_id: body.numero,
      description: `Statut → ${body.statut}`,
      apres: { statut: body.statut },
      ip: ipDe(req),
    });
  }
  if (body.heuresReelles !== undefined) await enregistrerHeuresReelles(body.numero, body.heuresReelles);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const numero = req.nextUrl.searchParams.get("numero");
  if (!numero) return NextResponse.json({ error: "numero requis" }, { status: 400 });
  await supprimer(numero);
  await journaliser("soumission.supprimee", {
    ref_type: "soumission", ref_id: numero,
    description: `Suppression définitive`, ip: ipDe(req),
  });
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { listerDepensesProjet, ajouterDepenseProjet, supprimerDepenseProjet, modifierDepenseProjet, fournisseursConnus, listerToutesDepenses } from "@/lib/db";
import { journaliser } from "@/lib/audit";
import { utilisateurActif } from "@/lib/authUser";

function ipDe(req: NextRequest) { return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined; }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("fournisseurs") === "1") return NextResponse.json(await fournisseursConnus());
  const sansData = sp.get("data") === "0";
  const projet_id = sp.get("projet_id");
  if (projet_id === null) return NextResponse.json(await listerToutesDepenses({ sansData }));
  return NextResponse.json(await listerDepensesProjet(projet_id ? +projet_id : null, { sansData }));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.montant || !body.date) {
    return NextResponse.json({ error: "montant et date requis" }, { status: 400 });
  }
  const user = await utilisateurActif(req);
  const id = await ajouterDepenseProjet({ ...body, ajoute_par: user || undefined });
  await journaliser("depense.ajoutee", {
    ref_type: "depense", ref_id: id, utilisateur: user || undefined,
    description: `${body.fournisseur || "?"} · ${body.montant}$ · ${body.categorie || "?"} · projet ${body.projet_id || "—"}`,
    ip: ipDe(req),
  });
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const user = await utilisateurActif(req);
  await modifierDepenseProjet(+body.id, body);
  journaliser("depense.modifiee", {
    ref_type: "depense", ref_id: body.id, utilisateur: user || undefined,
    description: `${body.fournisseur || "?"} · ${body.montant || "?"}$`,
    ip: ipDe(req),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const user = await utilisateurActif(req);
  await supprimerDepenseProjet(+id);
  journaliser("depense.supprimee", { ref_type: "depense", ref_id: id, utilisateur: user || undefined, description: `Suppression #${id}`, ip: ipDe(req) });
  return NextResponse.json({ ok: true });
}

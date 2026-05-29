import { NextRequest, NextResponse } from "next/server";
import { listerProjets, getProjet, ajouterProjet, modifierProjet, supprimerProjet, trouverOuCreerClient, charger } from "@/lib/db";
import { aujourdhuiMontreal } from "@/lib/date";
import { utilisateurActif } from "@/lib/authUser";
import { journaliser } from "@/lib/audit";

function ok(data: any, init?: ResponseInit) {
  // no-store : les chiffres (marge, coûts) doivent toujours être frais après
  // ajout d'heures/dépenses. Pas de cache navigateur ni CDN.
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store, max-age=0", ...(init?.headers || {}) } });
}
function fail(e: any, status = 500) {
  console.error("[/api/projets]", e);
  return NextResponse.json({ error: e?.message || "Erreur serveur" }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    const statut = req.nextUrl.searchParams.get("statut") || undefined;
    if (id) {
      const p = await getProjet(+id);
      if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
      return ok(p);
    }
    return ok(await listerProjets(statut));
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.fromSoumission) {
      const s = await charger(body.fromSoumission);
      if (!s) return NextResponse.json({ error: "soumission introuvable" }, { status: 404 });
      const client_id = await trouverOuCreerClient(s.client_nom, {
        courriel: s.client_courriel,
        telephone: s.client_telephone,
        adresse: s.client_adresse,
      });
      const id = await ajouterProjet({
        client_id,
        nom: s.projet || `Projet ${s.client_nom}`,
        adresse_chantier: s.client_adresse,
        description: `Soumission ${s.numero} - ${formatCAD(s.total)}`,
        soumission_numero: s.numero,
        budget_estime: s.total,
        heures_estimees: s.heures_estimees,
        date_debut: aujourdhuiMontreal(),
        statut: 'actif',
      });
      return ok({ ok: true, id });
    }
    if (!body.client_id && body.client_nom) {
      body.client_id = await trouverOuCreerClient(body.client_nom);
    }
    const user = await utilisateurActif(req);
    const id = await ajouterProjet({ ...body, cree_par: user || undefined });
    journaliser("projet.cree", { ref_type: "projet", ref_id: id, utilisateur: user || undefined, description: body.nom || `Projet #${id}` });
    return ok({ ok: true, id });
  } catch (e) { return fail(e); }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    const user = await utilisateurActif(req);
    await modifierProjet(body.id, { ...body, modifie_par: user });
    journaliser("projet.statut_change", { ref_type: "projet", ref_id: body.id, utilisateur: user || undefined, description: `Modif ${Object.keys(body).filter(k => k !== "id").join(", ")}` });
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    const user = await utilisateurActif(req);
    await supprimerProjet(+id);
    journaliser("projet.supprime", { ref_type: "projet", ref_id: id, utilisateur: user || undefined, description: `Suppression projet #${id}` });
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}

function formatCAD(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(n);
}

import { NextRequest, NextResponse } from "next/server";
import { listerProjets, listerProjetsLite, listerProjetsAFacturer, getProjet, ajouterProjet, modifierProjet, supprimerProjet, trouverOuCreerClient, charger } from "@/lib/db";
import { envoyerPushUtilisateur } from "@/lib/push";
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
    // a_facturer=1 : projets complétés pas encore facturés (rappel dashboard)
    if (req.nextUrl.searchParams.get("a_facturer") === "1") return ok(await listerProjetsAFacturer());
    // lite=1 : liste légère (id/nom/statut) pour les menus déroulants — bien plus rapide
    // que la liste complète avec coûts/marges (PROJ_SQL = 5 sous-requêtes par projet).
    if (req.nextUrl.searchParams.get("lite") === "1") return ok(await listerProjetsLite(statut));
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
    const avant = await getProjet(+body.id);
    const nouvelleCompletion = body.statut === "complete" && avant?.statut !== "complete";
    if (nouvelleCompletion) {
      // Pose la date de fin réelle (reconnaissance du CA). Règle : complété = facturé.
      if (body.date_fin_reelle === undefined) body.date_fin_reelle = aujourdhuiMontreal();
      body.facturee = 1;
    }
    await modifierProjet(body.id, { ...body, modifie_par: user });
    journaliser("projet.statut_change", { ref_type: "projet", ref_id: body.id, utilisateur: user || undefined, description: `Modif ${Object.keys(body).filter(k => k !== "id").join(", ")}` });
    // Avis à Francis : projet complété et marqué facturé.
    if (nouvelleCompletion) {
      const valeur = (avant as any)?.prix_contrat || (avant as any)?.budget_estime || 0;
      envoyerPushUtilisateur("Francis", {
        title: "✅ Projet complété",
        body: `« ${avant?.nom || "Projet"} » est complété et marqué facturé${valeur ? ` (${(+valeur).toLocaleString("fr-CA")} $)` : ""}.`,
        url: `/projets/${body.id}`,
        tag: "complete-" + body.id,
      }).catch(() => {});
    }
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

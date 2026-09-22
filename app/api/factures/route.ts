import { NextRequest, NextResponse } from "next/server";
import { listerFacturesProjet, ajouterFactureProjet, marquerFacturePayee, annulerPaiementFacture, supprimerFactureProjet, projetReferenceValide, doublonsDeLaPieceEnregistree } from "@/lib/db";
import { aujourdhuiMontreal } from "@/lib/date";
import { nombreSaisi } from "@/lib/calculs";
import { validerEcritureArgent } from "@/lib/validation-argent";
// Aucun geste d'argent n'était tracé ici : « qui a marqué cette facture payée ? » ou
// « qui a supprimé cette facture ? » n'avait aucune réponse possible six mois plus tard.
import { journaliser } from "@/lib/audit";
import { utilisateurActif } from "@/lib/authUser";

function fail(e: any, status = 500) { console.error("[/api/factures]", e); return NextResponse.json({ error: e?.message || "erreur" }, { status }); }

export async function GET(req: NextRequest) {
  try {
    const projet_id = req.nextUrl.searchParams.get("projet_id");
    if (!projet_id) return NextResponse.json({ error: "projet_id requis" }, { status: 400 });
    return NextResponse.json(await listerFacturesProjet(+projet_id));
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Montant : NOMBRE fini exigé (« abc » passait). Virgule décimale acceptée.
    // Négatif toléré (note de crédit).
    const montant = nombreSaisi(body.montant);
    if (!body.projet_id || !body.montant || !isFinite(montant) || !body.date) {
      return NextResponse.json({ error: "projet_id, montant (nombre) et date requis" }, { status: 400 });
    }
    // Bornes partagées : sans elles, un 1e21 saisi ici faisait exploser le facturé, le
    // « à recevoir » et la marge du projet dans tous les écrans (mesuré).
    const invalide = validerEcritureArgent(body, { champsDate: ["date", "date_paiement", "date_echeance"] });
    if (invalide) return NextResponse.json({ error: invalide }, { status: 400 });
    if (!(await projetReferenceValide(body.projet_id))) {
      return NextResponse.json({ error: "projet introuvable — la facture serait rattachée à un projet qui n'existe pas" }, { status: 400 });
    }
    body.montant = montant;
    const id = await ajouterFactureProjet(body);
    const u = await utilisateurActif(req);
    journaliser("facture.creee", { req, utilisateur: u || undefined, ref_type: "facture", ref_id: id,
      description: `${body.numero || "sans n°"} · ${montant} $ · projet ${body.projet_id}` }).catch(() => {});
    // Deux factures au même numéro, ou même chantier/même montant à quelques jours : on le
    // dit tout de suite, sans refuser l'écriture (un contrat peut avoir deux versements
    // égaux). La facture est déjà créée quand cette vérification tourne.
    const doublons = await doublonsDeLaPieceEnregistree("facture", id);
    return NextResponse.json({ ok: true, id, doublons });
  } catch (e) { return fail(e); }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    const invalidePatch = validerEcritureArgent(body, { champsDate: ["date", "date_paiement", "date_echeance"] });
    if (invalidePatch) return NextResponse.json({ error: invalidePatch }, { status: 400 });
    const u = await utilisateurActif(req);
    if (body.action === "marquer_payee") {
      const d = body.date_paiement || aujourdhuiMontreal();
      await marquerFacturePayee(body.id, d);
      journaliser("facture.encaissee", { req, utilisateur: u || undefined, ref_type: "facture", ref_id: body.id, description: `Encaissée le ${d}` }).catch(() => {});
    } else if (body.action === "annuler_paiement") {
      await annulerPaiementFacture(body.id);
      journaliser("facture.paiement_annule", { req, utilisateur: u || undefined, ref_type: "facture", ref_id: body.id, description: "Encaissement annulé" }).catch(() => {});
    } else {
      return NextResponse.json({ error: "action inconnue" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    const u = await utilisateurActif(req);
    // Une facture ENCAISSÉE ne se supprime plus d'un clic : sans corbeille, c'était de
    // l'argent reçu effacé définitivement, sans confirmation ni possibilité de retour.
    const res = await supprimerFactureProjet(+id);
    if (!res.ok) return NextResponse.json({ error: "suppression refusée", message: res.raison }, { status: 409 });
    journaliser("facture.supprimee", { req, utilisateur: u || undefined, ref_type: "facture", ref_id: id, description: `Suppression facture #${id}` }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}

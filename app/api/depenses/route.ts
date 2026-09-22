import { NextRequest, NextResponse } from "next/server";
import { listerDepensesProjet, ajouterDepenseProjet, supprimerDepenseProjet, modifierDepenseProjet, fournisseursConnus, listerToutesDepenses, categoriesParFournisseur, projetPourSaisie, getDepenseProjet } from "@/lib/db";
import { journaliser } from "@/lib/audit";
import { utilisateurActif } from "@/lib/authUser";
import { nombreSaisi } from "@/lib/calculs";
import { validerEcritureArgent } from "@/lib/validation-argent";
import { accepteSaisieTardive, JOURS_GRACE_SAISIE } from "@/lib/statuts-projet";
import { avecIdempotence } from "@/lib/idempotence";

/** Le chantier visé existe-t-il et accepte-t-il encore une dépense ? Même règle que les
 *  menus (lib/statuts-projet.ts), appliquée côté serveur : un appel direct ou un écran
 *  pas à jour pouvait imputer une dépense à un chantier annulé ou facturé depuis des
 *  mois. `null`/vide = dépense générale, permis. Renvoie la réponse de refus, sinon null. */
async function refusProjet(projet_id: any): Promise<NextResponse | null> {
  const ref = await projetPourSaisie(projet_id);
  if (ref === null) return null;
  if (!ref.existe) return NextResponse.json({ error: "projet introuvable — laisse le projet vide pour une dépense générale" }, { status: 400 });
  if (accepteSaisieTardive(ref.projet)) return null;
  const message = ref.projet.statut === "annule"
    ? "ce chantier est ANNULÉ : aucune dépense ne peut y être rattachée"
    : `ce chantier est complété depuis plus de ${JOURS_GRACE_SAISIE} jours : la saisie est fermée (le coût de revient d'un dossier déjà facturé ne doit plus bouger)`;
  return NextResponse.json({ error: "saisie refusée", message }, { status: 409 });
}

import { ipClient } from "@/lib/ip";
const ipDe = (req: NextRequest) => ipClient(req);
// Accepte la virgule décimale québécoise (« 88,50 ») en plus du point.
// Implémentation unique dans lib/calculs.ts : « 88,50 », « 1 234,56 $ », etc.
const parseMontant = nombreSaisi;

// Bornes partagées avec /api/factures et /api/extras (lib/validation-argent.ts).
// Le négatif reste toléré ici : note de crédit / remboursement fournisseur.
const validerDepense = (body: any) => validerEcritureArgent(body);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("fournisseurs") === "1") return NextResponse.json(await fournisseursConnus());
  if (sp.get("categories_par_fournisseur") === "1") return NextResponse.json(await categoriesParFournisseur());
  const sansData = sp.get("data") === "0";
  const projet_id = sp.get("projet_id");
  if (projet_id === null) return NextResponse.json(await listerToutesDepenses({ sansData }));
  return NextResponse.json(await listerDepensesProjet(projet_id ? +projet_id : null, { sansData }));
}

export async function POST(req: NextRequest) {
  return avecIdempotence(req, () => creerDepense(req));
}

async function creerDepense(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "requête invalide" }, { status: 400 });
    // Montant : NOMBRE fini exigé (« abc » passait et corrompait les totaux).
    // Négatif toléré : note de crédit / remboursement fournisseur.
    const montant = parseMontant(body.montant);
    if (!body.montant || !isFinite(montant) || !body.date) {
      return NextResponse.json({ error: "montant (nombre) et date requis" }, { status: 400 });
    }
    const invalide = validerDepense(body);
    if (invalide) return NextResponse.json({ error: invalide }, { status: 400 });
    // Sans projet_id, c'est une dépense générale : permis. Avec un projet_id qui ne
    // pointe sur RIEN, la dépense n'apparaît sur aucune fiche mais reste comptée dans
    // les totaux — de l'argent hors de vue. Mesuré : elle sortait bien dans la liste
    // globale alors que /api/projets?id=… répondait 404. Et un chantier annulé ou fermé
    // depuis longtemps n'accepte plus de dépense (409).
    const refus = await refusProjet(body.projet_id);
    if (refus) return refus;
    body.montant = montant;
    const user = await utilisateurActif(req);
    const id = await ajouterDepenseProjet({ ...body, ajoute_par: user || undefined });
    // Journalisation NON bloquante : si elle échouait après l'insertion réussie, la
    // route renverrait 500 → le client croirait à un échec → double dépense au 2e essai.
    journaliser("depense.ajoutee", {
      ref_type: "depense", ref_id: id, utilisateur: user || undefined,
      description: `${body.fournisseur || "?"} · ${body.montant}$ · ${body.categorie || "?"} · projet ${body.projet_id || "—"}`,
      ip: ipDe(req),
    }).catch(() => {});
    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    console.error("[/api/depenses POST]", e);
    // JSON propre (jamais de page HTML) → le client peut toujours lire le message.
    return NextResponse.json({ error: e?.message || "Erreur serveur lors de l'enregistrement" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  // Mêmes bornes qu'à la création : sinon on refuse une dépense aberrante à la saisie
  // et on l'accepte à la modification, ce qui revient à ne rien refuser du tout.
  const invalide = validerDepense(body);
  if (invalide) return NextResponse.json({ error: invalide }, { status: 400 });
  if (body.montant !== undefined) {
    const montant = parseMontant(body.montant);
    if (!isFinite(montant)) return NextResponse.json({ error: "montant invalide" }, { status: 400 });
    // Un montant à 0 en modification vient presque toujours d'un champ vidé par erreur
    // (`+""` vaut 0). On refuse plutôt que de ramener la dépense à zéro en silence.
    if (montant === 0) return NextResponse.json({ error: "montant à 0 refusé — vide le champ puis ressaisis le vrai montant, ou supprime la dépense" }, { status: 400 });
    body.montant = montant;
  }
  // Le chantier visé — celui qu'on rattache, sinon celui de la dépense — doit encore
  // accepter une saisie (même règle qu'à la création).
  let projetVise: any = body.projet_id;
  if (projetVise === undefined) {
    const actuelle = await getDepenseProjet(+body.id);
    if (!actuelle) return NextResponse.json({ error: "dépense introuvable" }, { status: 404 });
    projetVise = actuelle.projet_id;
  }
  const refus = await refusProjet(projetVise);
  if (refus) return refus;
  const user = await utilisateurActif(req);
  // Verrouillage optimiste (B7) : 409 si la dépense a changé depuis son chargement.
  const res = await modifierDepenseProjet(+body.id, body, body.version);
  if (!res.ok) {
    if (res.conflit) return NextResponse.json({ error: "conflit", message: "Cette dépense a été modifiée par quelqu'un d'autre entre-temps. Recharge la liste avant de sauvegarder.", versionActuelle: res.versionActuelle }, { status: 409 });
    return NextResponse.json({ error: "dépense introuvable" }, { status: 404 });
  }
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

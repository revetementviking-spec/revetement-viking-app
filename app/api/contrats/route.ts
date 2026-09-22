import { NextRequest, NextResponse } from "next/server";
import { listerContrats, getContrat, ajouterContrat, modifierContrat, supprimerContrat } from "@/lib/db";
import { validerEcritureArgent } from "@/lib/validation-argent";
import { nombreSaisi } from "@/lib/calculs";
import { journaliser } from "@/lib/audit";
import { utilisateurActif } from "@/lib/authUser";

// Bornes partagées (mêmes que factures, dépenses, extras). Sans elles, un montant NaN ou
// aberrant entrait tel quel : un contrat à 0 $ ou à 1e21 faussait le CA et les dépôts.
const CHAMPS_MONTANT = ["montant_avant_taxes", "montant_total", "depot_montant", "taxes_pct", "depot_pct"];
const BORNES_CONTRAT = {
  champsMontant: CHAMPS_MONTANT,
  champsDate: ["date_emission", "date_debut_travaux", "date_fin_prevue", "date_signature"],
  refuserNegatif: true,
};

/** Valide puis CONVERTIT les montants en nombres avant l'écriture. Avant, la validation
 *  passait (nombreSaisi lit « 12 500,00 $ ») mais la chaîne brute était stockée : SQLite
 *  la gardait en TEXTE et les totaux qui la lisaient donnaient NaN. */
function validerEtNormaliser(b: any): string | null {
  const invalide = validerEcritureArgent(b, BORNES_CONTRAT);
  if (invalide) return invalide;
  for (const k of CHAMPS_MONTANT) {
    if (b[k] === undefined) continue;
    if (b[k] === null || b[k] === "") { b[k] = null; continue; }
    b[k] = nombreSaisi(b[k]);
  }
  return null;
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const statut = req.nextUrl.searchParams.get("statut");
  if (id) return NextResponse.json(await getContrat(+id));
  return NextResponse.json(await listerContrats(statut || undefined));
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.titre || !b.date_emission) return NextResponse.json({ error: "titre + date_emission requis" }, { status: 400 });
  const invalide = validerEtNormaliser(b);
  if (invalide) return NextResponse.json({ error: invalide }, { status: 400 });
  const r = await ajouterContrat(b);
  return NextResponse.json({ ok: true, ...r });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const invalide = validerEtNormaliser(b);
  if (invalide) return NextResponse.json({ error: invalide }, { status: 400 });
  await modifierContrat(+b.id, b);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const user = await utilisateurActif(req);
  const avant = await getContrat(+id);
  await supprimerContrat(+id);
  journaliser("contrat.supprime", {
    ref_type: "contrat", ref_id: id, utilisateur: user || undefined,
    description: avant ? `${avant.numero} · ${avant.titre} · ${avant.montant_total ?? "—"} $` : `Contrat #${id}`,
    avant: avant ? { numero: avant.numero, titre: avant.titre, client_id: avant.client_id, projet_id: avant.projet_id, montant_total: avant.montant_total, statut: avant.statut } : null,
  });
  return NextResponse.json({ ok: true });
}

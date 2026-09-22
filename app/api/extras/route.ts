import { NextRequest, NextResponse } from "next/server";
import { ajouterExtra, listerExtras, marquerExtraCharge, supprimerExtra, compterExtrasACharger, getProjet, projetReferenceValide, modifierExtra } from "@/lib/db";
import { journaliser } from "@/lib/audit";
import { utilisateurActif } from "@/lib/authUser";
import { envoyerPushUtilisateur } from "@/lib/push";
import { nombreSaisi } from "@/lib/calculs";
import { validerEcritureArgent } from "@/lib/validation-argent";
import { aujourdhuiMontreal } from "@/lib/date";
import { avecIdempotence } from "@/lib/idempotence";

export const dynamic = "force-dynamic";

import { ipClient } from "@/lib/ip";
const ipDe = (req: NextRequest) => ipClient(req);
function noStore(data: any) { return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } }); }

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("compteur") === "1") return noStore(await compterExtrasACharger());
  const statut = sp.get("statut") || undefined;
  // Filtre par chantier, pour l'onglet Extras de la fiche projet. Sans lui il aurait
  // fallu rapatrier les 500 extras de l'app pour n'en afficher que quelques-uns.
  const pid = sp.get("projet_id");
  const projet_id = pid !== null && pid !== "" && Number.isFinite(+pid) ? +pid : null;
  return noStore(await listerExtras(statut, projet_id));
}

export async function POST(req: NextRequest) {
  // Clé X-Idempotence-Cle fournie par l'écran : un double clic ne crée pas deux extras.
  return avecIdempotence(req, () => creerExtra(req));
}

async function creerExtra(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "requête invalide" }, { status: 400 });
    if (!body.description || !body.description.trim()) {
      return NextResponse.json({ error: "description requise" }, { status: 400 });
    }
    // Virgule décimale québécoise acceptée (« 88,50 »).
    const num = nombreSaisi;
    const montantVal = body.montant != null && body.montant !== "" ? num(body.montant) : null;
    const heuresVal = body.heures != null && body.heures !== "" ? num(body.heures) : null;
    if ((montantVal !== null && !isFinite(montantVal)) || (heuresVal !== null && !isFinite(heuresVal))) {
      return NextResponse.json({ error: "montant ou heures invalide" }, { status: 400 });
    }
    // Bornes partagées avec dépenses et factures. Un extra est un travail EN PLUS facturé
    // au client : un montant négatif n'a pas de sens ici (contrairement à une dépense,
    // qui peut porter une note de crédit) et retranchait du revenu en silence.
    const invalide = validerEcritureArgent(body, { refuserNegatif: true, champsMontant: ["montant", "heures"], champsDate: ["date"] });
    if (invalide) return NextResponse.json({ error: invalide }, { status: 400 });
    if (!(await projetReferenceValide(body.projet_id))) {
      return NextResponse.json({ error: "projet introuvable — laisse le projet vide si l'extra n'est rattaché à aucun chantier" }, { status: 400 });
    }
    const user = await utilisateurActif(req);
    const id = await ajouterExtra({
      projet_id: body.projet_id ? +body.projet_id : null,
      date: body.date || aujourdhuiMontreal(),
      nature: body.nature || "montant",
      description: body.description.trim(),
      montant: montantVal,
      heures: heuresVal,
      photo_data: body.photo_data || null,
      thumb_data: body.thumb_data || null,
      saisi_par: user || undefined,
    });

    // Notifications NON bloquantes (une notif/audit qui échoue ne doit pas faire
    // croire à un échec de l'ajout → risque de double extra au 2e essai).
    (async () => {
      let projetNom = "";
      if (body.projet_id) { try { projetNom = (await getProjet(+body.projet_id))?.nom || ""; } catch {} }
      journaliser("extra.ajoute", {
        ref_type: "extra", ref_id: id, utilisateur: user || undefined,
        description: `${body.nature || "extra"} · ${projetNom || "projet ?"} · ${body.description.slice(0, 60)}`,
        ip: ipDe(req),
      }).catch(() => {});
      const montantTxt = body.montant ? ` (${(+body.montant).toLocaleString("fr-CA")} $)` : body.heures ? ` (${body.heures} h)` : "";
      envoyerPushUtilisateur("Francis", {
        title: "💲 Extra à facturer",
        body: `${user || "Quelqu'un"} a ajouté un extra${projetNom ? ` sur ${projetNom}` : ""}${montantTxt} : ${body.description.slice(0, 80)}`,
        url: "/extras", tag: "extra",
      }).catch(() => {});
    })().catch(() => {});

    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    console.error("[/api/extras POST]", e);
    return NextResponse.json({ error: e?.message || "Erreur serveur lors de l'enregistrement" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const user = await utilisateurActif(req);

  // MODIFICATION du contenu (texte, montant, heures…). Distinct du changement de statut
  // ci-dessous : `statut` absent du corps = on modifie l'extra lui-même.
  if (body.statut === undefined) {
    const invalide = validerEcritureArgent(body, { refuserNegatif: true, champsMontant: ["montant", "heures"], champsDate: ["date"] });
    if (invalide) return NextResponse.json({ error: invalide }, { status: 400 });
    if (body.projet_id !== undefined && !(await projetReferenceValide(body.projet_id))) {
      return NextResponse.json({ error: "projet introuvable" }, { status: 400 });
    }
    const num = (v: any) => (v === null || v === undefined || v === "" ? null : nombreSaisi(v));
    const res = await modifierExtra(+body.id, {
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.nature !== undefined ? { nature: body.nature } : {}),
      ...(body.date !== undefined ? { date: body.date } : {}),
      ...(body.projet_id !== undefined ? { projet_id: body.projet_id ? +body.projet_id : null } : {}),
      ...(body.montant !== undefined ? { montant: num(body.montant) } : {}),
      ...(body.heures !== undefined ? { heures: num(body.heures) } : {}),
    });
    if (!res.ok) {
      // 409 quand c'est un refus métier (extra déjà facturé), 404 s'il n'existe pas.
      const code = res.raison?.includes("introuvable") ? 404 : res.raison?.includes("FACTURÉ") ? 409 : 400;
      return NextResponse.json({ error: "modification refusée", message: res.raison }, { status: code });
    }
    journaliser("extra.modifie", {
      ref_type: "extra", ref_id: body.id, utilisateur: user || undefined,
      description: `${body.description ? `« ${String(body.description).slice(0, 50)} » · ` : ""}${body.montant != null ? `${body.montant} $` : ""}`.trim() || `extra #${body.id}`,
      ip: ipDe(req),
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const charge = body.statut === "charge";
  await marquerExtraCharge(+body.id, charge);
  journaliser(charge ? "extra.charge" : "extra.rouvert", {
    ref_type: "extra", ref_id: body.id, utilisateur: user || undefined,
    description: charge ? "Extra marqué facturé" : "Extra remis à facturer", ip: ipDe(req),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const user = await utilisateurActif(req);
  await supprimerExtra(+id);
  journaliser("extra.supprime", { ref_type: "extra", ref_id: id, utilisateur: user || undefined, description: `Suppression extra #${id}`, ip: ipDe(req) });
  return NextResponse.json({ ok: true });
}

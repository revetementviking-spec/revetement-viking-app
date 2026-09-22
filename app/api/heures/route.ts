import { NextRequest, NextResponse } from "next/server";
import { listerHeuresProjet, ajouterHeureProjet, supprimerHeureProjet, modifierHeureProjet, listerToutesHeures, getHeureProjet, projetPourSaisie, employeParNom, heureDansPaiePayee, controlesSaisieHeures } from "@/lib/db";
import { journaliser } from "@/lib/audit";
import { utilisateurActif } from "@/lib/authUser";
import { validerDate } from "@/lib/validation-argent";
import { nombreSaisi } from "@/lib/calculs";
import { aujourdhuiMontreal } from "@/lib/date";
import { accepteSaisieTardive, JOURS_GRACE_SAISIE } from "@/lib/statuts-projet";
import { avecIdempotence, cleIdempotence } from "@/lib/idempotence";

import { ipClient } from "@/lib/ip";
const ipDe = (req: NextRequest) => ipClient(req);

/** Validation souple : on coerce les types et on rejette uniquement les valeurs aberrantes.
 *  La validation stricte de types était trop agressive — bloquait des saisies légitimes. */
function valider(body: any): string | null {
  if (!body || typeof body !== "object") return "payload invalide";
  if (body.date !== undefined && body.date !== null) {
    // Date RÉELLE (le 2026-02-31 était accepté puis décalé au 3 mars) et jamais dans le
    // futur : des heures « travaillées demain » entraient dans la paie et le coût du chantier.
    const e = validerDate(body.date, "date");
    if (e) return e;
    if (body.date > aujourdhuiMontreal()) return "date dans le futur — on saisit des heures travaillées, pas prévues";
  }
  // Virgule québécoise acceptée (« 7,5 ») : `Number("7,5")` valait NaN et la saisie était
  // refusée. La valeur CONVERTIE est remise dans le corps, c'est elle qui est écrite.
  if (body.heures !== undefined && body.heures !== null) {
    const h = nombreSaisi(body.heures);
    if (!isFinite(h)) return "heures doit être un nombre (ex. : 7,5)";
    if (h < 0) return "heures négatives non permises (modifie ou supprime l'entrée existante à corriger)";
    if (h > 24) return "heures > 24 sur une seule entrée (utiliser 2 entrées séparées pour 2 jours)";
    body.heures = h;
  }
  if (body.taux_horaire !== undefined && body.taux_horaire !== null && body.taux_horaire !== "") {
    const t = nombreSaisi(body.taux_horaire);
    if (!isFinite(t) || t < 0) return "taux horaire invalide";
    body.taux_horaire = t;
  }
  return null;
}

/** Le chantier accepte-t-il encore une saisie ? Renvoie le message de refus, sinon null.
 *  Même règle que les menus (lib/statuts-projet.ts), appliquée ICI côté serveur : un
 *  appel direct ou un écran pas à jour pouvait imputer des heures à un chantier annulé
 *  ou fermé et facturé depuis des mois. */
function refusSaisie(p: { statut: string | null; date_fin_reelle: string | null; date_fin_prevue: string | null }): string | null {
  if (accepteSaisieTardive(p)) return null;
  if (p.statut === "annule") return "ce chantier est ANNULÉ : aucune heure ne peut y être saisie";
  return `ce chantier est complété depuis plus de ${JOURS_GRACE_SAISIE} jours : la saisie est fermée (le coût de revient d'un dossier déjà facturé ne doit plus bouger)`;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const projet_id = sp.get("projet_id");
  if (projet_id) return NextResponse.json(await listerHeuresProjet(+projet_id));
  const filtres: any = {};
  if (sp.get("employe")) filtres.employe = sp.get("employe");
  if (sp.get("depuis")) filtres.depuis = sp.get("depuis");
  if (sp.get("jusqu_a")) filtres.jusqu_a = sp.get("jusqu_a");
  if (sp.get("limit")) filtres.limit = +sp.get("limit")!;
  return NextResponse.json(await listerToutesHeures(filtres));
}

export async function POST(req: NextRequest) {
  return avecIdempotence(req, () => creerHeure(req));
}

async function creerHeure(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => null);
  if (!body || !body.projet_id || !body.date || !body.heures) {
    return NextResponse.json({ error: "projet_id, date et heures requis" }, { status: 400 });
  }
  const err = valider(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  // Des heures rattachées à un projet inexistant n'apparaissent sur aucune fiche mais
  // pèsent quand même dans le coût de main-d'œuvre global et dans la paie.
  const ref = await projetPourSaisie(body.projet_id);
  if (!ref || !ref.existe) return NextResponse.json({ error: "projet introuvable" }, { status: 400 });
  const refus = refusSaisie(ref.projet);
  if (refus) return NextResponse.json({ error: "saisie refusée", message: refus }, { status: 409 });
  // L'employé doit exister : un nom mal tapé créait une paie fantôme groupée sous ce nom.
  // Et le taux vient de SA FICHE, jamais de la requête ni d'un défaut : sans taux,
  // ajouterHeureProjet() posait 90 $/h en silence — dans le coût de main-d'œuvre et la paie.
  const emp = await employeParNom(body.employe);
  if (!emp) return NextResponse.json({ error: `employé inconnu ou inactif : ${body.employe || "(vide)"}` }, { status: 400 });
  const tauxFiche = Number(emp.taux_horaire);
  if (!Number.isFinite(tauxFiche) || tauxFiche <= 0) {
    return NextResponse.json({ error: `taux horaire absent sur la fiche de ${emp.nom} — corrige la fiche avant de saisir des heures` }, { status: 400 });
  }
  // NB : une feuille de temps saisie APRÈS le versement d'une paie est acceptée ici
  // volontairement — elle remonte ensuite comme « heures dues » (voir listerPaiePeriodes).
  // C'est la MODIFICATION et la SUPPRESSION d'heures déjà payées qui sont refusées.
  // Cohérence du jour (une requête) : plus de 24 h pour un employé le même jour, ou la
  // même entrée exacte créée il y a moins de deux minutes (double clic, réessai réseau).
  // Le doublon est toléré si l'écran a fourni une clé d'idempotence : c'est alors elle
  // qui tranche, et deux saisies volontaires portent deux clés différentes.
  const heures = Number(body.heures);
  const ctrl = await controlesSaisieHeures({ employe: emp.nom, date: body.date, projet_id: +body.projet_id, heures });
  if (ctrl.total_jour + heures > 24) {
    return NextResponse.json({ error: "plus de 24 h dans la journée", message: `${emp.nom} a déjà ${ctrl.total_jour} h le ${body.date} : ${heures} h de plus dépasseraient 24 h.` }, { status: 409 });
  }
  if (ctrl.doublons_recents > 0 && !cleIdempotence(req)) {
    return NextResponse.json({ error: "doublon probable", message: `Une entrée identique (${emp.nom}, ${heures} h, ce projet, le ${body.date}) vient d'être enregistrée il y a moins de deux minutes. Recharge la liste avant de ressaisir.` }, { status: 409 });
  }
  const user = await utilisateurActif(req);
  const id = await ajouterHeureProjet({ ...body, employe: emp.nom, taux_horaire: tauxFiche, ajoute_par: user || undefined });
  journaliser("heures.ajoutees", {
    ref_type: "heures", ref_id: id, utilisateur: user || undefined,
    description: `${body.employe || "?"} · ${body.heures}h · projet ${body.projet_id} · ${body.date}`,
    apres: { projet_id: body.projet_id, date: body.date, heures: body.heures, employe: emp.nom, taux_horaire: tauxFiche },
    ip: ipDe(req),
  });
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || !body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const err = valider(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  // Snapshot avant modification pour audit
  const avant = await getHeureProjet(+body.id);
  if (!avant) return NextResponse.json({ error: "entrée introuvable" }, { status: 404 });
  // Une paie VERSÉE ne bouge plus — ni l'entrée qu'on en sort (AVANT), ni celle qu'on y
  // ferait entrer (APRÈS : nouvelle date ou nouvel employé). DELETE le refusait déjà ;
  // PATCH laissait passer.
  const employeApres = body.employe !== undefined ? String(body.employe || "") : avant.employe;
  const dateApres = body.date !== undefined ? String(body.date || "") : avant.date;
  if (await heureDansPaiePayee(avant.employe, avant.date) || await heureDansPaiePayee(employeApres, dateApres)) {
    return NextResponse.json({ error: "paie déjà versée", message: `Ces heures (${avant.employe}, ${String(avant.date).slice(0, 10)}) font partie d'une paie DÉJÀ VERSÉE, ou y entreraient : les modifier fausserait le talon remis à l'employé et la banque d'heures.` }, { status: 409 });
  }
  // Le chantier visé (nouveau ou inchangé) doit encore accepter une saisie.
  const projetVise = body.projet_id !== undefined ? body.projet_id : avant.projet_id;
  const ref = await projetPourSaisie(projetVise);
  if (!ref || !ref.existe) return NextResponse.json({ error: "projet introuvable" }, { status: 400 });
  const refus = refusSaisie(ref.projet);
  if (refus) return NextResponse.json({ error: "saisie refusée", message: refus }, { status: 409 });
  // Plafond de 24 h par jour et par employé, l'entrée modifiée exclue du cumul.
  if (body.heures !== undefined || body.date !== undefined || body.employe !== undefined) {
    const heuresApres = body.heures !== undefined ? Number(body.heures) : Number(avant.heures || 0);
    const ctrl = await controlesSaisieHeures({ employe: employeApres, date: dateApres, projet_id: +projetVise, heures: heuresApres, exclureId: +body.id });
    if (ctrl.total_jour + heuresApres > 24) {
      return NextResponse.json({ error: "plus de 24 h dans la journée", message: `${employeApres} aurait ${ctrl.total_jour + heuresApres} h le ${dateApres}.` }, { status: 409 });
    }
  }
  // Verrouillage optimiste (B7) : si le client fournit `version`, on refuse (409) si
  // la ligne a changé entre-temps, au lieu d'écraser silencieusement.
  const res = await modifierHeureProjet(+body.id, body, body.version);
  if (!res.ok) {
    if (res.conflit) return NextResponse.json({ error: "conflit", message: "Cette entrée a été modifiée par quelqu'un d'autre entre-temps. Recharge la liste avant de sauvegarder.", versionActuelle: res.versionActuelle }, { status: 409 });
    return NextResponse.json({ error: "entrée introuvable" }, { status: 404 });
  }
  const apres = await getHeureProjet(+body.id);
  journaliser("heures.modifiees", {
    ref_type: "heures", ref_id: body.id,
    description: `${avant.employe || "?"} · ${avant.heures}h → ${apres?.heures}h sur ${apres?.date}`,
    avant: { date: avant.date, heures: avant.heures, employe: avant.employe, projet_id: avant.projet_id, taux_horaire: avant.taux_horaire, description: avant.description },
    apres: { date: apres?.date, heures: apres?.heures, employe: apres?.employe, projet_id: apres?.projet_id, taux_horaire: apres?.taux_horaire, description: apres?.description },
    ip: ipDe(req),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  // Snapshot avant suppression pour traçabilité paie/audit
  const avant = await getHeureProjet(+id);
  // Refus si ces heures sont couvertes par une paie déjà versée.
  const res = await supprimerHeureProjet(+id);
  if (!res.ok) return NextResponse.json({ error: res.raison }, { status: 409 });
  journaliser("heures.supprimees", {
    ref_type: "heures", ref_id: id,
    description: `${avant?.employe || "?"} · ${avant?.heures}h sur ${avant?.date}`,
    avant: avant ? { date: avant.date, heures: avant.heures, employe: avant.employe, projet_id: avant.projet_id, taux_horaire: avant.taux_horaire } : null,
    ip: ipDe(req),
  });
  return NextResponse.json({ ok: true });
}

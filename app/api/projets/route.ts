import { NextRequest, NextResponse } from "next/server";
import { listerProjets, listerProjetsLite, listerProjetsAFacturer, getProjet, ajouterProjet, modifierProjet, supprimerProjet, trouverOuCreerClient, clientParNom, charger } from "@/lib/db";
import { envoyerPushUtilisateur } from "@/lib/push";
import { STATUTS_PROJET, transitionPermise, estReouverture } from "@/lib/statuts-projet";
import { aujourdhuiMontreal } from "@/lib/date";
import { utilisateurActif } from "@/lib/authUser";
import { journaliser } from "@/lib/audit";
import { courrielValide } from "@/lib/vocabulaire";
import { avertirProjetComplete, destinataireNotifications } from "@/lib/notif-projet";
import { publicOrigin } from "@/lib/origin";
import { validerEtNormaliserProjet } from "@/lib/validation-projet";

// Statuts reconnus par l'app (filtres, CA, dashboard). Un statut hors liste rendait
// le projet invisible des filtres ET du CA — silencieusement.
const STATUTS_VALIDES = new Set<string>(STATUTS_PROJET);
function statutInvalide(statut: any): boolean {
  return statut !== undefined && statut !== null && !STATUTS_VALIDES.has(String(statut));
}

function ok(data: any, init?: ResponseInit) {
  // no-store : les chiffres (marge, coûts) doivent toujours être frais après
  // ajout d'heures/dépenses. Pas de cache navigateur ni CDN.
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store, max-age=0", ...(init?.headers || {}) } });
}
// Message GÉNÉRIQUE au client : le détail (SQL, chemin, table) reste dans le journal serveur.
// Exception : un numéro de projet déjà pris (index UNIQUE) est un refus délibéré → 409 lisible.
function fail(e: any, status = 500) {
  if (e?.code === "NUMERO_PROJET_PRIS") return NextResponse.json({ error: "numéro déjà pris", message: e.message }, { status: 409 });
  console.error("[/api/projets]", e);
  return NextResponse.json({ error: "Erreur serveur" }, { status });
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
    if (statutInvalide(body.statut)) return NextResponse.json({ error: `statut invalide : ${body.statut}` }, { status: 400 });
    if (!String(body.nom || "").trim()) return NextResponse.json({ error: "nom requis" }, { status: 400 });
    // Bornes + conversion des montants et dates AVANT l'écriture (lib/validation-projet.ts) :
    // le corps brut passait tel quel, « 12 500,00 $ » finissait en TEXTE dans prix_contrat.
    const invalide = validerEtNormaliserProjet(body);
    if (invalide) return NextResponse.json({ error: invalide }, { status: 400 });
    // Client créé au passage, AVEC ses coordonnées si elles sont fournies. Avant, seul le
    // nom était transmis : la fiche naissait vide, sans téléphone ni courriel, et il
    // fallait retourner dans le CRM la compléter — donc la relance et l'envoi de contrat
    // ne pouvaient pas partir depuis le projet.
    let clientCree = false;
    if (!body.client_id && body.client_nom) {
      if (!courrielValide(body.client_courriel)) {
        return NextResponse.json({ error: `courriel du client invalide « ${body.client_courriel} »` }, { status: 400 });
      }
      const avant = await clientParNom(body.client_nom);
      body.client_id = await trouverOuCreerClient(body.client_nom, {
        telephone: body.client_telephone || undefined,
        courriel: body.client_courriel || undefined,
        // À défaut d'adresse de client, celle du chantier : c'est la même dans
        // l'écrasante majorité des dossiers, et une fiche sans adresse ne sert à rien.
        adresse: body.client_adresse || body.adresse_chantier || undefined,
        statut: "actif",
        source: body.client_source || undefined,
      } as any);
      clientCree = !avant && !!body.client_id;
    }
    const user = await utilisateurActif(req);
    const id = await ajouterProjet({ ...body, cree_par: user || undefined });
    journaliser("projet.cree", { ref_type: "projet", ref_id: id, utilisateur: user || undefined, description: body.nom || `Projet #${id}` });
    // `client_cree` remonte à l'écran pour qu'il puisse le dire : créer une fiche client
    // au passage est un effet de bord, il ne doit pas être invisible.
    return ok({ ok: true, id, client_id: body.client_id || null, client_cree: clientCree });
  } catch (e) { return fail(e); }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    if (statutInvalide(body.statut)) return NextResponse.json({ error: `statut invalide : ${body.statut}` }, { status: 400 });
    if (body.nom !== undefined && !String(body.nom || "").trim()) return NextResponse.json({ error: "nom requis" }, { status: 400 });
    const invalide = validerEtNormaliserProjet(body);
    if (invalide) return NextResponse.json({ error: invalide }, { status: 400 });
    const user = await utilisateurActif(req);
    const avant = await getProjet(+body.id);
    if (!avant) return NextResponse.json({ error: "projet introuvable" }, { status: 404 });
    // Table des transitions (lib/statuts-projet.ts) : un annulé ne redevient pas complété
    // d'un clic, un complété ne s'annule pas, un « à venir » ne se complète pas d'un coup.
    if (body.statut !== undefined && body.statut !== null && !transitionPermise(avant.statut, String(body.statut))) {
      return NextResponse.json({ error: "transition refusée", message: `Un projet « ${avant.statut || "?"} » ne peut pas passer à « ${body.statut} ».` }, { status: 409 });
    }
    const nouvelleCompletion = body.statut === "complete" && avant.statut !== "complete";
    if (nouvelleCompletion) {
      // Pose la date de fin réelle (reconnaissance du CA). Règle : complété = facturé.
      if (body.date_fin_reelle === undefined) body.date_fin_reelle = aujourdhuiMontreal();
      body.facturee = 1;
    }
    // Réouverture d'un chantier complété : il redevient un chantier à facturer, sans
    // date de fin — sinon il resterait compté dans le CA reconnu avec une fin fictive.
    if (body.statut !== undefined && estReouverture(avant.statut, String(body.statut))) {
      body.facturee = 0;
      body.date_fin_reelle = null;
    }
    await modifierProjet(body.id, { ...body, modifie_par: user });
    journaliser("projet.statut_change", { ref_type: "projet", ref_id: body.id, utilisateur: user || undefined, description: `Modif ${Object.keys(body).filter(k => k !== "id").join(", ")}` });
    // Avis à Francis : projet complété et marqué facturé.
    if (nouvelleCompletion) {
      const valeur = (avant as any)?.prix_contrat || (avant as any)?.budget_estime || 0;
      envoyerPushUtilisateur("Francis", {
        title: "✅ Projet complété",
        body: `« ${avant.nom || "Projet"} » est complété et marqué facturé${valeur ? ` (${(+valeur).toLocaleString("fr-CA")} $)` : ""}.`,
        url: `/projets/${body.id}`,
        tag: "complete-" + body.id,
      }).catch(() => {});

      // Courriel d'avis à la boîte interne. Relu APRÈS l'écriture : `avant` n'a ni la
      // date de fin qu'on vient de poser, ni les derniers totaux. L'envoi est détaché
      // (pas de `await`) et ne lève jamais — un courriel raté ne doit pas faire échouer
      // la fermeture du chantier, qui est le geste demandé. L'issue est journalisée
      // pour qu'un envoi muet reste traçable.
      const origine = publicOrigin(req);
      getProjet(+body.id)
        .then((apres) => avertirProjetComplete((apres || avant) as any, origine, user))
        .then((r) => journaliser(r.ok ? "projet.avis_courriel" : "projet.avis_courriel_echec", {
          ref_type: "projet", ref_id: +body.id, utilisateur: user || undefined,
          description: r.ok ? `Avis envoyé à ${destinataireNotifications()}` : `Avis NON envoyé : ${r.raison}`,
        }))
        .catch(() => {});
    }
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
    const user = await utilisateurActif(req);
    const supp = await supprimerProjet(+id);
    if (!supp.ok) return NextResponse.json({ error: supp.raison }, { status: 409 });
    journaliser("projet.supprime", { ref_type: "projet", ref_id: id, utilisateur: user || undefined, description: `Suppression projet #${id}` });
    return ok({ ok: true });
  } catch (e) { return fail(e); }
}

function formatCAD(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(n);
}

import { NextRequest, NextResponse } from "next/server";
import { sauvegarder, lister, charger, supprimer, changerStatut, enregistrerHeuresReelles, statistiques, trouverOuCreerClient, clientParNom } from "@/lib/db";
import { journaliser } from "@/lib/audit";
import { courrielValide } from "@/lib/vocabulaire";
import { calculerSoumission } from "@/lib/calculateur";

import { ipClient } from "@/lib/ip";
const ipDe = (req: NextRequest) => ipClient(req);
// Message GÉNÉRIQUE au client : le détail (SQL, chemin, table) reste dans le journal serveur.
function fail(e: any, status = 500) { console.error("[/api/soumissions]", e); return NextResponse.json({ error: "Erreur serveur" }, { status }); }

/** Le total d'une soumission se RECALCULE ici, depuis ses lignes : le `total` envoyé par
 *  le navigateur est ignoré dès que `data` est calculable. Sinon un client (ou un écran
 *  périmé) pouvait enregistrer un total sans rapport avec les lignes — et c'est ce total
 *  qui alimente les statistiques, le CA prévisionnel et la page publique. */
function totalServeur(body: any): { total: number; recalcule: boolean } {
  const d = body?.data;
  if (d && typeof d === "object" && Array.isArray(d.lignes)) {
    try {
      const c = calculerSoumission({
        lignes: d.lignes,
        fraisActifs: Array.isArray(d.fraisActifs) ? d.fraisActifs : [],
        fraisGestion: Number.isFinite(Number(d.fraisGestion)) ? Number(d.fraisGestion) : 0,
        appliquerTaxes: !!d.appliquerTaxes,
      });
      return { total: c.total, recalcule: true };
    } catch (e) {
      console.warn("[/api/soumissions] total non recalculable, total reçu conservé :", (e as Error)?.message);
    }
  } else {
    console.warn(`[/api/soumissions] soumission ${body?.numero || "(nouvelle)"} sans data.lignes : total reçu conservé (${body?.total})`);
  }
  const t = Number(body?.total);
  return { total: Number.isFinite(t) ? t : 0, recalcule: false };
}

export async function GET(req: NextRequest) {
  try {
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
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object") return NextResponse.json({ error: "payload invalide" }, { status: 400 });
    const nouveau = !body.numero;

    // Fiche client créée au passage, comme à la création d'un projet. Une soumission
    // porte déjà toutes les coordonnées du client (nom, adresse, téléphone, courriel)
    // mais ne créait AUCUNE fiche CRM : le prospect n'existait nulle part, donc ni
    // relance, ni pipeline, ni contrat possible sans le ressaisir à la main.
    // Uniquement à la CRÉATION : modifier une soumission ne doit pas créer de fiche.
    let clientCree = false;
    let clientId: number | null = null;
    const c = body.client || {};
    if (nouveau && c.nom?.trim()) {
      if (!courrielValide(c.courriel)) {
        return NextResponse.json({ error: `courriel du client invalide « ${c.courriel} »` }, { status: 400 });
      }
      const avant = await clientParNom(c.nom);
      clientId = await trouverOuCreerClient(c.nom, {
        telephone: c.telephone || undefined,
        courriel: c.courriel || undefined,
        adresse: c.adresse || undefined,
        // Une soumission, c'est un prospect au tout début du pipeline — pas un client
        // actif. Le statut suit quand le contrat est signé.
        statut: "prospect",
        pipeline_stage: "info_1",
      } as any);
      clientCree = !avant && !!clientId;
    }

    const { total } = totalServeur(body);
    const numero = await sauvegarder({ ...body, total });
    journaliser(nouveau ? "soumission.creee" : "soumission.modifiee", {
      ref_type: "soumission", ref_id: numero,
      description: `${body.client?.nom || "?"} · ${total ? total + " $" : "0 $"}`,
      ip: ipDe(req), user_agent: req.headers.get("user-agent") || undefined,
    });
    return NextResponse.json({ numero, ok: true, client_id: clientId, client_cree: clientCree });
  } catch (e: any) {
    // Refus métier (soumission signée) ≠ panne. 409 pour que l'écran affiche le motif
    // au lieu de « erreur serveur », et pour ne pas polluer le suivi d'incidents.
    if (e?.code === "SOUMISSION_SIGNEE") {
      return NextResponse.json({ error: "soumission signée", message: e.message }, { status: 409 });
    }
    return fail(e);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.numero) return NextResponse.json({ error: "numero requis" }, { status: 400 });
    if (body.statut) {
      await changerStatut(body.numero, body.statut);
      const map: Record<string, any> = {
        envoyee: "soumission.envoyee", acceptee: "soumission.acceptee",
        refusee: "soumission.refusee", facturee: "soumission.facturee",
      };
      journaliser(map[body.statut] || "soumission.statut_change", {
        ref_type: "soumission", ref_id: body.numero,
        description: `Statut → ${body.statut}`,
        apres: { statut: body.statut },
        ip: ipDe(req),
      });
    }
    if (body.heuresReelles !== undefined) await enregistrerHeuresReelles(body.numero, body.heuresReelles);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // Statut inconnu, ou retour en arrière sur une soumission signée : refus métier,
    // pas panne serveur. 409 pour que l'écran affiche le motif.
    if (e?.code === "STATUT_INVALIDE" || e?.code === "SOUMISSION_SIGNEE") {
      return NextResponse.json({ error: "changement refusé", message: e.message }, { status: 409 });
    }
    return fail(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const numero = req.nextUrl.searchParams.get("numero");
    if (!numero) return NextResponse.json({ error: "numero requis" }, { status: 400 });
    await supprimer(numero);
    journaliser("soumission.supprimee", {
      ref_type: "soumission", ref_id: numero,
      description: `Suppression définitive`, ip: ipDe(req),
    });
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}

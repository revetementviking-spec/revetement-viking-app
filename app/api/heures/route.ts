import { NextRequest, NextResponse } from "next/server";
import { listerHeuresProjet, ajouterHeureProjet, supprimerHeureProjet, modifierHeureProjet, listerToutesHeures, getHeureProjet } from "@/lib/db";
import { journaliser } from "@/lib/audit";

function ipDe(req: NextRequest) { return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined; }

/** Validation souple : on coerce les types et on rejette uniquement les valeurs aberrantes.
 *  La validation stricte de types était trop agressive — bloquait des saisies légitimes. */
const RX_DATE = /^\d{4}-\d{2}-\d{2}$/;
function valider(body: any): string | null {
  if (!body || typeof body !== "object") return "payload invalide";
  if (body.date !== undefined && body.date !== null) {
    if (typeof body.date !== "string" || !RX_DATE.test(body.date)) return "date doit être au format YYYY-MM-DD";
  }
  if (body.heures !== undefined && body.heures !== null) {
    const h = Number(body.heures);
    if (!isFinite(h)) return "heures doit être un nombre";
    if (h > 24) return "heures > 24 sur une seule entrée (utiliser 2 entrées séparées pour 2 jours)";
  }
  return null;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const projet_id = sp.get("projet_id");
  if (projet_id) return NextResponse.json(await listerHeuresProjet(+projet_id));
  const filtres: any = {};
  if (sp.get("employe")) filtres.employe = sp.get("employe");
  if (sp.get("depuis")) filtres.depuis = sp.get("depuis");
  if (sp.get("jusqu_a")) filtres.jusqu_a = sp.get("jusqu_a");
  return NextResponse.json(await listerToutesHeures(filtres));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.projet_id || !body.date || !body.heures) {
    return NextResponse.json({ error: "projet_id, date et heures requis" }, { status: 400 });
  }
  const err = valider(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  const id = await ajouterHeureProjet(body);
  await journaliser("heures.ajoutees", {
    ref_type: "heures", ref_id: id,
    description: `${body.employe || "?"} · ${body.heures}h · projet ${body.projet_id} · ${body.date}`,
    apres: { projet_id: body.projet_id, date: body.date, heures: body.heures, employe: body.employe, taux_horaire: body.taux_horaire },
    ip: ipDe(req),
  });
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const err = valider(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  // Snapshot avant modification pour audit
  const avant = await getHeureProjet(+body.id);
  if (!avant) return NextResponse.json({ error: "entrée introuvable" }, { status: 404 });
  await modifierHeureProjet(+body.id, body);
  const apres = await getHeureProjet(+body.id);
  await journaliser("heures.ajoutees", {
    ref_type: "heures", ref_id: body.id,
    description: `MODIF · ${avant.employe || "?"} · ${avant.heures}h → ${apres?.heures}h sur ${apres?.date}`,
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
  await supprimerHeureProjet(+id);
  await journaliser("heures.ajoutees", {
    ref_type: "heures", ref_id: id,
    description: `SUPPRESSION · ${avant?.employe || "?"} · ${avant?.heures}h sur ${avant?.date}`,
    avant: avant ? { date: avant.date, heures: avant.heures, employe: avant.employe, projet_id: avant.projet_id, taux_horaire: avant.taux_horaire } : null,
    ip: ipDe(req),
  });
  return NextResponse.json({ ok: true });
}

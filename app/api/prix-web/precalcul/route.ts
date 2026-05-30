import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Cron nuit (3h du matin) : pré-calcul les prix des matériaux les plus utilisés.
 *  Force un refresh du cache pour qu'ils soient frais le matin. */
const PRODUITS_USUELS = [
  { nom: "Maibec Statera cèdre blanc 6\"", code: "MAIBEC-STATERA-6", fournisseur: "Maibec" },
  { nom: "Canexel Ridgewood 8.25\"", code: "CANEXEL-RIDGE-825", fournisseur: "Canexel" },
  { nom: "James Hardie HardiePlank 8.25\"", code: "HARDIE-PLANK-825", fournisseur: "James Hardie" },
  { nom: "Tyvek HomeWrap rouleau", code: "TYVEK-HOMEWRAP", fournisseur: "DuPont" },
  { nom: "Gentek Sentinel Plus D4D vinyle", code: "GENTEK-SENT-D4D", fournisseur: "Gentek" },
  { nom: "Calfeutrant OSI Quad Max 295ml", code: "OSI-QUAD-MAX", fournisseur: "OSI" },
];

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }

  const base = req.nextUrl.origin;
  const resultats: any[] = [];
  for (const p of PRODUITS_USUELS) {
    try {
      const r = await fetch(`${base}/api/prix-web`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p, force: true }),
      });
      const d = await r.json();
      resultats.push({ code: p.code, ok: r.ok, prix: d.prix_moyen_estime });
    } catch (e: any) {
      resultats.push({ code: p.code, ok: false, erreur: e?.message });
    }
  }
  return NextResponse.json({ ok: true, traite: resultats.length, resultats });
}

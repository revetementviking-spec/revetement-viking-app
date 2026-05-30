import { NextRequest, NextResponse } from "next/server";
import { getProjet, getClient } from "@/lib/db";
import { verifierTokenProjet } from "@/lib/lien-public";

/** API publique pour mode présentation client.
 * GET /api/projet-public?id=X&token=Y → renvoie infos limités + photos.
 * Pas d'auth, mais token HMAC obligatoire. */
export async function GET(req: NextRequest) {
  const id = +(req.nextUrl.searchParams.get("id") || 0);
  const token = req.nextUrl.searchParams.get("token") || "";
  if (!id || !token) return NextResponse.json({ error: "id+token requis" }, { status: 400 });
  const ok = await verifierTokenProjet(id, token);
  if (!ok) return NextResponse.json({ error: "token invalide" }, { status: 403 });
  const p = await getProjet(id);
  if (!p) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  const client = p.client_id ? await getClient(p.client_id) : null;
  // Données limitées (pas de coûts, marge, etc.)
  return NextResponse.json({
    nom: p.nom,
    adresse_chantier: p.adresse_chantier,
    description: p.description,
    date_debut: p.date_debut,
    date_fin_prevue: p.date_fin_prevue,
    statut: p.statut,
    client_nom: client?.nom || null,
  });
}

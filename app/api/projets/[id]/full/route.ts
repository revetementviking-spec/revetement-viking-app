import { NextRequest, NextResponse } from "next/server";
import { getProjet, listerHeuresProjet, listerDepensesProjet, listerPhotosChantier } from "@/lib/db";

// Endpoint combiné : tout ce qu'il faut pour la page détail d'un projet en 1 seul
// aller-retour réseau (au lieu de 4 requêtes séparées). Gros gain sur mobile.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const pid = +id;
    const [projet, heures, depenses, photos] = await Promise.all([
      getProjet(pid),
      listerHeuresProjet(pid),
      listerDepensesProjet(pid),
      listerPhotosChantier(pid, { sansData: true }),
    ]);
    if (!projet) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ projet, heures, depenses, photos }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (e: any) {
    console.error("[/api/projets/[id]/full]", e);
    return NextResponse.json({ error: e?.message || "Erreur serveur" }, { status: 500 });
  }
}

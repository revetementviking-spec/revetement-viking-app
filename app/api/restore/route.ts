// Validation d'un fichier de backup JSON — DRY RUN uniquement
// Ne touche pas la DB. Vérifie la structure et compte les enregistrements.
// Le vrai restore demandera une étape supplémentaire (à venir).
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CHAMPS_ATTENDUS = ["soumissions", "clients", "projets", "employes", "heures", "depenses", "contrats", "paies", "biblio"];

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    if (!b || typeof b !== "object") {
      return NextResponse.json({ ok: false, error: "JSON invalide" }, { status: 400 });
    }
    const erreurs: string[] = [];
    const compte: Record<string, number> = {};
    for (const c of CHAMPS_ATTENDUS) {
      if (!Array.isArray(b[c])) erreurs.push(`Champ manquant ou non-array : ${c}`);
      else compte[c] = b[c].length;
    }
    const meta = {
      date_backup: b.date_backup || "—",
      version: b.version || 0,
      app: b.app || "—",
    };
    const total = Object.values(compte).reduce((s, n) => s + n, 0);
    return NextResponse.json({
      ok: erreurs.length === 0,
      mode: "validation-seulement",
      meta,
      compte,
      total,
      erreurs,
      message: erreurs.length === 0
        ? `✓ Backup valide — ${total} enregistrements répartis sur ${Object.keys(compte).length} tables.`
        : `⚠ Structure incomplète — ${erreurs.length} erreur(s).`,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

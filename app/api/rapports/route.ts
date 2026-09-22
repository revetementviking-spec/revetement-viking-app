import { NextRequest, NextResponse } from "next/server";
import { heuresParProjetDate, listerProjets } from "@/lib/db";
import { celluleCSV } from "@/lib/csv";

// Chaque cellule passe par celluleCSV : formule neutralisée (=, +, -, @…) et guillemets
// doublés. Avant, une description « =HYPERLINK(...) » partait telle quelle et s'exécutait
// dans le tableur de celui qui ouvrait l'export.
const ligne = (cellules: any[]) => cellules.map(celluleCSV).join(",");

export async function GET(req: NextRequest) {
  const projet_id = req.nextUrl.searchParams.get("projet_id");
  const format = req.nextUrl.searchParams.get("format") || "json";

  if (projet_id) {
    const lignes = await heuresParProjetDate(+projet_id);
    if (format === "csv") {
      const csv = [ligne(["Employé", "Date", "Heures", "Taux $/h", "Coût", "Description"])]
        .concat(lignes.map((l) => ligne([l.employe, l.date, l.heures, l.taux_horaire, +(l.heures * l.taux_horaire).toFixed(2), l.description || ""])))
        .join("\n");
      return new NextResponse(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="heures-projet-${+projet_id || 0}.csv"` },
      });
    }
    return NextResponse.json(lignes);
  }

  // Sinon : tous les projets résumés
  const projets = await listerProjets();
  if (format === "csv") {
    const csv = [ligne(["Projet", "Client", "Statut", "Budget", "Coût total", "Marge", "Marge %", "Heures", "Facturé", "Payé"])]
      .concat(projets.map((p) => ligne([
        p.nom, p.client_nom || "", p.statut, p.budget_estime || 0, +p.cout_total.toFixed(2), +p.marge.toFixed(2),
        +p.marge_pct.toFixed(1), +p.total_heures.toFixed(1), p.total_facture, p.total_paye,
      ])))
      .join("\n");
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rapport-projets.csv"` },
    });
  }
  return NextResponse.json(projets);
}

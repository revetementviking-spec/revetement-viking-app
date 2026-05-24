import { NextRequest, NextResponse } from "next/server";
import { heuresParProjetDate, listerProjets } from "@/lib/db";

export async function GET(req: NextRequest) {
  const projet_id = req.nextUrl.searchParams.get("projet_id");
  const format = req.nextUrl.searchParams.get("format") || "json";

  if (projet_id) {
    const lignes = await heuresParProjetDate(+projet_id);
    if (format === "csv") {
      const csv = ["Employé,Date,Heures,Taux $/h,Coût,Description"]
        .concat(lignes.map((l) => `"${l.employe}","${l.date}",${l.heures},${l.taux_horaire},${(l.heures * l.taux_horaire).toFixed(2)},"${(l.description || "").replace(/"/g, "'")}"`))
        .join("\n");
      return new NextResponse(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="heures-projet-${projet_id}.csv"` },
      });
    }
    return NextResponse.json(lignes);
  }

  // Sinon : tous les projets résumés
  const projets = await listerProjets();
  if (format === "csv") {
    const csv = ["Projet,Client,Statut,Budget,Coût total,Marge,Marge %,Heures,Facturé,Payé"]
      .concat(projets.map((p) => `"${p.nom}","${p.client_nom || ""}","${p.statut}",${p.budget_estime || 0},${p.cout_total.toFixed(2)},${p.marge.toFixed(2)},${p.marge_pct.toFixed(1)},${p.total_heures.toFixed(1)},${p.total_facture},${p.total_paye}`))
      .join("\n");
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rapport-projets.csv"` },
    });
  }
  return NextResponse.json(projets);
}

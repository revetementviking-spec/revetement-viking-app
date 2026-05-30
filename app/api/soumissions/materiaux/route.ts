import { NextRequest, NextResponse } from "next/server";
import { charger } from "@/lib/db";

/** GET /api/soumissions/materiaux?numero=XXX
 *  Retourne la liste de matériaux agrégée depuis les articles de la soumission.
 *  Format: [{ description, quantite, unite, cout_unit, sous_total }, ...] + total. */
export async function GET(req: NextRequest) {
  try {
    const numero = req.nextUrl.searchParams.get("numero");
    if (!numero) return NextResponse.json({ error: "numero requis" }, { status: 400 });
    const s = await charger(numero);
    if (!s) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    const payload = JSON.parse(s.payload_json);
    const articles = (payload.articles || []) as any[];

    // Agrège par description (catégorie ≠ Main d'œuvre)
    const map = new Map<string, { description: string; quantite: number; unite: string; cout_unit: number; sous_total: number; categorie: string }>();
    for (const a of articles) {
      const cat = (a.categorie || "").toLowerCase();
      // Exclure main d'oeuvre / services
      if (cat.includes("œuvre") || cat.includes("oeuvre") || cat.includes("service") || cat.includes("main")) continue;
      const desc = (a.description || a.nom || "Article").trim();
      const qte = +a.quantite || 0;
      const unite = a.unite || "u";
      const cu = +a.cout_unit || +a.prix_unitaire || 0;
      if (!map.has(desc)) map.set(desc, { description: desc, quantite: 0, unite, cout_unit: cu, sous_total: 0, categorie: a.categorie || "Matériaux" });
      const m = map.get(desc)!;
      m.quantite += qte;
      m.sous_total += qte * cu;
    }
    const liste = Array.from(map.values()).sort((a, b) => a.description.localeCompare(b.description));
    const total = liste.reduce((s, m) => s + m.sous_total, 0);
    return NextResponse.json({
      numero,
      client: payload.client?.nom || "?",
      adresse: payload.client?.adresse_chantier || payload.client?.adresse || "",
      date: payload.date,
      liste,
      total,
      nb_articles: liste.length,
    });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}

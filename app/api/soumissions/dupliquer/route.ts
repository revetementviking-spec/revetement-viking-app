import { NextRequest, NextResponse } from "next/server";
import { sauvegarder, charger } from "@/lib/db";
import { journaliser } from "@/lib/audit";

/** Dupliquer une soumission existante : crée une nouvelle entrée avec un numéro neuf,
 * payload identique (articles, taux, etc.), statut "brouillon", date du jour. */
export async function POST(req: NextRequest) {
  try {
    const { numero } = await req.json();
    if (!numero) return NextResponse.json({ error: "numero requis" }, { status: 400 });
    const source = await charger(numero);
    if (!source) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    const payload = JSON.parse(source.payload_json);
    // Réinitialise les champs propres à la soumission source
    delete payload.numero;
    payload.statut = "brouillon";
    payload.date = new Date().toISOString().slice(0, 10);
    payload.signature_nom = undefined;
    payload.signature_date = undefined;
    payload.vue_client_le = undefined;
    if (payload.client) payload.client.nom = (payload.client.nom || "") + " (copie)";
    const nouveauNumero = await sauvegarder(payload);
    journaliser("soumission.dupliquee", { ref_type: "soumission", ref_id: nouveauNumero, description: `Dupliquée depuis ${numero}` });
    return NextResponse.json({ ok: true, numero: nouveauNumero });
  } catch (e: any) { return NextResponse.json({ error: e?.message }, { status: 500 }); }
}

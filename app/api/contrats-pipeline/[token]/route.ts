import { NextRequest, NextResponse } from "next/server";
import { getContratPipelineParToken, signerContratPipeline, getClient, marquerContratVu } from "@/lib/db";

export const dynamic = "force-dynamic";

function ipDe(req: NextRequest) { return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined; }

// GET — public (allowlistée dans proxy.ts) : retourne les méta + data_json (sans les PDF blobs)
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const c = await getContratPipelineParToken(token);
  if (!c) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  // Enregistre la première vue (preuve de transmission style DocuSign)
  marquerContratVu(token, ipDe(req)).catch(() => {});
  const cl = await getClient(c.client_id);
  return NextResponse.json({
    numero: c.numero,
    token: c.token,
    statut: c.statut,
    data: JSON.parse(c.data_json || "{}"),
    signature_nom: c.signature_nom,
    signature_date: c.signature_date,
    client_nom: cl?.nom,
    a_pdf_signe: !!c.pdf_signe,
  });
}

// POST — signature : { signature_dataurl, signature_nom, pdf_signe (base64 dataURL) }
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const b = await req.json();
  if (!b.signature_dataurl || !b.signature_nom || !b.pdf_signe) {
    return NextResponse.json({ error: "signature_dataurl, signature_nom, pdf_signe requis" }, { status: 400 });
  }
  const ok = await signerContratPipeline(token, {
    signature_dataurl: b.signature_dataurl,
    signature_nom: String(b.signature_nom).trim().slice(0, 120),
    pdf_signe: b.pdf_signe,
    ip: ipDe(req),
  });
  if (!ok) return NextResponse.json({ error: "déjà signé ou introuvable" }, { status: 409 });
  return NextResponse.json({ ok: true });
}

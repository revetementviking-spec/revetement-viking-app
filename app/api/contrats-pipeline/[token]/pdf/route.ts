import { NextRequest, NextResponse } from "next/server";
import { getPDFContratPipeline } from "@/lib/db";

export const dynamic = "force-dynamic";

// Sert le PDF brouillon ou signé. Public (token = secret partagé).
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const veutSigne = req.nextUrl.searchParams.get("signe") === "1";
  let pdf = await getPDFContratPipeline(token, veutSigne);
  if (!pdf && veutSigne) pdf = await getPDFContratPipeline(token, false); // fallback
  if (!pdf) return new NextResponse("Not found", { status: 404 });
  const m = String(pdf).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return new NextResponse("Invalid PDF", { status: 500 });
  const buf = Buffer.from(m[2], "base64");
  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      "Content-Type": m[1] || "application/pdf",
      "Content-Length": String(buf.length),
      "Content-Disposition": `inline; filename="contrat-${token.slice(0, 8)}${veutSigne ? "-signe" : ""}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { rechercheGlobale } from "@/lib/db";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  return NextResponse.json(await rechercheGlobale(q));
}

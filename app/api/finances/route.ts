import { NextRequest, NextResponse } from "next/server";
import { finances } from "@/lib/db";

export async function GET(req: NextRequest) {
  const annee = +(req.nextUrl.searchParams.get("annee") || new Date().getFullYear());
  return NextResponse.json(await finances(annee));
}

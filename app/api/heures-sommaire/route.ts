import { NextRequest, NextResponse } from "next/server";
import { heuresParEmploye } from "@/lib/db";

export async function GET(req: NextRequest) {
  const jours = +(req.nextUrl.searchParams.get("jours") || "7");
  const depuis = new Date(Date.now() - jours * 86400000).toISOString().slice(0, 10);
  return NextResponse.json(await heuresParEmploye(depuis));
}

import { NextRequest, NextResponse } from "next/server";
import { listerActivites } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  return NextResponse.json(
    await listerActivites({
      type: sp.get("type") || undefined,
      ref_type: sp.get("ref_type") || undefined,
      ref_id: sp.get("ref_id") || undefined,
      limit: sp.get("limit") ? Number(sp.get("limit")) : 200,
    })
  );
}

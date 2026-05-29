import { NextRequest, NextResponse } from "next/server";
import { utilisateurActif } from "@/lib/authUser";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await utilisateurActif(req);
  return NextResponse.json({ user });
}

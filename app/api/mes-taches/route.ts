import { NextRequest, NextResponse } from "next/server";
import { tachesPourUtilisateur } from "@/lib/db";
import { utilisateurActif } from "@/lib/authUser";

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get("user");
  const user = param || (await utilisateurActif(req));
  if (!user) return NextResponse.json([]);
  return NextResponse.json(await tachesPourUtilisateur(user));
}

import { NextRequest, NextResponse } from "next/server";
import { getParametre, setParametre } from "@/lib/db";

export const dynamic = "force-dynamic";

const COOKIE_BYPASS = "maint_bypass";

// État du mode maintenance + si CE navigateur a le droit de continuer (bypass).
export async function GET(req: NextRequest) {
  const actif = (await getParametre("maintenance")) === "1";
  const bypass = req.cookies.get(COOKIE_BYPASS)?.value === "1";
  return NextResponse.json({ actif, bypass });
}

// Active/désactive le mode maintenance. Le navigateur qui l'ACTIVE reçoit un cookie
// "bypass" pour pouvoir continuer à travailler pendant la maintenance.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const actif = !!body.actif;
  await setParametre("maintenance", actif ? "1" : "0");
  const res = NextResponse.json({ ok: true, actif });
  if (actif) {
    res.cookies.set(COOKIE_BYPASS, "1", { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/" });
  } else {
    res.cookies.delete(COOKIE_BYPASS);
  }
  return res;
}

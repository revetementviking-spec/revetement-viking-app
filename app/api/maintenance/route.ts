import { NextRequest, NextResponse } from "next/server";
import { getParametre, setParametre } from "@/lib/db";
import { signerValeur, verifierValeur } from "@/lib/session";

export const dynamic = "force-dynamic";

const COOKIE_BYPASS = "maint_bypass";
// Portée de signature : une valeur signée pour un autre usage (état OAuth) ne vaut pas ici.
const PORTEE = "maintenance";
const VALEUR_BYPASS = "1";

// État du mode maintenance + si CE navigateur a le droit de continuer (bypass).
// Le cookie est SIGNÉ (HMAC de lib/session.ts) : avant, poser soi-même `maint_bypass=1`
// suffisait à contourner la maintenance.
export async function GET(req: NextRequest) {
  const actif = (await getParametre("maintenance")) === "1";
  const bypass = (await verifierValeur(PORTEE, req.cookies.get(COOKIE_BYPASS)?.value)) === VALEUR_BYPASS;
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
    const signee = await signerValeur(PORTEE, VALEUR_BYPASS);
    if (signee) {
      res.cookies.set(COOKIE_BYPASS, signee, {
        httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7, path: "/",
      });
    }
  } else {
    res.cookies.delete(COOKIE_BYPASS);
  }
  return res;
}

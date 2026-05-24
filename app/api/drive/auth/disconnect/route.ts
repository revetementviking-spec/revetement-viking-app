import { NextResponse } from "next/server";
import { deleteOAuthTokens } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST() {
  await deleteOAuthTokens("google_drive");
  return NextResponse.json({ ok: true });
}

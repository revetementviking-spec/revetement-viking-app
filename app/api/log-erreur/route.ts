import { ipClient } from "@/lib/ip";
// Sentry-light : stocke les erreurs client envoyées par error.tsx dans une table dédiée
// (écriture partagée avec les jobs serveur : lib/erreurs-client.ts).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimitDepasse } from "@/lib/rateLimit";
import { enregistrerErreurClient } from "@/lib/erreurs-client";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = ipClient(req);
    // Anti-DOS : max 20 erreurs / 10 min / IP
    if (await rateLimitDepasse("client.erreur_log", ip, 20, 10)) {
      return NextResponse.json({ ok: false, error: "rate-limited" }, { status: 429 });
    }
    const b = await req.json();
    // Cap taille payload pour éviter remplissage table
    if (JSON.stringify(b).length > 8000) {
      return NextResponse.json({ ok: false, error: "payload too large" }, { status: 413 });
    }
    const ok = await enregistrerErreurClient({ message: b.message, stack: b.stack, digest: b.digest, path: b.path, userAgent: b.userAgent });
    return NextResponse.json({ ok });
  } catch {
    return NextResponse.json({ ok: false });
  }
}

export async function GET() {
  try {
    const c = db();
    const r = await c.execute("SELECT * FROM erreurs_client ORDER BY id DESC LIMIT 50");
    return NextResponse.json(r.rows);
  } catch {
    return NextResponse.json([]);
  }
}

// Sentry-light : stocke les erreurs client envoyées par error.tsx dans une table dédiée
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const c = db();
    await c.execute({
      sql: `CREATE TABLE IF NOT EXISTS erreurs_client (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        message TEXT,
        stack TEXT,
        digest TEXT,
        path TEXT,
        user_agent TEXT
      )`,
      args: [],
    });
    await c.execute({
      sql: `INSERT INTO erreurs_client (date, message, stack, digest, path, user_agent) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        new Date().toISOString(),
        (b.message || "").slice(0, 1000),
        (b.stack || "").slice(0, 4000),
        b.digest || null,
        b.path || null,
        b.userAgent || null,
      ],
    });
    return NextResponse.json({ ok: true });
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

import { NextRequest, NextResponse } from "next/server";
import { utilisateurActif } from "@/lib/authUser";
import { envoyerPushUtilisateur, pushEstConfigure } from "@/lib/push";

export const dynamic = "force-dynamic";

/** Envoie une notif push de test à l'utilisateur connecté. */
export async function POST(req: NextRequest) {
  const user = await utilisateurActif(req);
  if (!user) return NextResponse.json({ error: "non connecté" }, { status: 401 });
  if (!pushEstConfigure()) return NextResponse.json({ ok: false, raison: "push_non_configure" });
  const r = await envoyerPushUtilisateur(user, {
    title: "🛡️ Revêtement Viking",
    body: `Bonjour ${user} ! Test de notification réussi.`,
    url: "/clients",
    tag: "viking-test",
  });
  return NextResponse.json({ ok: true, ...r });
}

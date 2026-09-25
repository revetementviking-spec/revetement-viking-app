// Envoi par l'app du courriel de demande d'avis Google au client d'un projet.
// Le texte et les liens vivent dans lib/demande-avis.ts (partagés avec la fiche projet,
// qui propose aussi Gmail et l'app courriel du téléphone quand l'envoi serveur n'est pas
// configuré — RESEND_FROM absent en production, par exemple).
import { NextRequest, NextResponse } from "next/server";
import { getProjet } from "@/lib/db";
import { sendEmail, emailEstConfigure } from "@/lib/email";
import { journaliser } from "@/lib/audit";
import { messageDemandeAvis, SUJET_DEMANDE_AVIS, VIKING_EMAIL } from "@/lib/demande-avis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const projet_id = body?.projet_id;
    if (!projet_id) return NextResponse.json({ error: "projet_id requis" }, { status: 400 });
    const p = await getProjet(+projet_id);
    if (!p) return NextResponse.json({ error: "projet introuvable" }, { status: 404 });
    const courriel = (p as any).client_courriel;
    if (!courriel) return NextResponse.json({ ok: false, raison: "pas_de_courriel" });

    if (!emailEstConfigure()) {
      // Pas d'expéditeur utilisable : l'écran propose Gmail ou l'app courriel. Ce n'est
      // pas une erreur serveur (200), c'est un état de configuration.
      return NextResponse.json({ ok: false, raison: "non_configure", message: "Envoi par l'app non configuré (RESEND_FROM absent) — utilise Gmail ou l'app courriel." });
    }

    const r = await sendEmail({
      to: courriel,
      subject: SUJET_DEMANDE_AVIS,
      text: messageDemandeAvis((p as any).client_nom),
      replyTo: VIKING_EMAIL,
    });
    if (r.ok) {
      journaliser("soumission.statut_change", {
        ref_type: "projet", ref_id: projet_id,
        description: `✉️ Courriel d'avis Google envoyé à ${courriel}`,
      });
      return NextResponse.json({ ok: true, to: courriel });
    }
    return NextResponse.json({ ok: false, error: r.error || r.raison }, { status: 500 });
  } catch (e: any) {
    console.error("[email/review]", e);
    return NextResponse.json({ ok: false, error: "envoi impossible" }, { status: 500 });
  }
}

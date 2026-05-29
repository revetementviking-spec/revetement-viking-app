// Envoie automatiquement le courriel de demande d'avis Google au client d'un projet.
import { NextRequest, NextResponse } from "next/server";
import { getProjet } from "@/lib/db";
import { sendEmail, emailEstConfigure } from "@/lib/email";
import { journaliser } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIKING_EMAIL = "revetementviking@gmail.com";

function corpsReview(prenom?: string): string {
  return `Bonjour${prenom ? " " + prenom : ""},

Les travaux sont maintenant complets.

Si vous avez apprécié notre service vous pouvez nous laisser un avis sur notre page, c'est toujours grandement apprécié.

Voici le lien : https://g.page/r/CY_Ub0jeQKebEB0/review

Page Google : Revêtement Viking Inc.

Au plaisir de refaire affaire avec vous dans le futur.

Cordialement,

Revêtement Viking Inc.
${VIKING_EMAIL}
(438) 493-2041`;
}

export async function POST(req: NextRequest) {
  try {
    const { projet_id } = await req.json();
    if (!projet_id) return NextResponse.json({ error: "projet_id requis" }, { status: 400 });
    const p = await getProjet(+projet_id);
    if (!p) return NextResponse.json({ error: "projet introuvable" }, { status: 404 });
    const courriel = (p as any).client_courriel;
    if (!courriel) return NextResponse.json({ ok: false, raison: "pas_de_courriel" });

    if (!emailEstConfigure()) {
      // Pas de SMTP configuré → le client retombera sur mailto.
      return NextResponse.json({ ok: false, raison: "non_configure" });
    }

    const prenom = ((p as any).client_nom || "").trim().split(/\s+/)[0];
    const r = await sendEmail({
      to: courriel,
      subject: "Travaux complétés — Revêtement Viking Inc.",
      text: corpsReview(prenom),
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
    return NextResponse.json({ ok: false, error: e?.message || "erreur" }, { status: 500 });
  }
}

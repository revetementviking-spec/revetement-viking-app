import { NextRequest, NextResponse } from "next/server";
import { listerCommentairesClient, ajouterCommentaireClient, supprimerCommentaireClient, getClient } from "@/lib/db";
import { utilisateurActif } from "@/lib/authUser";
import { sendEmail, emailEstConfigure } from "@/lib/email";
import { envoyerPushUtilisateur, pushEstConfigure } from "@/lib/push";

const COURRIELS: Record<string, string | undefined> = {
  Gabriel: process.env.GABRIEL_EMAIL,
  Francis: process.env.FRANCIS_EMAIL,
};

export async function GET(req: NextRequest) {
  const cid = req.nextUrl.searchParams.get("client_id");
  if (!cid) return NextResponse.json({ error: "client_id requis" }, { status: 400 });
  return NextResponse.json(await listerCommentairesClient(+cid));
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (!b.client_id || !b.texte) return NextResponse.json({ error: "client_id et texte requis" }, { status: 400 });
  const auteur = await utilisateurActif(req);
  // Parser les @mentions
  const mentions = Array.from(new Set((String(b.texte).match(/@(Gabriel|Francis)/gi) || []).map((m) => m.slice(1).replace(/^./, (c) => c.toUpperCase()))));
  const id = await ajouterCommentaireClient({ client_id: +b.client_id, auteur, texte: String(b.texte), mentions });

  // Notifications @mention (push + email, best-effort)
  if (mentions.length) {
    const client = await getClient(+b.client_id);
    // Push PWA (immédiat, sur tous les appareils abonnés du destinataire)
    if (pushEstConfigure()) {
      for (const u of mentions) {
        if (u === auteur) continue;
        envoyerPushUtilisateur(u, {
          title: `💬 ${auteur || "Quelqu'un"} t'a mentionné`,
          body: `${client?.nom || "Client"} : ${String(b.texte).slice(0, 100)}`,
          url: `/clients/${b.client_id}`,
          tag: `mention-${b.client_id}`,
        }).catch(() => {});
      }
    }
  }
  if (mentions.length && emailEstConfigure()) {
    const client = await getClient(+b.client_id);
    for (const u of mentions) {
      if (u === auteur) continue;
      const dest = COURRIELS[u];
      if (!dest) continue;
      const sujet = `[Pipeline Viking] @${auteur || "Quelqu'un"} t'a mentionné — ${client?.nom || "client"}`;
      const corps = `${auteur || "Un collègue"} t'a mentionné dans le pipeline CRM.

Client : ${client?.nom || "—"}${client?.adresse ? ` (${client.adresse})` : ""}

« ${b.texte} »

Ouvre l'app pour répondre :
https://app.revetementviking.com/clients

— Revêtement Viking Inc.`;
      sendEmail({ to: dest, subject: sujet, text: corps }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, id, mentions });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await supprimerCommentaireClient(+id);
  return NextResponse.json({ ok: true });
}

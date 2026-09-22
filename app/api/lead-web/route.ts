// Ingestion des formulaires du site web (GoDaddy) → CRM.
// Reçoit soit des champs structurés {nom, courriel, telephone, adresse, message},
// soit le texte brut d'un courriel de formulaire {texte_brut} qu'on parse ici.
// Protégé par LEAD_WEBHOOK_SECRET (fail-closed : 503 si non configuré).
// Anti-doublon : si un client existe déjà (courriel/téléphone/nom), on ajoute une
// interaction au lieu de créer un doublon.
import { NextRequest, NextResponse } from "next/server";
import { db, ajouterClient, ajouterInteraction, initDb } from "@/lib/db";
import { envoyerPushUtilisateur } from "@/lib/push";
import { journaliser } from "@/lib/audit";
import { rateLimitDepasse, timingSafeEqual, empreinteDejaVue, memoriserEmpreinte } from "@/lib/rateLimit";
import { parserTexteFormulaire } from "@/lib/lead-web";
import { empreinteRequete } from "@/lib/empreinte-requete";
import { aujourdhuiMontreal } from "@/lib/date";

// Anti-rejeu : un même formulaire renvoyé (relance du scénario, double clic, rejeu d'une
// requête capturée) dans les 24 h ne crée ni interaction ni push — il répond simplement
// `doublon: true`. Le contrat pour l'émetteur ne change pas (même en-tête, même 200).
const FENETRE_REJEU_H = 24;
const PORTEE_EMPREINTE = "lead-web";

export const dynamic = "force-dynamic";

import { ipClient } from "@/lib/ip";
const ipDe = (req: NextRequest) => ipClient(req);

const chiffres = (s: string) => String(s || "").replace(/\D/g, "");

export async function POST(req: NextRequest) {
  const secret = process.env.LEAD_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "LEAD_WEBHOOK_SECRET non configuré — endpoint désactivé" }, { status: 503 });
  }
  const fourni = req.headers.get("x-lead-secret") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!fourni || !timingSafeEqual(fourni, secret)) {
    await journaliser("auth.login_echec", { description: "Secret lead-web invalide", ip: ipDe(req) });
    return NextResponse.json({ error: "non autorisé" }, { status: 401 });
  }
  const ip = ipDe(req);
  // Compte les entrées « client.cree » (écrites plus bas à CHAQUE requête acceptée) :
  // compter un type jamais journalisé rendrait la limite inopérante.
  if (await rateLimitDepasse("client.cree", ip, 60, 60)) {
    return NextResponse.json({ error: "trop de requêtes" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  // Champs structurés d'abord ; le texte brut complète ce qui manque.
  const parse = body.texte_brut ? parserTexteFormulaire(String(body.texte_brut)) : {};
  const nom = String(body.nom || parse.nom || "").trim().slice(0, 120);
  const courriel = String(body.courriel || parse.courriel || "").trim().slice(0, 200) || null;
  const telephone = String(body.telephone || parse.telephone || "").trim().slice(0, 40) || null;
  const adresse = String(body.adresse || parse.adresse || "").trim().slice(0, 300) || null;
  const sujet = String(body.sujet || parse.sujet || "").trim().slice(0, 200) || null;
  const message = String(body.message || parse.message || "").trim().slice(0, 4000) || null;
  const source = String(body.source || "site web").trim().slice(0, 80);

  if (!nom && !courriel && !telephone) {
    return NextResponse.json({ error: "au moins un de nom/courriel/telephone requis" }, { status: 400 });
  }

  await initDb();
  const empreinte = empreinteRequete({ nom, courriel, telephone, adresse, sujet, message, source });
  if (await empreinteDejaVue(PORTEE_EMPREINTE, empreinte, FENETRE_REJEU_H)) {
    return NextResponse.json({ ok: true, doublon: true });
  }

  // Anti-doublon : courriel (insensible à la casse), sinon téléphone (chiffres seuls), sinon nom exact.
  const un = async (sql: string, args: any[]) => ((await db().execute({ sql, args })).rows[0] as any) || null;
  let existant: { id: number; nom: string } | null = null;
  if (courriel) existant = await un("SELECT id, nom FROM clients WHERE LOWER(courriel) = LOWER(?)", [courriel]);
  if (!existant && telephone && chiffres(telephone).length >= 10) {
    const cands = await db().execute({ sql: "SELECT id, nom, telephone FROM clients WHERE telephone IS NOT NULL AND telephone != ''", args: [] });
    existant = (cands.rows as any[]).find((c) => chiffres(c.telephone).slice(-10) === chiffres(telephone).slice(-10)) || null;
  }
  // Par le NOM seulement si ni le lead ni la fiche n'ont de courriel/téléphone : deux
  // homonymes avec des coordonnées différentes sont deux personnes.
  if (!existant && nom && !courriel && !telephone) {
    existant = await un(
      "SELECT id, nom FROM clients WHERE LOWER(nom) = LOWER(?) AND (courriel IS NULL OR courriel = '') AND (telephone IS NULL OR telephone = '')",
      [nom],
    );
  }

  let client_id: number;
  let cree = false;
  if (existant) {
    client_id = existant.id;
  } else {
    client_id = await ajouterClient({
      nom: nom || courriel || telephone || "Lead site web",
      courriel: courriel || undefined, telephone: telephone || undefined, adresse: adresse || undefined,
      statut: "prospect", source, pipeline_stage: "info_1",
    } as any);
    cree = true;
  }

  // Le contenu du formulaire devient une interaction visible dans la fiche CRM.
  await ajouterInteraction({
    client_id, type: "formulaire_web", date: aujourdhuiMontreal(),
    sujet: sujet || "Formulaire du site web",
    note: [message, adresse && !cree ? `Adresse mentionnée : ${adresse}` : null].filter(Boolean).join("\n") || "(sans message)",
    fait_par: "Site web",
  });

  await journaliser("client.cree", {
    ref_type: "client", ref_id: client_id, ip,
    description: cree ? `Lead site web : ${nom || courriel || telephone}` : `Formulaire web (client existant) : ${existant!.nom}`,
  });
  await memoriserEmpreinte(PORTEE_EMPREINTE, empreinte, ip);

  envoyerPushUtilisateur("Francis", {
    title: cree ? "🌐 Nouveau lead du site web" : "🌐 Formulaire web — client existant",
    body: `${nom || courriel || telephone}${sujet ? ` · ${sujet}` : ""}${message ? ` — ${message.slice(0, 80)}` : ""}`,
    url: `/clients?id=${client_id}`,
    tag: "lead-web",
  }).catch(() => {});

  return NextResponse.json({ ok: true, client_id, cree });
}

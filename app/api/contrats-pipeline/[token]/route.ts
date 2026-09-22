import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getContratPipelineParToken, signerContratPipeline, getClient, marquerContratVu, creerProjetDepuisContrat } from "@/lib/db";
import { genererContratBlob } from "@/lib/pdf-contrat";
import { aujourdhuiMontreal } from "@/lib/date";

export const dynamic = "force-dynamic";

import { ipClient } from "@/lib/ip";
const ipDe = (req: NextRequest) => ipClient(req);

// Signature PNG dessinée sur un canvas 800×250 : quelques dizaines de Ko en pratique.
// 2 Mo est une marge très généreuse — filet contre un payload aberrant, pas un usage normal.
const TAILLE_MAX_SIGNATURE = 2 * 1024 * 1024;

// GET — public (allowlistée dans proxy.ts) : retourne les méta + data_json (sans les PDF blobs)
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const c = await getContratPipelineParToken(token);
  if (!c) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  // Enregistre la première vue (preuve de transmission style DocuSign)
  marquerContratVu(token, ipDe(req)).catch(() => {});
  const cl = await getClient(c.client_id);
  // Le jeton n'est PAS renvoyé : le visiteur l'a déjà (il est dans l'URL), et un JSON
  // public qui le répète n'a aucune raison d'exister (demande de l'agent sécurité).
  return NextResponse.json({
    numero: c.numero,
    statut: c.statut,
    data: JSON.parse(c.data_json || "{}"),
    signature_nom: c.signature_nom,
    signature_date: c.signature_date,
    client_nom: cl?.nom,
    // Drapeaux calculés en SQL (getContratPipelineParToken ne rapatrie plus les blobs).
    a_pdf_signe: !!Number(c.a_pdf_signe),
    // Métadonnées de l'annexe seulement — le fichier lui-même passe par sa propre route,
    // sinon on renverrait plusieurs Mo de base64 à chaque affichage de la page.
    annexe: Number(c.a_annexe) ? { nom: c.annexe_nom || "devis", type: c.annexe_type || "application/pdf" } : null,
  });
}

// POST — signature : { signature_dataurl, signature_nom }
// Le PDF signé est régénéré ICI, côté serveur, à partir du data_json AUTORITAIRE stocké en
// base (jamais du payload du client) — sinon un visiteur pourrait modifier le contrat (prix,
// conditions…) dans son navigateur avant de signer, et le PDF « signé » archivé ne refléterait
// plus le contrat réellement accepté. Un PDF envoyé par le client n'est donc plus accepté.
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  // Un corps illisible est une requête invalide (400), pas une panne serveur (500).
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "corps JSON invalide" }, { status: 400 });

  // Le statut (déjà signé ?) prime sur la validation de format : un retry sur un contrat
  // déjà signé doit toujours renvoyer 409, même avec un payload par ailleurs invalide.
  const co = await getContratPipelineParToken(token);
  if (!co) return NextResponse.json({ error: "introuvable" }, { status: 404 });
  if (co.statut === "signe") return NextResponse.json({ error: "déjà signé ou introuvable" }, { status: 409 });

  if (!b.signature_dataurl || !b.signature_nom) {
    return NextResponse.json({ error: "signature_dataurl, signature_nom requis" }, { status: 400 });
  }
  if (typeof b.signature_dataurl !== "string" || !/^data:image\/png;base64,/.test(b.signature_dataurl)) {
    return NextResponse.json({ error: "signature_dataurl doit être une image PNG (dataURL)" }, { status: 400 });
  }
  if (b.signature_dataurl.length > TAILLE_MAX_SIGNATURE) {
    return NextResponse.json({ error: "signature trop volumineuse" }, { status: 400 });
  }

  const signatureNom = String(b.signature_nom).trim().slice(0, 120);
  if (!signatureNom) return NextResponse.json({ error: "signature_nom requis" }, { status: 400 });

  const data = JSON.parse(co.data_json || "{}");
  // Le numéro vit dans une COLONNE du contrat, pas dans data_json : sans cette ligne, le
  // PDF signé — la pièce archivée — sortait avec « CONTRAT N° — » sur la couverture et un
  // en-tête « Contrat n° » vide sur chaque page. Vérifié en extrayant le texte du PDF.
  data.numero = co.numero || data.numero || "";
  // Jour de MONTRÉAL : Vercel tourne en UTC, donc un contrat signé après 20 h au Québec
  // portait la date du lendemain sur la pièce archivée.
  data.signature_client = { nom: signatureNom, date: aujourdhuiMontreal() };
  data.signature_client_image = b.signature_dataurl;

  let pdfSigne: string;
  let empreinte: string;
  try {
    const blob = await genererContratBlob(data);
    const buf = Buffer.from(await blob.arrayBuffer());
    // Empreinte SHA-256 des OCTETS du PDF (pas de la dataURL) : scellée ici, elle permet au
    // certificat d'authentification de prouver plus tard que la pièce archivée n'a pas bougé.
    empreinte = createHash("sha256").update(buf).digest("hex");
    pdfSigne = `data:application/pdf;base64,${buf.toString("base64")}`;
  } catch (e: any) {
    return NextResponse.json({ error: "échec de génération du PDF signé : " + (e?.message || "") }, { status: 500 });
  }

  const ok = await signerContratPipeline(token, {
    signature_dataurl: b.signature_dataurl,
    signature_nom: signatureNom,
    pdf_signe: pdfSigne,
    ip: ipDe(req),
    sha256: empreinte,
    user_agent: (req.headers.get("user-agent") || "").slice(0, 300) || undefined,
  });
  if (!ok) return NextResponse.json({ error: "déjà signé ou introuvable" }, { status: 409 });

  // Le projet naît ICI, à la signature. La création ne doit jamais faire échouer la
  // signature elle-même : le client a signé, c'est acquis. Si la création échoue, on le
  // dit dans la réponse (Francis le verra sur la fiche contrat) plutôt que de renvoyer
  // une erreur qui laisserait croire que la signature n'a pas pris.
  let projet: any = null;
  try {
    projet = await creerProjetDepuisContrat(token);
  } catch (e: any) {
    projet = { ok: false, raison: e?.message || "erreur inconnue" };
  }
  return NextResponse.json({ ok: true, projet });
}

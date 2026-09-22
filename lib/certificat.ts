import { createHash } from "crypto";
import { getContratPipelineParToken, getContratPipelineBlobs, getClient } from "@/lib/db";
import type { CertificatData, VerdictIntegrite } from "@/lib/pdf-certificat";

/** Recalcule l'empreinte SHA-256 des octets du PDF signé archivé et la confronte à celle
 *  scellée au moment de la signature. C'est la preuve d'intégrité du certificat : toute
 *  altération du document en base (même d'un octet) fait basculer le verdict en DIVERGENCE. */
export function verifierIntegrite(contrat: any): { actuelle?: string; verdict: VerdictIntegrite } {
  const m = String(contrat?.pdf_signe || "").match(/^data:[^;]+;base64,(.+)$/);
  const actuelle = m ? createHash("sha256").update(Buffer.from(m[1], "base64")).digest("hex") : undefined;
  const scellee = contrat?.pdf_signe_sha256 || null;
  // Un contrat signé avant l'ajout du scellement n'est pas « en divergence » — il est
  // simplement non scellé ; le distinguer évite une fausse alerte de falsification.
  if (!scellee) return { actuelle, verdict: "NON_SCELLE" };
  return { actuelle, verdict: actuelle && actuelle === scellee ? "CONFORME" : "DIVERGENCE" };
}

/** Rassemble tout ce que le certificat doit attester pour un contrat donné. */
export async function construireCertificat(token: string): Promise<{ contrat: any; data: CertificatData } | null> {
  // Métadonnées + blobs : le certificat a besoin du PDF signé (empreinte recalculée) et de
  // l'image de la signature. Le contrat rendu porte les deux, comme l'ancien `SELECT *`.
  const meta = await getContratPipelineParToken(token);
  if (!meta) return null;
  const [cl, blobs] = await Promise.all([
    getClient(meta.client_id).catch(() => null),
    getContratPipelineBlobs(token),
  ]);
  const co: any = { ...meta, ...(blobs || {}) };
  let duJson: any = {};
  try { duJson = JSON.parse(co.data_json || "{}"); } catch { /* data_json illisible : on garde le reste */ }
  const { actuelle, verdict } = verifierIntegrite(co);

  return {
    contrat: co,
    data: {
      numero: co.numero || "—",
      token: co.token,
      client_nom: cl?.nom || duJson.client_nom || undefined,
      client_courriel: cl?.courriel || duJson.client_courriel || undefined,
      signature_nom: co.signature_nom || undefined,
      signature_date: co.signature_date || undefined,
      signature_ip: co.signature_ip || undefined,
      signature_user_agent: co.signature_user_agent || undefined,
      signature_image: co.signature_dataurl || undefined,
      date_creation: co.date_creation || undefined,
      cree_par: co.cree_par || undefined,
      date_envoye: co.date_envoye || undefined,
      courriel_destinataire: co.courriel_destinataire || undefined,
      courriel_message_id: co.courriel_message_id || undefined,
      date_vue: co.date_vue || undefined,
      ip_vue: co.ip_vue || undefined,
      date_signe_envoye: co.date_signe_envoye || undefined,
      signe_destinataire: co.signe_destinataire || undefined,
      empreinte_scellee: co.pdf_signe_sha256 || undefined,
      empreinte_actuelle: actuelle,
      verdict,
      genere_le: new Date().toISOString(),
    },
  };
}

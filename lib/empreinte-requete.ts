// Empreinte d'une requête entrante (anti-rejeu). Logique pure, testée dans
// lib/empreinte-requete.test.ts ; la mémorisation vit dans lib/rateLimit.ts.
import { createHash } from "crypto";

/** Normalise puis hache (SHA-256, hex) un jeu de champs : clés triées, valeurs en
 *  minuscules, espaces repliés, champs vides ignorés. Deux envois du MÊME formulaire
 *  (au décalage d'espaces ou de casse près) donnent la même empreinte. */
export function empreinteRequete(champs: Record<string, unknown>): string {
  const norm: Record<string, string> = {};
  for (const k of Object.keys(champs).sort()) {
    const v = champs[k];
    if (v == null) continue;
    const s = String(v).trim().toLowerCase().replace(/\s+/g, " ");
    if (s) norm[k] = s;
  }
  return createHash("sha256").update(JSON.stringify(norm)).digest("hex");
}

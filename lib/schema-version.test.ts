// Garde-fou des migrations : le bloc `migrer()` de lib/db.ts est haché ; si son contenu
// SQL change sans que SCHEMA_VERSION soit incrémenté, ce test échoue. Sans lui, une
// migration ajoutée sans bump ne s'exécute JAMAIS en production (PRAGMA user_version ≥
// SCHEMA_VERSION → doInitDb saute tout le bloc) — la colonne manque, les écritures 500.
//
// Quand ce test échoue à bon droit : incrémenter SCHEMA_VERSION dans lib/db.ts, puis
// recopier ici la nouvelle version ET le nouveau hachage (imprimés dans le message).
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

// === VALEURS FIGÉES (2026-09-21) ===
const VERSION_FIGEE = 26;
const HACHAGE_FIGE = "4ae85fb11eea8180496615841897b4904cb0405002a6829a2d0a58ef516d7d97";

/** Extrait le corps de `migrer()` : de sa signature jusqu'à l'accolade fermante de
 *  premier niveau. Les commentaires (// et --) et les espaces sont retirés pour que seule
 *  une modification de SQL ou de logique change le hachage. */
export function extraireBlocMigrations(source: string): string {
  // Fins de ligne normalisées : le fichier peut être en CRLF sous Windows.
  const src = source.replace(/\r\n/g, "\n");
  const debut = src.indexOf("async function migrer()");
  if (debut < 0) throw new Error("lib/db.ts : `async function migrer()` introuvable");
  const fin = src.indexOf("\n}\n", debut);
  if (fin < 0) throw new Error("lib/db.ts : fin de migrer() introuvable");
  return src.slice(debut, fin + 2)
    .replace(/\/\/[^\n]*/g, "")      // commentaires de ligne
    .replace(/--[^\n]*/g, "")        // commentaires SQL dans les gabarits
    .replace(/\s+/g, " ")
    .trim();
}

export function lireVersion(source: string): number {
  const m = source.match(/const SCHEMA_VERSION = (\d+);/);
  if (!m) throw new Error("lib/db.ts : SCHEMA_VERSION introuvable");
  return Number(m[1]);
}

describe("SCHEMA_VERSION suit le bloc de migrations", () => {
  const source = readFileSync(path.join(__dirname, "db.ts"), "utf8");
  const version = lireVersion(source);
  const hachage = createHash("sha256").update(extraireBlocMigrations(source)).digest("hex");

  it("le bloc de migrations n'a pas changé sans incrément de SCHEMA_VERSION", () => {
    if (hachage !== HACHAGE_FIGE && version === VERSION_FIGEE) {
      throw new Error(
        `Le bloc des migrations de lib/db.ts a changé (hachage ${hachage}) mais SCHEMA_VERSION vaut toujours ${version} : ` +
        `incrémente SCHEMA_VERSION (sinon la migration ne tournera jamais en production) et mets à jour HACHAGE_FIGE dans lib/schema-version.test.ts.`
      );
    }
    if (version !== VERSION_FIGEE) {
      throw new Error(
        `SCHEMA_VERSION vaut ${version} mais le test fige ${VERSION_FIGEE} : mets à jour VERSION_FIGEE = ${version} et HACHAGE_FIGE = "${hachage}" dans lib/schema-version.test.ts.`
      );
    }
    expect(hachage).toBe(HACHAGE_FIGE);
  });

  it("l'extraction retire les commentaires et l'espace, pas le SQL", () => {
    const a = extraireBlocMigrations("x\nasync function migrer() {\n  // note\n  await tryExec(\"ALTER TABLE t ADD COLUMN c TEXT\");\n}\n");
    const b = extraireBlocMigrations("x\nasync function migrer() {\n  await tryExec(\"ALTER TABLE t ADD COLUMN c TEXT\"); // autre note\n}\n");
    const c = extraireBlocMigrations("x\nasync function migrer() {\n  await tryExec(\"ALTER TABLE t ADD COLUMN d TEXT\");\n}\n");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

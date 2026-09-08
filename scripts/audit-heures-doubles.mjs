/**
 * Audit LECTURE SEULE : des heures ont-elles été payées deux fois ?
 *
 * Contexte — du 2026-08-08 au 2026-09-07, le bandeau « X h travaillées ne sont dans
 * aucune paye » comptait le surplus au-delà de 80 h/quinzaine comme une dette, alors
 * que ce surplus part en banque d'heures. Les mêmes heures s'affichaient donc au crédit
 * de l'employé (carte Banque) ET comme dû envers lui (bandeau). Quiconque a réglé le
 * bandeau « à part » a payé une fois ; si la banque a ensuite été appliquée à une
 * quinzaine suivante, elle a payé une deuxième fois.
 *
 * Ce script n'écrit RIEN : que des SELECT.
 *
 *   TURSO_URL=... TURSO_AUTH_TOKEN=... node scripts/audit-heures-doubles.mjs
 *   node scripts/audit-heures-doubles.mjs --db data/soumissions.db   (base locale)
 */
import { createClient } from "@libsql/client";

const SEUIL = 80;
const argDb = process.argv.indexOf("--db");
const url =
  argDb !== -1 ? `file:${process.argv[argDb + 1]}`
  : process.env.TURSO_URL ? process.env.TURSO_URL
  : null;

if (!url) {
  console.error("Aucune base. Donne TURSO_URL (+ TURSO_AUTH_TOKEN) ou --db <fichier>.");
  process.exit(2);
}

const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const q = async (sql, args = []) => (await db.execute({ sql, args })).rows;
const n = (v) => Number(v || 0);
const $ = (v) => n(v).toLocaleString("fr-CA", { style: "currency", currency: "CAD" });
const titre = (t) => console.log(`\n${"═".repeat(78)}\n${t}\n${"═".repeat(78)}`);

const periodes = await q(
  `SELECT id, employe, debut, fin, heures_travaillees, heures_normales,
          banque_dispo, banque_appliquee, banque_solde, taux_horaire,
          montant_brut, paye, date_paiement, note
     FROM paies_periodes ORDER BY employe, debut`
);
console.log(`Base : ${url.replace(/\/\/.*@/, "//…@")}`);
console.log(`${periodes.length} période(s) de paye.`);

// ── 1. Ce que le bandeau réclamait à tort ────────────────────────────────────
titre("1. Ce que l'ancien bandeau réclamait (surplus de banque pris pour une dette)");
let totalFantome = 0;
for (const p of periodes) {
  if (!p.paye) continue;
  const trav = n(p.heures_travaillees), pay = n(p.heures_normales);
  const ancien = Math.max(0, trav - pay);              // ancienne formule
  const vrai = Math.max(0, Math.min(trav, SEUIL) - pay); // formule corrigée
  const fantome = ancien - vrai;
  if (fantome > 0) {
    totalFantome += fantome;
    console.log(
      `  ${p.employe.padEnd(18)} ${p.debut}→${p.fin}  ${trav} h trav / ${pay} h payées` +
      `  → réclamait ${ancien} h, dû réel ${vrai} h, FANTÔME ${fantome.toFixed(2)} h (${$(fantome * n(p.taux_horaire))})`
    );
  }
}
console.log(`  TOTAL fantôme : ${totalFantome.toFixed(2)} h`);

// ── 2. Le surplus est-il ENCORE en banque ? ──────────────────────────────────
// C'est le test décisif. Si le solde de banque contient toujours le surplus, il n'a
// pas été payé en argent : rien n'a été payé deux fois, la banque est intacte.
titre("2. Le surplus est-il encore au crédit dans la banque ? (test décisif)");
const parEmploye = new Map();
for (const p of periodes) {
  if (!parEmploye.has(p.employe)) parEmploye.set(p.employe, []);
  parEmploye.get(p.employe).push(p);
}
for (const [emp, liste] of parEmploye) {
  liste.sort((a, b) => String(a.debut).localeCompare(String(b.debut)));
  const surplusTotal = liste.reduce((s, p) => s + Math.max(0, n(p.heures_travaillees) - SEUIL), 0);
  const appliqueeTotal = liste.reduce((s, p) => s + n(p.banque_appliquee), 0);
  const derniere = liste[liste.length - 1];
  const solde = n(derniere.banque_solde);
  const attendu = surplusTotal - appliqueeTotal;
  const ecart = solde - attendu;
  console.log(
    `  ${emp.padEnd(18)} surplus cumulé ${surplusTotal.toFixed(2)} h` +
    ` − appliqué en paie ${appliqueeTotal.toFixed(2)} h = attendu ${attendu.toFixed(2)} h` +
    ` | solde réel ${solde.toFixed(2)} h  ${Math.abs(ecart) < 0.01 ? "✓ cohérent" : `⚠ ÉCART ${ecart.toFixed(2)} h`}`
  );
  if (appliqueeTotal > 0) {
    console.log(`    ↳ banque APPLIQUÉE (donc payée en argent) sur :`);
    for (const p of liste.filter((x) => n(x.banque_appliquee) > 0)) {
      console.log(
        `        ${p.debut}→${p.fin} : ${n(p.banque_appliquee)} h tirées de la banque` +
        ` (${$(n(p.banque_appliquee) * n(p.taux_horaire))}) — ${p.paye ? `versé ${p.date_paiement || "?"}` : "PAS ENCORE VERSÉ"}`
      );
    }
    console.log(`    ⚠ Si ce surplus a AUSSI été réglé à part sur la foi du bandeau, il est payé deux fois.`);
  }
}

// ── 3. Versements incohérents avec les heures payées ─────────────────────────
// Un règlement « à part » ajouté au versement gonfle le brut au-delà de heures × taux.
titre("3. Montant versé ≠ heures payées × taux (trace d'un règlement ajouté à la main)");
let suspects3 = 0;
for (const p of periodes) {
  if (!p.paye) continue;
  const attendu = n(p.heures_normales) * n(p.taux_horaire);
  const ecart = n(p.montant_brut) - attendu;
  if (Math.abs(ecart) > 0.02) {
    suspects3++;
    console.log(
      `  ⚠ ${p.employe.padEnd(18)} ${p.debut}→${p.fin} versé ${$(p.montant_brut)}` +
      ` vs ${n(p.heures_normales)} h × ${$(p.taux_horaire)} = ${$(attendu)}  → écart ${$(ecart)}` +
      ` (${(ecart / (n(p.taux_horaire) || 1)).toFixed(2)} h)${p.note ? ` | note: ${p.note}` : ""}`
    );
  }
}
if (!suspects3) console.log("  ✓ aucun : tous les versements collent aux heures payées.");

// ── 4. Périodes en double ────────────────────────────────────────────────────
titre("4. Deux périodes pour le même employé sur la même quinzaine");
const vues = new Map();
let suspects4 = 0;
for (const p of periodes) {
  const cle = `${p.employe}|${p.debut}`;
  if (vues.has(cle)) {
    suspects4++;
    const a = vues.get(cle);
    console.log(`  ⚠ ${p.employe} ${p.debut} : #${a.id} (${$(a.montant_brut)}, ${a.paye ? "payé" : "à payer"}) ET #${p.id} (${$(p.montant_brut)}, ${p.paye ? "payé" : "à payer"})`);
  } else vues.set(cle, p);
}
if (!suspects4) console.log("  ✓ aucune période en double.");

// ── 5. Heures saisies en double ──────────────────────────────────────────────
// Une correction faite en RAJOUTANT des heures (au lieu d'un règlement à part)
// gonflerait la quinzaine et se verrait ici.
titre("5. Heures identiques saisies plusieurs fois (même employé, même date, même durée)");
const doublons = await q(
  `SELECT employe, date, heures, COUNT(*) AS n, GROUP_CONCAT(projet_id) AS projets
     FROM heures_projet
    WHERE employe IS NOT NULL
    GROUP BY employe, date, heures
   HAVING COUNT(*) > 1
    ORDER BY date DESC`
);
if (!doublons.length) console.log("  ✓ aucune saisie exactement dupliquée.");
for (const d of doublons) {
  console.log(`  ⚠ ${d.employe} le ${d.date} : ${d.n} × ${n(d.heures)} h (projets ${d.projets})`);
}
console.log("  (note : deux chantiers le même jour pour la même durée est légitime — vérifier les projets)");

// ── 6. Heures saisies APRÈS le versement (le vrai cas du bandeau) ────────────
titre("6. Vraie dette restante après correction (feuille saisie après le versement)");
let totalDu = 0;
for (const p of periodes) {
  if (!p.paye) continue;
  const vrai = Math.max(0, Math.min(n(p.heures_travaillees), SEUIL) - n(p.heures_normales));
  if (vrai > 0) {
    totalDu += vrai;
    console.log(`  ⚠ ${p.employe.padEnd(18)} ${p.debut}→${p.fin} : ${vrai.toFixed(2)} h dues (${$(vrai * n(p.taux_horaire))})`);
  }
}
if (!totalDu) console.log("  ✓ aucune : après correction, plus personne n'est en attente d'un versement.");

titre("VERDICT");
console.log(`  Fantôme retiré du bandeau  : ${totalFantome.toFixed(2)} h`);
console.log(`  Vraie dette restante       : ${totalDu.toFixed(2)} h`);
console.log(`  Signes de double paiement  : section 2 (banque appliquée), 3 (versement gonflé), 4 et 5.`);
console.log(`  Un double paiement RÉEL demande DEUX choses : un règlement à part du bandeau,`);
console.log(`  ET la même heure ressortie de la banque. La section 2 dit si la banque est intacte.\n`);

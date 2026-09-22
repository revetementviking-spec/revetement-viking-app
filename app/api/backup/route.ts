// Backup complet de la DB → Drive (Viking/Backups/backup-YYYY-MM-DD-HHMM.json)
import { NextRequest, NextResponse } from "next/server";
import { contenuSauvegarde, memoriserCountsSauvegarde, TABLES_EXCLUES_SAUVEGARDE, toutesHeuresPourExport } from "@/lib/db";
import { driveEstActif, trouverOuCreerSousDossier, uploaderFichier, sauvegarderClasseurCSV } from "@/lib/drive";
import { celluleCSV } from "@/lib/csv";
import { timingSafeEqual } from "@/lib/rateLimit";
import { enregistrerErreurClient } from "@/lib/erreurs-client";
import { journaliser } from "@/lib/audit";

export const dynamic = "force-dynamic";
// Export de toutes les tables + dépôt Drive + classeur des heures : bien au-delà des 10 s
// par défaut d'une fonction Vercel quand la base a quelques années de données.
export const maxDuration = 300;

// Échappement CSV (guillemets, virgules, sauts de ligne) + neutralisation des formules :
// ce CSV devient un Google Sheet, qui exécuterait un « =IMPORTXML(...) » saisi en description.
const csvEchap = celluleCSV;
function construireCSVHeures(lignes: any[]): string {
  const entete = ["Date", "Employé", "Projet", "Heures", "Taux ($/h)", "Coût ($)", "Description", "Saisi par"];
  const rows = lignes.map((h) => [
    h.date, h.employe || "", h.projet_nom || "", h.heures ?? "",
    (h.taux_horaire ?? 0), ((h.heures || 0) * (h.taux_horaire || 0)).toFixed(2),
    h.description || "", h.ajoute_par || "",
  ].map(csvEchap).join(","));
  return [entete.join(","), ...rows].join("\n");
}

/** Sauvegarde lisible des heures dans un Google Sheet "horaireemploye2026" (back-up dédié). */
async function exporterHeuresVersSheet(): Promise<{ lignes: number; lien?: string }> {
  const lignes = await toutesHeuresPourExport();
  const csv = construireCSVHeures(lignes);
  const r = await sauvegarderClasseurCSV(
    "horaireemploye2026", csv,
    `Heures employés · ${lignes.length} entrées · maj ${new Date().toLocaleDateString("fr-CA")}`
  );
  return { lignes: lignes.length, lien: r.webViewLink };
}

type ResultatBackup = {
  ok: boolean; nom?: string; webViewLink?: string; tailles?: any; error?: string;
  heures_sheet?: { ok: boolean; lignes?: number; lien?: string; error?: string };
  echecs_partiels?: string[]; alertes?: string[];
};

/** Alerte : journal d'erreurs (direct en base) + push aux deux utilisateurs. */
async function alerter(message: string) {
  await enregistrerErreurClient({ message, path: "/api/backup", userAgent: "cron-vercel" });
  try {
    const { envoyerPushUtilisateur, pushEstConfigure } = await import("@/lib/push");
    if (pushEstConfigure()) {
      for (const u of ["Francis", "Gabriel"]) {
        await envoyerPushUtilisateur(u, { title: "⚠️ Sauvegarde Viking", body: message.slice(0, 160), url: "/sync", tag: "backup-echec" }).catch(() => {});
      }
    }
  } catch {}
}

async function effectuerBackup(): Promise<ResultatBackup> {
  if (!(await driveEstActif())) return { ok: false, error: "Drive non actif — connecte Drive avant de lancer un backup." };
  // Toutes les tables métier, pilotées par la liste unique TABLES_SAUVEGARDE de lib/db.ts
  // (la même que celle utilisée par /api/restore, donc impossible qu'elles divergent).
  // Une table qui ne s'exporte pas fait ÉCHOUER la sauvegarde (contenuSauvegarde lève) :
  // avant, elle donnait un tableau vide et le fichier passait pour complet.
  // Les exclusions volontaires — blobs, cache, et surtout les jetons OAuth — sont listées
  // avec leur raison dans TABLES_EXCLUES_SAUVEGARDE et reportées dans le fichier.
  const { donnees, counts, alertes } = await contenuSauvegarde();
  // Une table qui a perdu plus de 20 % de ses lignes depuis la sauvegarde précédente est
  // signalée AVANT le dépôt : le fichier part quand même (c'est peut-être voulu), mais
  // Francis le sait le matin même, pas le jour où il cherche les lignes disparues.
  if (alertes.length) await alerter(`Sauvegarde : perte de lignes depuis la précédente — ${alertes.join(" ; ")}`);
  const dump = {
    version: 2,
    date_backup: new Date().toISOString(),
    app: "Revêtement Viking",
    counts,
    exclus: TABLES_EXCLUES_SAUVEGARDE,
    ...donnees,
  };
  const json = JSON.stringify(dump, null, 2);
  const dataUrl = `data:application/json;base64,${Buffer.from(json).toString("base64")}`;
  const ts = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const nom = `backup-${ts}.json`;
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  // Les deux étapes sont indépendantes et partent EN PARALLÈLE : le dépôt du fichier JSON
  // sur Drive, et le classeur lisible des heures. Un échec partiel est journalisé et
  // renvoyé ; on ne répond « échec » (500) que si TOUT a échoué.
  const [depot, sheet] = await Promise.allSettled([
    (async () => {
      const dossierId = await trouverOuCreerSousDossier("Backups");
      return uploaderFichier({ nom, dataUrl, dossierId, description: `Backup DB · ${total} enregistrements · ${counts.projets || 0} projets · ${counts.clients || 0} clients · ${counts.contrats_signes || 0} contrats signés` });
    })(),
    exporterHeuresVersSheet(),
  ]);
  const echecs: string[] = [];
  if (depot.status === "rejected") echecs.push(`dépôt Drive : ${depot.reason?.message || depot.reason}`);
  if (sheet.status === "rejected") echecs.push(`classeur des heures : ${sheet.reason?.message || sheet.reason}`);
  for (const e of echecs) console.error("[/api/backup] échec partiel —", e);

  if (depot.status === "fulfilled") {
    // Les comptes deviennent la référence de la prochaine comparaison — seulement si le
    // fichier est bien déposé.
    await memoriserCountsSauvegarde(counts).catch((e) => console.warn("[/api/backup] counts non mémorisés :", e?.message));
  }
  if (echecs.length) {
    await journaliser("backup.execute", { description: `Sauvegarde ${nom} avec échec partiel : ${echecs.join(" ; ")}` });
  }
  const toutEchoue = depot.status === "rejected" && sheet.status === "rejected";
  return {
    ok: !toutEchoue,
    nom,
    webViewLink: depot.status === "fulfilled" ? depot.value.webViewLink : undefined,
    tailles: dump.counts,
    heures_sheet: sheet.status === "fulfilled" ? { ok: true, ...sheet.value } : { ok: false, error: String(sheet.reason?.message || sheet.reason) },
    echecs_partiels: echecs.length ? echecs : undefined,
    alertes: alertes.length ? alertes : undefined,
    error: toutEchoue ? echecs.join(" ; ") : (depot.status === "rejected" ? echecs[0] : undefined),
  };
}

export async function POST(_req: NextRequest) {
  try {
    const r = await effectuerBackup();
    if (!r.ok) await alerter(`Backup échoué: ${r.error}`);
    else if (r.echecs_partiels) await alerter(`Backup partiel : ${r.echecs_partiels.join(" ; ")}`);
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  } catch (e: any) {
    console.error("[/api/backup POST]", e);
    await alerter(`Backup échoué (exception): ${e?.message || e}`);
    return NextResponse.json({ ok: false, error: "Sauvegarde échouée — voir le journal serveur." }, { status: 500 });
  }
}

// GET pour cron Vercel — protégé par Authorization: Bearer CRON_SECRET
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.CRON_SECRET;
  // SÉCURITÉ : pas de fallback permissif. Si CRON_SECRET n'est pas configuré,
  // la route est fermée (503). Si configuré, on exige le Bearer exact.
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET non configuré — route désactivée" }, { status: 503 });
  }
  // Comparaison à temps constant : un `!==` s'arrête au premier octet différent.
  if (!timingSafeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // L'alerte était posée UNIQUEMENT sur la branche `!r.ok`. Or le cas le plus probable —
  // Google révoque le refresh_token — fait LEVER effectuerBackup(), donc on tombait dans
  // le catch, qui n'alertait pas : 500 silencieux tous les matins, aucun courriel, aucun
  // push, rien dans la cloche. Des semaines sans sauvegarde, découvertes le jour où on en
  // a besoin. L'alerte couvre maintenant les deux chemins (et les échecs partiels).
  // Écriture DIRECTE en base : l'auto-appel HTTP vers /api/log-erreur partait sans cookie
  // et mourait en 401 dans le middleware — l'erreur n'était jamais consignée.
  try {
    const r = await effectuerBackup();
    if (!r.ok) await alerter(`Backup échoué: ${r.error}`);
    else if (r.echecs_partiels) await alerter(`Backup partiel : ${r.echecs_partiels.join(" ; ")}`);
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  } catch (e: any) {
    const { estDriveDeconnecte } = await import("@/lib/drive");
    const msg = estDriveDeconnecte(e)
      ? "Backup impossible : Google Drive est déconnecté (jeton révoqué). Reconnecte-le dans /sync."
      : `Backup échoué (exception): ${e?.message || e}`;
    await alerter(msg);
    return NextResponse.json({ ok: false, error: msg, drive_deconnecte: estDriveDeconnecte(e) }, { status: 500 });
  }
}

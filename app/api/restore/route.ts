// Restauration d'un backup JSON (produit par /api/backup).
// Par défaut : DRY RUN — valide la structure sans toucher la DB.
// Avec { confirmer: true } dans le body : restauration RÉELLE, mais toujours additive et
// idempotente (INSERT OR IGNORE conservant les id d'origine) — ne modifie ni ne supprime
// jamais une ligne déjà présente. Rejouable sans risque.
import { NextRequest, NextResponse } from "next/server";
import { restaurerBackup, TABLES_SAUVEGARDE } from "@/lib/db";
import { utilisateurActif } from "@/lib/authUser";
import { journaliser } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Champs EXIGÉS pour juger un fichier valide : uniquement ceux de la v1, pour qu'une
// vieille sauvegarde reste restaurable. Les champs ajoutés depuis (contrats signés,
// factures, extras…) sont restaurés s'ils sont présents, sans être obligatoires.
const CHAMPS_REQUIS = ["soumissions", "clients", "projets", "employes", "heures", "depenses", "contrats", "paies", "biblio"];
// La plateforme (Vercel) refuse tout corps au-delà de 4,5 Mo, AVANT que ce code tourne :
// l'ancien plafond de 200 Mo ne pouvait jamais être atteint et l'utilisateur voyait un
// 413 HTML sans explication. On vérifie `content-length` avant même de lire le corps.
const TAILLE_MAX = 4.5 * 1024 * 1024;
const MESSAGE_TROP_GROS = "Fichier trop volumineux pour un envoi direct (plafond 4,5 Mo) : passe par la restauration depuis Google Drive (/sync).";

export async function POST(req: NextRequest) {
  try {
    const annonce = Number(req.headers.get("content-length") || 0);
    if (annonce > TAILLE_MAX) {
      return NextResponse.json({ ok: false, error: MESSAGE_TROP_GROS }, { status: 413 });
    }
    const texte = await req.text();
    if (texte.length > TAILLE_MAX) {
      return NextResponse.json({ ok: false, error: MESSAGE_TROP_GROS }, { status: 413 });
    }
    let b: any;
    try { b = JSON.parse(texte); } catch { return NextResponse.json({ ok: false, error: "JSON invalide" }, { status: 400 }); }
    if (!b || typeof b !== "object") {
      return NextResponse.json({ ok: false, error: "JSON invalide" }, { status: 400 });
    }

    const erreurs: string[] = [];
    const compte: Record<string, number> = {};
    for (const c of CHAMPS_REQUIS) {
      if (!Array.isArray(b[c])) erreurs.push(`Champ manquant ou non-array : ${c}`);
      else compte[c] = b[c].length;
    }
    // Champs optionnels (sauvegardes v2+) : comptés s'ils sont là, jamais exigés.
    for (const { champ } of TABLES_SAUVEGARDE) {
      if (!CHAMPS_REQUIS.includes(champ) && Array.isArray(b[champ])) compte[champ] = b[champ].length;
    }
    const meta = { date_backup: b.date_backup || "—", version: b.version || 0, app: b.app || "—" };
    const total = Object.values(compte).reduce((s, n) => s + n, 0);

    if (erreurs.length) {
      return NextResponse.json({
        ok: false, mode: "validation-seulement", meta, compte, total, erreurs,
        message: `⚠ Structure incomplète — ${erreurs.length} erreur(s).`,
      });
    }

    if (b.confirmer !== true) {
      // Dry-run : structure valide, mais on ne touche PAS la DB tant que confirmer:true
      // n'est pas explicitement envoyé (protège contre un restore déclenché par erreur).
      return NextResponse.json({
        ok: true, mode: "validation-seulement", meta, compte, total, erreurs: [],
        message: `✓ Backup valide — ${total} enregistrements répartis sur ${Object.keys(compte).length} tables. Renvoyer avec confirmer:true pour restaurer réellement.`,
      });
    }

    const resultat = await restaurerBackup(b);
    const utilisateur = (await utilisateurActif(req)) || "?";
    const insereTotal = Object.values(resultat).reduce((s, r) => s + r.inseres, 0);
    const tablesEnErreur = Object.entries(resultat).filter(([, r]) => r.erreur).map(([k]) => k);

    journaliser("backup.restaure", {
      utilisateur,
      description: `Restauration backup du ${meta.date_backup} — ${insereTotal} ligne(s) insérée(s)${tablesEnErreur.length ? ` — erreurs: ${tablesEnErreur.join(", ")}` : ""}`,
      apres: resultat,
    }).catch(() => {});

    return NextResponse.json({
      ok: tablesEnErreur.length === 0,
      mode: "restauration",
      meta,
      resultat,
      message: tablesEnErreur.length
        ? `⚠ Restauration partielle — ${insereTotal} ligne(s) insérée(s), erreur sur : ${tablesEnErreur.join(", ")}.`
        : `✓ Restauration terminée — ${insereTotal} nouvelle(s) ligne(s) insérée(s). Les lignes déjà existantes ont été ignorées ; aucune donnée existante n'a été modifiée ou supprimée.`,
    });
  } catch (e: any) {
    console.error("[/api/restore]", e);
    return NextResponse.json({ ok: false, error: "Restauration échouée — voir le journal serveur." }, { status: 500 });
  }
}

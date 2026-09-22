import { NextRequest, NextResponse } from "next/server";
import { db, listerPaiePeriodes, marquerPayePeriode, supprimerPayePeriode, nettoyerPayePeriodesOrphelines, definirBanqueAppliquee } from "@/lib/db";
import { journaliser } from "@/lib/audit";
import { utilisateurActif } from "@/lib/authUser";

/** La période telle qu'elle est en base (pour l'avant/après du journal d'audit). */
async function lirePeriode(id: number): Promise<any | null> {
  const r = await db().execute({
    sql: "SELECT id, employe, debut, fin, heures_normales, heures_travaillees, taux_horaire, das_pct, montant_brut, das_montant, montant_net, paye, date_paiement, note, banque_dispo, banque_appliquee, banque_solde FROM paies_periodes WHERE id = ?",
    args: [id],
  });
  return (r.rows[0] as any) || null;
}

export async function GET(req: NextRequest) {
  const employe = req.nextUrl.searchParams.get("employe") || undefined;
  const limit = +(req.nextUrl.searchParams.get("limit") || "12");
  return NextResponse.json(await listerPaiePeriodes(employe, limit));
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  if (!b.id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const user = await utilisateurActif(req);
  const avant = await lirePeriode(+b.id);
  if (!avant) return NextResponse.json({ error: "période introuvable" }, { status: 404 });
  // Choix utilisateur : combler la période avec des heures de la banque
  if (b.banque_appliquee !== undefined) {
    await definirBanqueAppliquee(+b.id, +b.banque_appliquee);
    journaliser("paye.banque_appliquee", {
      ref_type: "paye", ref_id: b.id, utilisateur: user || undefined,
      description: `${avant.employe} · ${avant.debut} → ${avant.fin} · banque appliquée ${avant.banque_appliquee ?? 0} h → ${+b.banque_appliquee} h`,
      avant: { banque_appliquee: avant.banque_appliquee, banque_dispo: avant.banque_dispo, paye: avant.paye },
      apres: { banque_appliquee: +b.banque_appliquee },
    });
    return NextResponse.json({ ok: true });
  }
  await marquerPayePeriode(+b.id, !!b.paye, b.date_paiement, b.note);
  const apres = await lirePeriode(+b.id);
  // Argent versé à un employé : la trace porte le brut, la DAS et le net tels qu'ils sont
  // au moment du geste — c'est ce qui figure sur le talon.
  journaliser("paye.marquee_payee", {
    ref_type: "paye", ref_id: b.id, utilisateur: user || undefined,
    description: `${avant.employe} · ${avant.debut} → ${avant.fin} · ${b.paye ? "marquée PAYÉE" : "paiement ANNULÉ"} · brut ${avant.montant_brut ?? "?"} $`,
    avant: { paye: avant.paye, date_paiement: avant.date_paiement, note: avant.note, heures_normales: avant.heures_normales, taux_horaire: avant.taux_horaire, montant_brut: avant.montant_brut, das_montant: avant.das_montant, montant_net: avant.montant_net },
    apres: apres ? { paye: apres.paye, date_paiement: apres.date_paiement, note: apres.note, heures_normales: apres.heures_normales, taux_horaire: apres.taux_horaire, montant_brut: apres.montant_brut, das_montant: apres.das_montant, montant_net: apres.montant_net } : null,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const user = await utilisateurActif(req);
  if (sp.get("orphelines") === "1") {
    const n = await nettoyerPayePeriodesOrphelines();
    if (n > 0) journaliser("paye.periode_supprimee", { ref_type: "paye", utilisateur: user || undefined, description: `Nettoyage : ${n} période(s) orpheline(s) supprimée(s)` });
    return NextResponse.json({ ok: true, supprimees: n });
  }
  const id = sp.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const avant = await lirePeriode(+id);
  await supprimerPayePeriode(+id);
  journaliser("paye.periode_supprimee", {
    ref_type: "paye", ref_id: id, utilisateur: user || undefined,
    description: avant ? `${avant.employe} · ${avant.debut} → ${avant.fin} · ${avant.paye ? "PAYÉE" : "non payée"} · brut ${avant.montant_brut ?? "?"} $` : `Période #${id}`,
    avant,
  });
  return NextResponse.json({ ok: true });
}

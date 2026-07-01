import { NextRequest, NextResponse } from "next/server";
import { executerOutilJarvis } from "@/lib/jarvis";
import { finances } from "@/lib/db";
import { utilisateurActif } from "@/lib/authUser";

export const dynamic = "force-dynamic";

const MOIS = ["", "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const cad = (n: number) => `${Math.round(n).toLocaleString("fr-CA")} $`;

/** Briefing quotidien composé à partir des données réelles (aucun appel LLM : instantané et gratuit). */
export async function GET(req: NextRequest) {
  try {
    const user = await utilisateurActif(req);
    if (!user) return NextResponse.json({ error: "non authentifié" }, { status: 401 });
    const annee = new Date().getFullYear();
    const moisCourant = new Date().getMonth() + 1;

    const [apercu, factures, taches, veh, fin] = await Promise.all([
      executerOutilJarvis("apercu_entreprise", {}),
      executerOutilJarvis("factures_impayees", {}),
      executerOutilJarvis("taches", { statut: "a_faire", assigne_a: user }),
      executerOutilJarvis("vehicules_assurances", {}),
      finances(annee),
    ]);

    const tachesRetard = (taches.taches || []).filter((t: any) => t.en_retard);
    const lignes: string[] = [`**📋 Briefing du ${new Date().toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" })}** — salut ${user} !`, ""];

    lignes.push(`**💰 Finances** — Marge moyenne des projets actifs : **${apercu.marge_moyenne_projets_actifs_pct}%**. CA ${annee} (avant taxes) : ${cad(apercu.ca_annee_avant_taxes)}, marge nette : ${cad(apercu.marge_nette_annee_avant_taxes)}.`);

    if (factures.total_du > 0) lignes.push(`**🔴 À encaisser** — ${factures.nombre} facture(s) impayée(s) pour **${cad(factures.total_du)}**${factures.en_retard_plus_30j.nombre > 0 ? ` (dont ${cad(factures.en_retard_plus_30j.montant)} en retard +30j)` : ""}.`);
    else lignes.push(`**🟢 À encaisser** — aucune facture impayée. 👍`);

    lignes.push(`**✅ Tes tâches** — ${taches.nombre} à faire${tachesRetard.length ? `, dont **${tachesRetard.length} en retard**` : ""}.${tachesRetard.length ? " À traiter : " + tachesRetard.slice(0, 3).map((t: any) => `« ${t.titre} »`).join(", ") + "." : ""}`);

    if (apercu.extras_a_facturer.nombre > 0) lignes.push(`**💲 Extras** — ${apercu.extras_a_facturer.nombre} extra(s) à facturer (${cad(apercu.extras_a_facturer.montant)}).`);
    if (apercu.projets_par_statut?.actif) lignes.push(`**🏗️ Chantiers** — ${apercu.projets_par_statut.actif} projet(s) actif(s)${apercu.projets_par_statut.a_venir ? `, ${apercu.projets_par_statut.a_venir} à venir` : ""}.`);
    if ((veh.renouvellements_60j || []).length > 0) lignes.push(`**🚚 Assurances** — ${veh.renouvellements_60j.length} renouvellement(s) dans les 60 jours : ${veh.renouvellements_60j.map((a: any) => `${a.compagnie || a.type} (${a.date})`).join(", ")}.`);

    // Série 6 derniers mois (marge nette) pour le graphique
    const chart = (fin.mois || [])
      .filter((m: any) => m.mois <= moisCourant)
      .slice(-6)
      .map((m: any) => ({ label: MOIS[m.mois], value: Math.round(m.marge || 0) }));

    return NextResponse.json({ ok: true, texte: lignes.join("\n"), chart, chartTitre: `Marge nette mensuelle ${annee} (avant taxes)` });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "erreur" }, { status: 500 });
  }
}

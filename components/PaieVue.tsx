"use client";

import { useEffect, useState } from "react";
import FAB from "@/components/FAB";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import { aujourdhuiMontreal } from "@/lib/date";
import { ecrire, envoyer, lireListe } from "@/lib/envoi";
import ErreurChargement from "@/components/ErreurChargement";

// Parse « AAAA-MM-JJ » comme minuit LOCAL (pas UTC). new Date("2026-05-18") = minuit
// UTC → affiché « 17 mai » à Montréal (UTC−4). Ici on garde le bon jour.
function dateLocale(iso: string): Date {
  const s = String(iso || "").slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  return (y && m && d) ? new Date(y, m - 1, d) : new Date(iso);
}

// Vue Paie (suivi bi-hebdo + banque d'heures) — réutilisée par /finances/paye et l'onglet Finances.
export default function PaieVue() {
  const [periodes, setPeriodes] = useState<any[]>([]);
  const [employes, setEmployes] = useState<any[]>([]);
  const [filtreEmp, setFiltreEmp] = useState("");
  const [filtreStatut, setFiltreStatut] = useState<"" | "paye" | "a_payer">("a_payer");
  const { toast } = useToast();

  const [erreur, setErreur] = useState<string | null>(null);
  const charger = async () => {
    // Lectures avec filet : un 500 rejetait la promesse et laissait la liste vide,
    // comme s'il n'y avait « aucune période ».
    const [p, e] = await Promise.all([
      lireListe(filtreEmp ? `/api/paies?employe=${encodeURIComponent(filtreEmp)}` : "/api/paies"),
      lireListe("/api/employes"),
    ]);
    if (!p.ok) { setErreur(p.erreur); return; }
    setErreur(null);
    setPeriodes(p.data);
    if (e.ok) setEmployes(e.data);
  };

  useEffect(() => { charger(); }, [filtreEmp]);

  const togglePaye = async (p: any) => {
    const nouveau = !p.paye;
    if (nouveau) {
      const date = aujourdhuiMontreal();
      const lisible = new Date().toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" });
      if (!confirm(`Marquer la paye de ${p.employe} comme payée aujourd'hui (${lisible}) ?`)) return;
      if (!(await ecrire("/api/paies", "PATCH", { id: p.id, paye: true, date_paiement: date }, "Enregistrement"))) return;
      toast(`✓ Paye marquée payée — ${p.employe}`, "success");
    } else {
      if (!(await ecrire("/api/paies", "PATCH", { id: p.id, paye: false }, "Enregistrement"))) return;
      toast("Paye remise en attente", "info");
    }
    charger();
  };

  /** Le talon n'est produit que pour les employés marqués « Reçoit un talon de paie »
   *  (/employes). Un employé absent de la liste (ex. désactivé) n'en reçoit pas non plus. */
  const aDroitAuTalon = (nomEmploye: string): boolean => {
    const e = employes.find((x) => x.nom === nomEmploye);
    // Employé inconnu de la liste (désactivé après une fin d'emploi, ou nom corrigé
    // depuis) : on garde le talon accessible. Un talon de paie doit rester réimprimable
    // après le départ ; seule une case explicitement décochée le retire.
    if (!e) return true;
    return (e.recoit_talon ?? 1) !== 0;
  };

  const telechargerTalon = async (p: any) => {
    try {
      const { genererTalonPaieBlob } = await import("@/lib/pdf-talon-paie");
      const blob = await genererTalonPaieBlob({
        employe: p.employe, debut: p.debut, fin: p.fin,
        heures_normales: p.heures_normales || 0, heures_sup: p.heures_sup || 0,
        taux_horaire: p.taux_horaire || 0, das_pct: p.das_pct || 0.15,
        montant_brut: p.montant_brut || 0, das_montant: p.das_montant || 0,
        montant_net: p.montant_net || 0, date_paiement: p.date_paiement,
        // Quinzaine à plusieurs taux : le talon ventile les gains ligne par ligne.
        gains_par_taux: p.gains_par_taux,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `talon-paie-${p.employe.replace(/\s+/g, "-")}-${p.debut}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`✓ Talon de paie généré — ${p.employe}`, "success");
    } catch (e: any) {
      toast("Erreur génération talon : " + (e.message || ""), "error");
    }
  };

  const appliquerBanque = async (p: any, heures: number) => {
    if (!(await ecrire("/api/paies", "PATCH", { id: p.id, banque_appliquee: heures }, "Enregistrement"))) return;
    toast(heures > 0 ? `🏦 ${heures.toFixed(1)} h tirées de la banque` : "Banque retirée de cette période", heures > 0 ? "success" : "info");
    charger();
  };

  const supprimer = async (p: any) => {
    if (!confirm(`Supprimer la période de paye de ${p.employe} (${p.debut} → ${p.fin}) ?`)) return;
    if (!(await ecrire(`/api/paies?id=${p.id}`, "DELETE", undefined, "Suppression"))) return;
    toast("Période supprimée", "info");
    charger();
  };

  const nettoyerOrphelines = async () => {
    if (!confirm("Supprimer les périodes de paye sans heures saisies ?")) return;
    // Réponse vérifiée : un 401 affichait « 0 période(s) supprimée(s) » en VERT.
    const res = await envoyer<{ supprimees?: number }>("/api/paies?orphelines=1", { methode: "DELETE" });
    if (!res.ok) { toast(`Nettoyage refusé : ${res.erreur}`, "error"); return; }
    toast(`${res.data?.supprimees || 0} période(s) orpheline(s) supprimée(s)`, "success");
    charger();
  };

  const filtrees = periodes.filter((p) => {
    if (filtreStatut === "paye" && !p.paye) return false;
    if (filtreStatut === "a_payer" && p.paye) return false;
    return true;
  });

  const totaux = filtrees.reduce(
    (s, p) => ({
      hN: s.hN + (p.heures_normales || 0),
      hT: s.hT + (p.heures_travaillees ?? p.heures_normales ?? 0),
      brut: s.brut + (p.montant_brut || 0),
      das: s.das + (p.das_montant || 0),
      net: s.net + (p.montant_net || 0),
    }),
    { hN: 0, hT: 0, brut: 0, das: 0, net: 0 }
  );

  // Le versement se fait au BRUT (aucune retenue à la source sur le paiement — le talon PDF
  // remis à l'employé affiche d'ailleurs le brut). L'ancien calcul au net sous-estimait de
  // ~15 % ce qu'il reste réellement à débourser.
  const aPayerTotal = periodes.filter((p) => !p.paye).reduce((s, p) => s + (p.montant_brut || 0), 0);

  // Calculé sur TOUTES les périodes, pas seulement celles affichées : le filtre par
  // défaut est « À payer », qui masque justement les périodes payées où ces heures
  // dorment. Sans ce bandeau, l'alerte serait invisible là où elle compte.
  const nonPayees = periodes.filter((p) => (p.heures_non_payees || 0) > 0);
  const totalNonPayees = nonPayees.reduce((s, p) => s + (p.heures_non_payees || 0), 0);

  return (
    <>
      <div className="space-y-4">
        {/* Section employés directe */}
        <section className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-lg p-3 flex justify-between items-center flex-wrap gap-2">
          <div className="text-sm">
            <strong className="text-emerald-900">👷 {employes.length} employé(s)</strong>
            <span className="text-slate-600 ml-2">— Pour modifier le salaire horaire, adresse, contact d'urgence, spécimen chèque, etc.</span>
          </div>
          <a href="/employes" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold">Gérer les employés →</a>
        </section>

        {/* === BANQUE D'HEURES par employé === */}
        {(() => {
          const dernierePar = new Map<string, any>();
          for (const p of periodes) {
            const prec = dernierePar.get(p.employe);
            if (!prec || p.debut > prec.debut) dernierePar.set(p.employe, p);
          }
          const banques = [...dernierePar.entries()].map(([emp, p]) => ({ emp, solde: p.banque_solde || 0, taux: p.taux_horaire || 0 }));
          const totalBanque = banques.reduce((s, b) => s + b.solde, 0);
          if (banques.length === 0) return null;
          return (
            <section className="bg-gradient-to-br from-indigo-50 to-violet-50 border-2 border-indigo-300 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <h2 className="font-bold text-indigo-900">🏦 Banque d'heures disponibles</h2>
                  <p className="text-xs text-indigo-700">Surplus au-delà de 80 h/période — payables plus tard sur les périodes sous 80 h.</p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-indigo-700 uppercase font-semibold">Total banque</div>
                  <div className="text-xl font-bold text-indigo-900">{totalBanque.toFixed(2)} h</div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {banques.map((b) => (
                  <div key={b.emp} className={`bg-white rounded p-3 border-l-4 ${b.solde > 0 ? "border-indigo-500" : "border-slate-300"}`}>
                    <div className="font-bold text-sm text-slate-900">{b.emp}</div>
                    <div className={`text-2xl font-bold ${b.solde > 0 ? "text-indigo-700" : "text-slate-400"}`}>{b.solde.toFixed(2)} h</div>
                    {b.solde > 0 && b.taux > 0 && (
                      <div className="text-[10px] text-slate-500">≈ {formatCAD(b.solde * b.taux)} brut payable</div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-indigo-800 italic mt-2">💡 Ces heures sont automatiquement proposées pour combler une période future sous 80 h.</p>
            </section>
          );
        })()}

        {/* Heures travaillées après un versement : elles n'entrent dans AUCUNE paye. */}
        {totalNonPayees > 0 && (
          <section className="bg-amber-50 border border-amber-300 rounded-lg p-4">
            <h3 className="font-bold text-amber-900 text-sm">⚠ {totalNonPayees} h travaillées ne sont dans aucune paye</h3>
            <p className="text-xs text-amber-800 mt-1">
              Ces heures ont été saisies <strong>après</strong> que la période a été marquée payée. Le montant versé n'a pas été
              recalculé (et ne doit pas l'être tout seul) : il faut les régler à part, ou annuler le paiement de la période
              puis le refaire.
            </p>
            <ul className="text-xs text-amber-900 mt-2 space-y-0.5">
              {nonPayees.map((p) => (
                <li key={p.id}>
                  • <strong>{p.employe}</strong> — {dateLocale(p.debut).toLocaleDateString("fr-CA", { day: "numeric", month: "short" })} au{" "}
                  {dateLocale(p.fin).toLocaleDateString("fr-CA", { day: "numeric", month: "short" })} : {p.heures_travaillees} h travaillées,{" "}
                  {p.heures_normales} h payées → <strong>{p.heures_non_payees} h dues</strong>
                  {p.taux_horaire ? ` (≈ ${formatCAD((p.heures_non_payees || 0) * p.taux_horaire)})` : ""}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <KPI label="À payer (brut)" value={formatCAD(aPayerTotal)} couleur="text-red-700" />
          <KPI label="Total filtré (brut)" value={formatCAD(totaux.brut)} />
          <KPI label="DAS estimé (non retenu)" value={formatCAD(totaux.das)} couleur="text-slate-600" />
        </div>

        {/* Filtres */}
        <div className="bg-white rounded-lg shadow p-3 flex gap-2 flex-wrap items-center">
          <select value={filtreEmp} onChange={(e) => setFiltreEmp(e.target.value)} className="px-3 py-2 border rounded text-sm bg-white">
            <option value="">Tous les employés</option>
            {employes.map((e) => <option key={e.id} value={e.nom}>{e.nom}</option>)}
          </select>
          <div className="flex gap-1">
            <button onClick={() => setFiltreStatut("")} className={`px-3 py-2 rounded text-xs font-semibold ${filtreStatut === "" ? "bg-slate-900 text-white" : "bg-slate-100"}`}>Tous</button>
            <button onClick={() => setFiltreStatut("a_payer")} className={`px-3 py-2 rounded text-xs font-semibold ${filtreStatut === "a_payer" ? "bg-red-600 text-white" : "bg-red-100 text-red-900"}`}>À payer</button>
            <button onClick={() => setFiltreStatut("paye")} className={`px-3 py-2 rounded text-xs font-semibold ${filtreStatut === "paye" ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-900"}`}>Payés</button>
          </div>
          <button onClick={nettoyerOrphelines} className="ml-auto px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold" title="Supprimer les périodes sans heures">🧹 Nettoyer orphelines</button>
          <span className="text-xs text-slate-500">{filtrees.length} période(s)</span>
        </div>

        {/* Liste périodes */}
        {erreur ? (
          <ErreurChargement erreur={erreur} onReessayer={charger} />
        ) : filtrees.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">💵</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucune période</h3>
            <p className="text-sm text-slate-500">Saisis des heures sur le tableau de bord pour voir apparaître les périodes de paye.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtrees.map((p) => (
              <div key={p.id} className={`bg-white rounded-lg shadow p-4 border-l-4 ${p.paye ? "border-emerald-500" : "border-red-500"}`}>
                <div className="flex justify-between items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-slate-900">{p.employe}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded font-semibold ${p.paye ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>
                        {p.paye ? `✓ Payé ${p.date_paiement ? dateLocale(p.date_paiement).toLocaleDateString("fr-CA", { day: "numeric", month: "short" }) : ""}` : "À payer"}
                      </span>
                      {/* Feuille de temps saisie APRÈS le versement : ces heures étaient
                          acceptées en base mais n'atteignaient jamais la paie, sans le
                          moindre signal. C'est de l'argent dû à l'employé. */}
                      {(p.heures_non_payees || 0) > 0 && (
                        <span
                          className="text-xs px-2 py-0.5 rounded font-semibold bg-amber-100 text-amber-900 border border-amber-300"
                          title={`${p.heures_travaillees} h travaillées, ${p.heures_normales} h payées. Ces heures ont été saisies après le versement : elles ne sont dans aucune paye.`}
                        >
                          ⚠ {p.heures_non_payees} h travaillées non payées
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Période : <strong>{dateLocale(p.debut).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" })}</strong> → <strong>{dateLocale(p.fin).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" })}</strong>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {/* Talon réservé aux employés qui en reçoivent un (réglage sur la fiche
                        employé) — les propriétaires ne s'en produisent pas à eux-mêmes. */}
                    {aDroitAuTalon(p.employe) && (
                      <button onClick={() => telechargerTalon(p)} className="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded text-sm font-semibold" title="Talon de paie PDF">📄 Talon</button>
                    )}
                    <button
                      onClick={() => togglePaye(p)}
                      className={`px-4 py-2 rounded font-bold text-sm ${p.paye ? "bg-slate-200 hover:bg-slate-300 text-slate-700" : "bg-emerald-600 hover:bg-emerald-500 text-white"}`}
                    >
                      {p.paye ? "↩ Annuler" : "✓ Marquer payé"}
                    </button>
                    {!p.paye && (
                      <button onClick={() => supprimer(p)} className="px-2 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm" title="Supprimer">🗑</button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-3 text-sm">
                  <div className="bg-slate-50 p-2 rounded">
                    <div className="text-[10px] text-slate-500 uppercase">Heures travaillées</div>
                    <div className="font-bold">{(p.heures_travaillees ?? p.heures_normales ?? 0).toFixed(1)} h</div>
                  </div>
                  <div className="bg-slate-50 p-2 rounded">
                    <div className="text-[10px] text-slate-500 uppercase">Heures payées</div>
                    <div className="font-bold">{(p.heures_normales || 0).toFixed(1)} h</div>
                  </div>
                  <div className={`p-2 rounded ${(p.banque_solde || 0) > 0 ? "bg-indigo-50" : "bg-slate-50"}`}>
                    <div className="text-[10px] text-slate-500 uppercase">Banque (solde)</div>
                    <div className={`font-bold ${(p.banque_solde || 0) > 0 ? "text-indigo-700" : ""}`}>{(p.banque_solde || 0).toFixed(1)} h</div>
                  </div>
                  <div className="bg-slate-50 p-2 rounded">
                    <div className="text-[10px] text-slate-500 uppercase">Taux $/h</div>
                    <div className="font-bold">{formatCAD(p.taux_horaire || 0)}</div>
                  </div>
                  <div className="bg-emerald-50 p-2 rounded" title="Montant réellement versé à l'employé">
                    <div className="text-[10px] text-emerald-700 uppercase">Versé (brut)</div>
                    <div className="font-bold text-emerald-900">{formatCAD(p.montant_brut || 0)}</div>
                  </div>
                  <div className="bg-slate-50 p-2 rounded" title="Estimation des déductions à la source — non retenue sur le versement">
                    <div className="text-[10px] text-slate-500 uppercase">DAS estimé</div>
                    <div className="font-bold text-slate-700">{formatCAD(p.das_montant || 0)}</div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-slate-500">
                  {(() => {
                    const trav = p.heures_travaillees ?? p.heures_normales ?? 0;
                    const surplus = Math.max(0, trav - 80);
                    if (surplus > 0.01) return <span className="text-indigo-700">🏦 {surplus.toFixed(1)} h accumulées en banque (payées plus tard)</span>;
                    const appliquee = p.banque_appliquee || 0;
                    if (appliquee > 0.01) return <span className="text-indigo-700">🏦 {appliquee.toFixed(1)} h tirées de la banque pour compléter la période</span>;
                    return null;
                  })()}
                </div>

                {!p.paye && (() => {
                  const trav = p.heures_travaillees ?? p.heures_normales ?? 0;
                  const manque = Math.max(0, 80 - trav);
                  const dispo = p.banque_dispo || 0;
                  const appliquee = p.banque_appliquee || 0;
                  const suggestion = Math.min(manque, dispo);
                  if (manque < 0.01) return null;
                  if (appliquee > 0.01) {
                    return (
                      <div className="mt-2 bg-indigo-50 border border-indigo-200 rounded p-2 flex items-center justify-between gap-2 flex-wrap text-xs">
                        <span className="text-indigo-900">🏦 <strong>{appliquee.toFixed(1)} h</strong> de banque appliquées sur cette période ({manque.toFixed(1)} h manquantes pour 80 h).</span>
                        <button onClick={() => appliquerBanque(p, 0)} className="px-3 py-1.5 bg-white border border-indigo-300 hover:bg-indigo-100 text-indigo-700 rounded font-semibold">↩ Annuler</button>
                      </div>
                    );
                  }
                  if (dispo < 0.01) return null;
                  return (
                    <div className="mt-2 bg-indigo-50 border border-indigo-200 rounded p-2 flex items-center justify-between gap-2 flex-wrap text-xs">
                      <span className="text-indigo-900">🏦 Période sous 80 h ({manque.toFixed(1)} h manquantes). <strong>{dispo.toFixed(1)} h</strong> disponibles en banque.</span>
                      <button onClick={() => appliquerBanque(p, suggestion)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-semibold">🏦 Combler {suggestion.toFixed(1)} h depuis la banque</button>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>
      <FAB onSuccess={charger} />
    </>
  );
}

function KPI({ label, value, couleur }: { label: string; value: string; couleur?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-3">
      <div className="text-[10px] text-slate-500 uppercase font-semibold">{label}</div>
      <div className={`text-lg font-bold mt-1 ${couleur || "text-slate-900"}`}>{value}</div>
    </div>
  );
}

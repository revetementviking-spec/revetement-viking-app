"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import FAB from "@/components/FAB";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";

export default function PayePage() {
  const [periodes, setPeriodes] = useState<any[]>([]);
  const [employes, setEmployes] = useState<any[]>([]);
  const [filtreEmp, setFiltreEmp] = useState("");
  const [filtreStatut, setFiltreStatut] = useState<"" | "paye" | "a_payer">("a_payer");
  const { toast } = useToast();

  const charger = async () => {
    const [p, e] = await Promise.all([
      fetch(filtreEmp ? `/api/paies?employe=${encodeURIComponent(filtreEmp)}` : "/api/paies").then((r) => r.json()),
      fetch("/api/employes").then((r) => r.json()),
    ]);
    setPeriodes(p);
    setEmployes(e);
  };

  useEffect(() => { charger(); }, [filtreEmp]);

  const togglePaye = async (p: any) => {
    const nouveau = !p.paye;
    if (nouveau) {
      const date = new Date().toISOString().slice(0, 10);
      const lisible = new Date().toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" });
      if (!confirm(`Marquer la paye de ${p.employe} comme payée aujourd'hui (${lisible}) ?`)) return;
      await fetch("/api/paies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, paye: true, date_paiement: date }) });
      toast(`✓ Paye marquée payée — ${p.employe}`, "success");
    } else {
      await fetch("/api/paies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, paye: false }) });
      toast("Paye remise en attente", "info");
    }
    charger();
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

  const supprimer = async (p: any) => {
    if (!confirm(`Supprimer la période de paye de ${p.employe} (${p.debut} → ${p.fin}) ?`)) return;
    await fetch(`/api/paies?id=${p.id}`, { method: "DELETE" });
    toast("Période supprimée", "info");
    charger();
  };

  const nettoyerOrphelines = async () => {
    if (!confirm("Supprimer les périodes de paye sans heures saisies ?")) return;
    const r = await fetch("/api/paies?orphelines=1", { method: "DELETE" });
    const d = await r.json();
    toast(`${d.supprimees || 0} période(s) orpheline(s) supprimée(s)`, "success");
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

  const aPayerTotal = periodes.filter((p) => !p.paye).reduce((s, p) => s + (p.montant_net || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation
        titre="💵 Paie"
        soustitre="Suivi bi-hebdomadaire · DAS 15% · banque d'heures (max 80 h/période)"
        actions={
          <a href="/employes" className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm font-semibold text-slate-700 text-left">
            👷 Employés (salaires, infos)
          </a>
        }
      />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* Section employés directe */}
        <section className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-lg p-3 flex justify-between items-center flex-wrap gap-2">
          <div className="text-sm">
            <strong className="text-emerald-900">👷 {employes.length} employé(s)</strong>
            <span className="text-slate-600 ml-2">— Pour modifier le salaire horaire, adresse, contact d'urgence, spécimen chèque, etc.</span>
          </div>
          <a href="/employes" className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold">Gérer les employés →</a>
        </section>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="À payer" value={formatCAD(aPayerTotal)} couleur="text-red-700" />
          <KPI label="Total filtré (brut)" value={formatCAD(totaux.brut)} />
          <KPI label="DAS retenue" value={formatCAD(totaux.das)} couleur="text-amber-700" />
          <KPI label="Total net" value={formatCAD(totaux.net)} couleur="text-emerald-700" />
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
        {filtrees.length === 0 ? (
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
                        {p.paye ? `✓ Payé ${p.date_paiement ? new Date(p.date_paiement).toLocaleDateString("fr-CA", { day: "numeric", month: "short" }) : ""}` : "À payer"}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Période : <strong>{new Date(p.debut).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" })}</strong> → <strong>{new Date(p.fin).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" })}</strong>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => telechargerTalon(p)} className="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded text-sm font-semibold" title="Talon de paie PDF">📄 Talon</button>
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
                    <div className="font-bold">{(p.taux_horaire || 0).toFixed(2)} $</div>
                  </div>
                  <div className="bg-blue-50 p-2 rounded">
                    <div className="text-[10px] text-blue-700 uppercase">Brut</div>
                    <div className="font-bold text-blue-900">{formatCAD(p.montant_brut || 0)}</div>
                  </div>
                  <div className="bg-emerald-50 p-2 rounded">
                    <div className="text-[10px] text-emerald-700 uppercase">Net (après DAS)</div>
                    <div className="font-bold text-emerald-900">{formatCAD(p.montant_net || 0)}</div>
                  </div>
                </div>

                <div className="mt-2 text-xs text-slate-500">
                  DAS retenue (15%) : <strong>{formatCAD(p.das_montant || 0)}</strong>
                  {(() => {
                    const trav = p.heures_travaillees ?? p.heures_normales ?? 0;
                    const surplus = trav - (p.heures_normales || 0);
                    if (surplus > 0.01) return <span className="ml-3 text-indigo-700">🏦 {surplus.toFixed(1)} h accumulées en banque (payées plus tard)</span>;
                    if (surplus < -0.01) return <span className="ml-3 text-indigo-700">🏦 {Math.abs(surplus).toFixed(1)} h tirées de la banque pour compléter la période</span>;
                    return null;
                  })()}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
      <FAB onSuccess={charger} />
    </div>
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

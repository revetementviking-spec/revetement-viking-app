"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import FAB from "@/components/FAB";
import DepensesVue from "@/components/DepensesVue";
import { formatCAD } from "@/lib/calculateur";

const MOIS = ["", "Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];

export default function FinancesPage() {
  const [onglet, setOnglet] = useState<"apercu" | "depenses">("apercu");
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [data, setData] = useState<any>(null);
  const [projets, setProjets] = useState<any[]>([]);

  // Permet d'ouvrir directement l'onglet Dépenses via /finances?tab=depenses
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "depenses") {
      setOnglet("depenses");
    }
  }, []);

  useEffect(() => {
    if (onglet !== "apercu") return;
    fetch(`/api/finances?annee=${annee}`).then((r) => r.json()).then(setData);
    fetch("/api/projets").then((r) => r.json()).then(setProjets);
  }, [annee, onglet]);

  const Tabs = (
    <div className="flex gap-2 border-b">
      <button onClick={() => setOnglet("apercu")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${onglet === "apercu" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>💰 Vue d'ensemble</button>
      <button onClick={() => setOnglet("depenses")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${onglet === "depenses" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>💸 Dépenses</button>
    </div>
  );

  // Onglet DÉPENSES
  if (onglet === "depenses") return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="💰 Finances" soustitre="Vue d'ensemble · Dépenses" />
      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {Tabs}
        <DepensesVue />
      </main>
    </div>
  );

  // Onglet VUE D'ENSEMBLE
  if (!data) return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="💰 Finances" soustitre="Vue d'ensemble · Dépenses" />
      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {Tabs}
        <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">Chargement...</div>
      </main>
    </div>
  );

  const totaux = data.mois.reduce((s: any, m: any) => ({
    facture: s.facture + m.facture, paye: s.paye + m.paye,
    depenses: s.depenses + m.depenses, mo: s.mo + m.mo, marge: s.marge + m.marge,
    revenu: s.revenu + (m.revenu || 0),
  }), { facture: 0, paye: 0, depenses: 0, mo: 0, marge: 0, revenu: 0 });

  const max = Math.max(...data.mois.map((m: any) => Math.max(m.revenu || 0, m.depenses + m.mo)), 1);

  // Totaux par projet
  const totauxProjets = projets.reduce(
    (s, p) => ({
      contrat: s.contrat + (p.prix_contrat || p.budget_estime || 0),
      facture: s.facture + (p.total_facture || 0),
      paye: s.paye + (p.total_paye || 0),
      cout: s.cout + (p.cout_total || 0),
      marge: s.marge + (p.marge || 0),
    }),
    { contrat: 0, facture: 0, paye: 0, cout: 0, marge: 0 }
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="💰 Finances" soustitre={`Année ${annee}`} />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {Tabs}
        <div className="flex items-center justify-end gap-2">
          <button onClick={() => setAnnee(annee - 1)} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-sm font-bold">← {annee - 1}</button>
          <span className="px-3 py-1.5 bg-emerald-100 text-emerald-900 rounded text-sm font-bold">{annee}</span>
          <button onClick={() => setAnnee(annee + 1)} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-sm font-bold">{annee + 1} →</button>
        </div>
        {/* === REVENUS DES PROJETS (somme prix_contrat) === */}
        <section className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-lg p-4 md:p-5">
          <h2 className="font-bold text-emerald-900 mb-3">💰 Revenus des projets</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <KPI label="Valeur contrats" value={formatCAD(totauxProjets.contrat)} couleur="text-slate-900" />
            <KPI label="Facturé" value={formatCAD(totauxProjets.facture)} couleur="text-blue-700" />
            <KPI label="Encaissé" value={formatCAD(totauxProjets.paye)} couleur="text-emerald-700" />
            <KPI label="Coûts totaux" value={formatCAD(totauxProjets.cout)} couleur="text-orange-700" />
            <KPI label="Marge" value={formatCAD(totauxProjets.marge)} couleur={totauxProjets.marge >= 0 ? "text-emerald-700" : "text-red-700"} />
          </div>

          {projets.length === 0 ? (
            <p className="text-sm text-slate-600 italic">Aucun projet enregistré.</p>
          ) : (
            <div className="bg-white rounded-lg overflow-x-auto">
              <table className="w-full text-sm min-w-max">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="p-2">Projet</th>
                    <th className="p-2">Statut</th>
                    <th className="p-2 text-right">Prix contrat</th>
                    <th className="p-2 text-right">Facturé</th>
                    <th className="p-2 text-right">Payé</th>
                    <th className="p-2 text-right">À recevoir</th>
                    <th className="p-2 text-right">Coût total</th>
                    <th className="p-2 text-right">Marge</th>
                    <th className="p-2 text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {projets.map((p) => {
                    const revenu = p.prix_contrat || p.budget_estime || 0;
                    const aRecevoir = (p.total_facture || 0) - (p.total_paye || 0);
                    return (
                      <tr key={p.id} className="border-t hover:bg-emerald-50">
                        <td className="p-2"><a href={`/projets/${p.id}`} className="font-medium hover:underline">{p.nom}</a><div className="text-[10px] text-slate-500">{p.client_nom || "—"}</div></td>
                        <td className="p-2 text-xs">{p.statut}</td>
                        <td className="p-2 text-right font-bold">{formatCAD(revenu)}</td>
                        <td className="p-2 text-right text-blue-700">{formatCAD(p.total_facture || 0)}</td>
                        <td className="p-2 text-right text-emerald-700">{formatCAD(p.total_paye || 0)}</td>
                        <td className={`p-2 text-right ${aRecevoir > 0 ? "text-amber-700 font-bold" : "text-slate-400"}`}>{aRecevoir > 0 ? formatCAD(aRecevoir) : "—"}</td>
                        <td className="p-2 text-right text-orange-700">{formatCAD(p.cout_total || 0)}</td>
                        <td className={`p-2 text-right font-bold ${p.marge < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatCAD(p.marge || 0)}</td>
                        <td className={`p-2 text-right font-bold text-xs ${p.marge < 0 ? "text-red-700" : "text-emerald-700"}`}>{(p.marge_pct || 0).toFixed(0)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-emerald-100 font-bold">
                  <tr>
                    <td className="p-2" colSpan={2}>TOTAL</td>
                    <td className="p-2 text-right">{formatCAD(totauxProjets.contrat)}</td>
                    <td className="p-2 text-right text-blue-700">{formatCAD(totauxProjets.facture)}</td>
                    <td className="p-2 text-right text-emerald-700">{formatCAD(totauxProjets.paye)}</td>
                    <td className="p-2 text-right text-amber-700">{formatCAD(totauxProjets.facture - totauxProjets.paye)}</td>
                    <td className="p-2 text-right text-orange-700">{formatCAD(totauxProjets.cout)}</td>
                    <td className={`p-2 text-right ${totauxProjets.marge < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatCAD(totauxProjets.marge)}</td>
                    <td className="p-2 text-right">{totauxProjets.contrat ? ((totauxProjets.marge / totauxProjets.contrat) * 100).toFixed(0) : 0}%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* === FLUX MENSUEL (basé sur dates des factures/dépenses) === */}
        <h2 className="text-lg font-bold text-slate-900">📅 Flux mensuel — {annee}</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KPI label="Revenus projets" value={formatCAD(totaux.revenu)} couleur="text-emerald-700" sub="contrats + factures" />
          <KPI label="Dépenses" value={formatCAD(totaux.depenses)} couleur="text-orange-700" />
          <KPI label="Main-d'œuvre" value={formatCAD(totaux.mo)} couleur="text-amber-700" />
          <KPI label="Encaissé" value={formatCAD(totaux.paye)} couleur="text-blue-700" sub="payé reçu" />
          <KPI label="Net (reste)" value={formatCAD(totaux.marge)} couleur={totaux.marge >= 0 ? "text-emerald-700" : "text-red-700"} />
        </div>

        {/* Graphique mensuel */}
        <section className="bg-white rounded-lg shadow p-4 md:p-5">
          <h2 className="font-semibold mb-3">Mois par mois</h2>
          <div className="space-y-2">
            {data.mois.map((m: any) => (
              <div key={m.mois} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-bold w-12">{MOIS[m.mois]}</span>
                  <span className={m.marge >= 0 ? "text-emerald-700 font-bold" : "text-red-700 font-bold"}>
                    Net {formatCAD(m.marge)}
                  </span>
                </div>
                <div className="flex gap-1 h-6">
                  <div className="bg-emerald-500 rounded" style={{ width: `${((m.revenu || 0) / max) * 100}%`, minWidth: (m.revenu || 0) > 0 ? 4 : 0 }} title={`Revenus projets ${formatCAD(m.revenu || 0)}`} />
                  <div className="bg-orange-400 rounded" style={{ width: `${(m.depenses / max) * 100}%`, minWidth: m.depenses > 0 ? 4 : 0 }} title={`Dépenses ${formatCAD(m.depenses)}`} />
                  <div className="bg-amber-400 rounded" style={{ width: `${(m.mo / max) * 100}%`, minWidth: m.mo > 0 ? 4 : 0 }} title={`MO ${formatCAD(m.mo)}`} />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 px-12">
                  <span>Revenus : <strong className="text-emerald-700">{formatCAD(m.revenu || 0)}</strong>{m.facture === 0 && (m.revenu || 0) > 0 ? " (contrat)" : ""}</span>
                  <span>Coûts : <strong className="text-orange-700">{formatCAD(m.depenses + m.mo)}</strong></span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 text-xs mt-3 flex-wrap">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-500 rounded" /> Revenus projets (contrat ou facturé)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-400 rounded" /> Dépenses</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-400 rounded" /> Main-d'œuvre</span>
          </div>
        </section>

      </main>
      <FAB />
    </div>
  );
}

function KPI({ label, value, couleur }: { label: string; value: any; couleur?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-3">
      <div className="text-[10px] text-slate-500 uppercase font-semibold">{label}</div>
      <div className={`text-lg font-bold mt-1 ${couleur || "text-slate-900"}`}>{value}</div>
    </div>
  );
}

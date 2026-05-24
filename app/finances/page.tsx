"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import FAB from "@/components/FAB";
import { formatCAD } from "@/lib/calculateur";

const MOIS = ["", "Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];

export default function FinancesPage() {
  const [annee, setAnnee] = useState(new Date().getFullYear());
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/finances?annee=${annee}`).then((r) => r.json()).then(setData);
  }, [annee]);

  if (!data) return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="💰 Finances" />
      <main className="max-w-7xl mx-auto p-4">
        <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">Chargement...</div>
      </main>
    </div>
  );

  const totaux = data.mois.reduce((s: any, m: any) => ({
    facture: s.facture + m.facture, paye: s.paye + m.paye,
    depenses: s.depenses + m.depenses, mo: s.mo + m.mo, marge: s.marge + m.marge,
  }), { facture: 0, paye: 0, depenses: 0, mo: 0, marge: 0 });

  const max = Math.max(...data.mois.map((m: any) => Math.max(m.facture, m.depenses + m.mo)), 1);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="💰 Finances" soustitre={`Année ${annee}`} actions={
        <div className="flex gap-1">
          <button onClick={() => setAnnee(annee - 1)} className="px-3 py-2 bg-slate-200 rounded text-sm">←</button>
          <button onClick={() => setAnnee(annee + 1)} className="px-3 py-2 bg-slate-200 rounded text-sm">→</button>
        </div>
      } />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* KPIs totaux année */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KPI label="Facturé" value={formatCAD(totaux.facture)} couleur="text-blue-700" />
          <KPI label="Encaissé" value={formatCAD(totaux.paye)} couleur="text-emerald-700" />
          <KPI label="Dépenses" value={formatCAD(totaux.depenses)} couleur="text-orange-700" />
          <KPI label="Main-d'œuvre" value={formatCAD(totaux.mo)} couleur="text-amber-700" />
          <KPI label="Marge" value={formatCAD(totaux.marge)} couleur={totaux.marge >= 0 ? "text-emerald-700" : "text-red-700"} />
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
                    Marge {formatCAD(m.marge)}
                  </span>
                </div>
                <div className="flex gap-1 h-6">
                  <div className="bg-blue-500 rounded" style={{ width: `${(m.facture / max) * 100}%`, minWidth: m.facture > 0 ? 4 : 0 }} title={`Facturé ${formatCAD(m.facture)}`} />
                  <div className="bg-orange-400 rounded" style={{ width: `${(m.depenses / max) * 100}%`, minWidth: m.depenses > 0 ? 4 : 0 }} title={`Dépenses ${formatCAD(m.depenses)}`} />
                  <div className="bg-amber-400 rounded" style={{ width: `${(m.mo / max) * 100}%`, minWidth: m.mo > 0 ? 4 : 0 }} title={`MO ${formatCAD(m.mo)}`} />
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3 text-xs mt-3">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded" /> Facturé</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-400 rounded" /> Dépenses</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-400 rounded" /> Main-d'œuvre</span>
          </div>
        </section>

        {/* Tableau détaillé */}
        <section className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm min-w-max">
            <thead className="bg-slate-100">
              <tr><th className="p-2 text-left">Mois</th><th className="p-2 text-right">Facturé</th><th className="p-2 text-right">Encaissé</th><th className="p-2 text-right">Dépenses</th><th className="p-2 text-right">MO</th><th className="p-2 text-right">Marge</th></tr>
            </thead>
            <tbody>
              {data.mois.map((m: any) => (
                <tr key={m.mois} className="border-t">
                  <td className="p-2 font-bold">{MOIS[m.mois]}</td>
                  <td className="p-2 text-right">{formatCAD(m.facture)}</td>
                  <td className="p-2 text-right text-emerald-700">{formatCAD(m.paye)}</td>
                  <td className="p-2 text-right text-orange-700">{formatCAD(m.depenses)}</td>
                  <td className="p-2 text-right text-amber-700">{formatCAD(m.mo)}</td>
                  <td className={`p-2 text-right font-bold ${m.marge >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatCAD(m.marge)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

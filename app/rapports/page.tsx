"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import FAB from "@/components/FAB";
import { formatCAD } from "@/lib/calculateur";

export default function RapportsPage() {
  const [projets, setProjets] = useState<any[]>([]);
  const [employes, setEmployes] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/projets").then((r) => r.json()).then(setProjets);
    fetch("/api/heures-sommaire?jours=30").then((r) => r.json()).then(setEmployes);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📊 Rapports" soustitre="Export CSV pour comptabilité" />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* Exports */}
        <section className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-lg p-5">
          <h2 className="font-bold text-emerald-900 mb-3">📥 Exports CSV</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <a href="/api/rapports?format=csv" download className="bg-white border-2 border-emerald-300 rounded-lg p-4 hover:bg-emerald-50 transition">
              <div className="font-bold text-emerald-900">📋 Tous les projets</div>
              <div className="text-xs text-slate-600">Budget, coût, marge, heures, facturé, payé</div>
            </a>
            <div className="bg-white border-2 border-emerald-300 rounded-lg p-4">
              <div className="font-bold text-emerald-900 mb-2">⏱️ Heures par projet</div>
              <select onChange={(e) => e.target.value && (window.location.href = `/api/rapports?projet_id=${e.target.value}&format=csv`)} className="w-full px-3 py-2 border rounded text-sm">
                <option value="">— Choisir un projet pour télécharger —</option>
                {projets.map((p) => <option key={p.id} value={p.id}>{p.nom} ({p.client_nom || "—"})</option>)}
              </select>
            </div>
          </div>
        </section>

        {/* Heures 30 derniers jours */}
        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="font-semibold mb-3">👷 Heures par employé · 30 derniers jours</h2>
          {employes.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune heure saisie sur cette période.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-100">
                <tr><th className="p-2 text-left">Employé</th><th className="p-2 text-right">Heures</th><th className="p-2 text-right">Jours</th><th className="p-2 text-right">Coût</th></tr>
              </thead>
              <tbody>
                {employes.map((e: any, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2 font-medium">{e.employe}</td>
                    <td className="p-2 text-right">{e.total_heures.toFixed(1)} h</td>
                    <td className="p-2 text-right">{e.n_jours}</td>
                    <td className="p-2 text-right font-bold">{formatCAD(e.cout_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Aperçu projets */}
        <section className="bg-white rounded-lg shadow p-5 overflow-x-auto">
          <h2 className="font-semibold mb-3">🏗️ Projets — aperçu rentabilité</h2>
          <table className="w-full text-sm min-w-max">
            <thead className="bg-slate-100">
              <tr><th className="p-2 text-left">Projet</th><th className="p-2 text-left">Client</th><th className="p-2 text-right">Budget</th><th className="p-2 text-right">Coût</th><th className="p-2 text-right">Marge</th><th className="p-2 text-right">%</th></tr>
            </thead>
            <tbody>
              {projets.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="p-2 font-medium"><a href={`/projets/${p.id}`} className="hover:underline">{p.nom}</a></td>
                  <td className="p-2 text-slate-600">{p.client_nom || "—"}</td>
                  <td className="p-2 text-right">{formatCAD(p.budget_estime || 0)}</td>
                  <td className="p-2 text-right text-amber-700">{formatCAD(p.cout_total)}</td>
                  <td className={`p-2 text-right font-bold ${p.marge < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatCAD(p.marge)}</td>
                  <td className="p-2 text-right">{p.marge_pct.toFixed(0)}%</td>
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

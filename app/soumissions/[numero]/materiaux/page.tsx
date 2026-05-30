"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Navigation from "@/components/Navigation";
import { formatCAD } from "@/lib/calculateur";

export default function MateriauxPage() {
  const params = useParams();
  const numero = params?.numero as string;
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!numero) return;
    fetch(`/api/soumissions/materiaux?numero=${numero}`).then((r) => r.json()).then(setData);
  }, [numero]);

  const imprimer = () => window.print();

  const csv = () => {
    if (!data) return;
    const rows = [["Description", "Quantité", "Unité", "Coût unit.", "Sous-total"]];
    data.liste.forEach((m: any) => rows.push([m.description, String(m.quantite), m.unite, String(m.cout_unit), String(m.sous_total)]));
    const blob = new Blob(["﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `materiaux-${numero}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (!data) return <div className="min-h-screen bg-slate-50"><Navigation titre="Liste de matériaux" /><div className="p-8 text-center text-slate-500">Chargement...</div></div>;
  if (data.error) return <div className="min-h-screen bg-slate-50"><Navigation titre="Liste de matériaux" /><div className="p-8 text-center text-red-600">{data.error}</div></div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📦 Liste de matériaux" soustitre={`Soumission ${data.numero} · ${data.client}`} actions={
        <div className="flex gap-2">
          <button onClick={imprimer} className="px-3 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm font-bold">🖨️ Imprimer</button>
          <button onClick={csv} className="px-3 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded text-sm font-bold">📊 CSV</button>
        </div>
      } />
      <main className="max-w-4xl mx-auto p-4 md:p-6 print:p-0">
        <div className="bg-white rounded-lg shadow p-5 print:shadow-none">
          <div className="border-b pb-3 mb-4">
            <h2 className="text-xl font-bold">Liste de matériaux pour {data.client}</h2>
            {data.adresse && <p className="text-sm text-slate-600">📍 {data.adresse}</p>}
            <p className="text-xs text-slate-500">Soumission {data.numero} · {data.date} · {data.nb_articles} ligne(s)</p>
          </div>
          {data.liste.length === 0 ? (
            <p className="text-center text-slate-500 py-8 italic">Aucun matériau dans cette soumission (seulement de la main d'œuvre ?)</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-100">
                <tr><th className="text-left p-2">Description</th><th className="text-right p-2">Qté</th><th className="text-left p-2">Unité</th><th className="text-right p-2">Coût unit.</th><th className="text-right p-2">Sous-total</th></tr>
              </thead>
              <tbody>
                {data.liste.map((m: any, i: number) => (
                  <tr key={i} className="border-b hover:bg-slate-50">
                    <td className="p-2 font-semibold">{m.description}</td>
                    <td className="p-2 text-right">{m.quantite}</td>
                    <td className="p-2 text-slate-500">{m.unite}</td>
                    <td className="p-2 text-right">{formatCAD(m.cout_unit)}</td>
                    <td className="p-2 text-right font-bold">{formatCAD(m.sous_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-emerald-50 font-bold">
                  <td colSpan={4} className="p-2 text-right">TOTAL MATÉRIAUX</td>
                  <td className="p-2 text-right text-emerald-800 text-lg">{formatCAD(data.total)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          <div className="mt-6 text-[10px] text-slate-400 border-t pt-3 print:block">
            Revêtement Viking Inc. · RBQ 5811-4299-01 · Liste générée le {new Date().toLocaleDateString("fr-CA")}
          </div>
        </div>
      </main>
    </div>
  );
}

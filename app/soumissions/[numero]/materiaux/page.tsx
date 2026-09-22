"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Navigation from "@/components/Navigation";
import { formatCAD } from "@/lib/calculateur";
import { lireJson } from "@/lib/envoi";
import ErreurChargement from "@/components/ErreurChargement";

export default function MateriauxPage() {
  const params = useParams();
  const numero = params?.numero as string;
  const [data, setData] = useState<any>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = () => {
    if (!numero) return;
    setErreur(null);
    // Lecture avec filet : un 500 ou un réseau coupé laissait « Chargement... » pour toujours.
    lireJson<any>(`/api/soumissions/materiaux?numero=${encodeURIComponent(numero)}`).then((r) => {
      if (r.ok && r.data && Array.isArray(r.data.liste)) setData(r.data);
      else setErreur(r.ok ? (r.data?.error || "réponse inattendue du serveur") : r.erreur);
    });
  };
  useEffect(() => { charger(); }, [numero]);

  const imprimer = () => window.print();

  const csv = () => {
    if (!data) return;
    const rows = [["Description", "À commander", "Format", "Mesuré", "Unité", "Coût / format", "Sous-total"]];
    data.liste.forEach((m: any) => rows.push([
      m.description, String(m.formats_a_commander ?? ""), m.format || "",
      String(Math.round((m.quantite_avec_surplus ?? m.quantite) * 10) / 10), m.unite,
      String(m.cout_unit), String(Math.round(m.sous_total * 100) / 100),
    ]));
    const blob = new Blob(["﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `materiaux-${numero}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (erreur) return <div className="min-h-screen bg-slate-50"><Navigation titre="Liste de matériaux" /><div className="p-6"><ErreurChargement erreur={erreur} onReessayer={charger} /></div></div>;
  if (!data) return <div className="min-h-screen bg-slate-50"><Navigation titre="Liste de matériaux" /><div className="p-8 text-center text-slate-500">Chargement...</div></div>;

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
            <p className="text-xs text-slate-500">
              Soumission {data.numero} · {String(data.date || "").slice(0, 10)} · {data.nb_articles} ligne(s)
            </p>
            {data.avertissement && <p className="text-xs text-amber-700 mt-1">⚠️ {data.avertissement}</p>}
          </div>
          {data.liste.length === 0 ? (
            <p className="text-center text-slate-500 py-8 italic">Aucun matériau dans cette soumission (seulement de la main d'œuvre ?)</p>
          ) : (
            // 6 colonnes = ~515 px : sans ce conteneur, la table débordait de l'écran d'un
            // téléphone (375 px) et poussait toute la page vers la droite. Même parade que
            // le tableau des Finances.
            <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="bg-slate-100">
                <tr>
                  <th className="text-left p-2">Description</th>
                  <th className="text-right p-2">À commander</th>
                  <th className="text-left p-2">Format</th>
                  <th className="text-right p-2">Mesuré (+ surplus)</th>
                  <th className="text-right p-2">Coût / format</th>
                  <th className="text-right p-2">Sous-total</th>
                </tr>
              </thead>
              <tbody>
                {data.liste.map((m: any, i: number) => (
                  <tr key={i} className="border-b hover:bg-slate-50">
                    <td className="p-2 font-semibold">{m.description}<div className="text-[10px] text-slate-400 font-normal">{m.categorie}</div></td>
                    {/* Ce qu'on commande vraiment : des formats entiers (boîtes, paquets) */}
                    <td className="p-2 text-right font-bold text-emerald-800 text-base">{m.formats_a_commander ?? "—"}</td>
                    <td className="p-2 text-slate-600 text-xs">{m.format}</td>
                    <td className="p-2 text-right text-slate-600">
                      {Math.round((m.quantite_avec_surplus ?? m.quantite) * 10) / 10} <span className="text-slate-400 text-xs">{m.unite}</span>
                    </td>
                    <td className="p-2 text-right">{formatCAD(m.cout_unit)}</td>
                    <td className="p-2 text-right font-bold">{formatCAD(m.sous_total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-emerald-50 font-bold">
                  <td colSpan={5} className="p-2 text-right">TOTAL MATÉRIAUX (coûtant)</td>
                  <td className="p-2 text-right text-emerald-800 text-lg">{formatCAD(data.total)}</td>
                </tr>
              </tfoot>
            </table>
            </div>
          )}
          <div className="mt-6 text-[10px] text-slate-400 border-t pt-3 print:block">
            Revêtement Viking Inc. · RBQ 5811-4299-01 · Liste générée le {new Date().toLocaleDateString("fr-CA")}
          </div>
        </div>
      </main>
    </div>
  );
}

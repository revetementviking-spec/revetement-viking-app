"use client";

import { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import FAB from "@/components/FAB";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";

const CATEGORIES = ["", "matériaux", "outils", "location", "sous-traitant", "transport", "permis", "essence", "autre"];

export default function DepensesPage() {
  const [depenses, setDepenses] = useState<any[]>([]);
  const [projets, setProjets] = useState<any[]>([]);
  const [recherche, setRecherche] = useState("");
  const [filtreCat, setFiltreCat] = useState("");
  const [filtreProj, setFiltreProj] = useState<string>("");
  const today = new Date().toISOString().slice(0, 10);
  const [depuis, setDepuis] = useState(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10));
  const [jusqu, setJusqu] = useState(today);
  const { toast } = useToast();

  const charger = async () => {
    const [d, p] = await Promise.all([
      fetch("/api/depenses?data=0").then((r) => r.json()),
      fetch("/api/projets").then((r) => r.json()),
    ]);
    setDepenses(d);
    setProjets(p);
  };

  useEffect(() => { charger(); }, []);

  const projNom = (id: number | null) => projets.find((p) => p.id === id)?.nom || "—";

  const filtrees = useMemo(() => {
    return depenses.filter((d) => {
      if (d.date < depuis || d.date > jusqu) return false;
      if (filtreCat && d.categorie !== filtreCat) return false;
      if (filtreProj === "aucun" && d.projet_id) return false;
      if (filtreProj && filtreProj !== "aucun" && d.projet_id !== +filtreProj) return false;
      if (recherche) {
        const q = recherche.toLowerCase();
        const fields = [d.fournisseur, d.description, d.categorie, projNom(d.projet_id)].filter(Boolean);
        if (!fields.some((f: any) => f.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [depenses, recherche, filtreCat, filtreProj, depuis, jusqu]);

  const total = filtrees.reduce((s, d) => s + (d.montant || 0), 0);
  const totalAvecRecu = filtrees.filter((d) => (d as any).a_recu || d.recu_data).reduce((s, d) => s + d.montant, 0);

  // Totaux par catégorie pour QB
  const parCat = filtrees.reduce((acc: any, d) => {
    const k = d.categorie || "autre";
    if (!acc[k]) acc[k] = 0;
    acc[k] += d.montant;
    return acc;
  }, {});

  const supprimer = async (id: number) => {
    if (!confirm("Supprimer cette dépense ?")) return;
    await fetch(`/api/depenses?id=${id}`, { method: "DELETE" });
    toast("Dépense supprimée", "info");
    charger();
  };

  const exportCSV = () => {
    const csv = ["Date,Fournisseur,Catégorie,Description,Projet,Montant,Reçu"]
      .concat(filtrees.map((d) => `"${d.date}","${(d.fournisseur || "").replace(/"/g, "'")}","${d.categorie || ""}","${(d.description || "").replace(/"/g, "'")}","${projNom(d.projet_id).replace(/"/g, "'")}",${d.montant.toFixed(2)},${(d as any).a_recu || d.recu_data ? "Oui" : "Non"}`))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `depenses-${depuis}_${jusqu}.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="💸 Dépenses" soustitre="Conciliation QuickBooks · Recherche · Export CSV" />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Total filtré" value={formatCAD(total)} couleur="text-orange-700" />
          <KPI label="Avec reçu" value={formatCAD(totalAvecRecu)} couleur="text-emerald-700" sub={`${filtrees.filter((d) => (d as any).a_recu || d.recu_data).length} sur ${filtrees.length}`} />
          <KPI label="Sans reçu" value={formatCAD(total - totalAvecRecu)} couleur="text-amber-700" sub="à régulariser" />
          <KPI label="Nb entrées" value={`${filtrees.length}`} />
        </div>

        {/* Recherche et filtres */}
        <section className="bg-white rounded-lg shadow p-3 space-y-2">
          <input type="search" placeholder="🔍 Rechercher fournisseur, description, projet..." value={recherche} onChange={(e) => setRecherche(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div>
              <label className="block text-[10px] font-medium text-slate-600 mb-1">Depuis</label>
              <input type="date" value={depuis} onChange={(e) => setDepuis(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-600 mb-1">Jusqu'à</label>
              <input type="date" value={jusqu} onChange={(e) => setJusqu(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm" />
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-600 mb-1">Catégorie</label>
              <select value={filtreCat} onChange={(e) => setFiltreCat(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm bg-white">
                {CATEGORIES.map((c) => <option key={c} value={c}>{c || "Toutes"}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-medium text-slate-600 mb-1">Projet</label>
              <select value={filtreProj} onChange={(e) => setFiltreProj(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm bg-white">
                <option value="">Tous</option>
                <option value="aucun">— Sans projet —</option>
                {projets.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => { setDepuis(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)); setJusqu(today); }} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold">7j</button>
            <button onClick={() => { setDepuis(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)); setJusqu(today); }} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold">30j</button>
            <button onClick={() => { setDepuis(`${new Date().getFullYear()}-01-01`); setJusqu(today); }} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold">Année</button>
            <button onClick={exportCSV} className="ml-auto px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold">📥 Export CSV (QuickBooks)</button>
          </div>
        </section>

        {/* Totaux par catégorie */}
        {Object.keys(parCat).length > 0 && (
          <section className="bg-white rounded-lg shadow p-3">
            <h2 className="text-sm font-bold mb-2">📊 Total par catégorie (filtrée)</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
              {Object.entries(parCat).sort(([, a]: any, [, b]: any) => b - a).map(([cat, montant]: any) => (
                <div key={cat} className="bg-slate-50 rounded p-2">
                  <div className="text-[10px] uppercase font-semibold text-slate-500 truncate">{cat}</div>
                  <div className="text-sm font-bold text-orange-700">{formatCAD(montant)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tableau */}
        <section className="bg-white rounded-lg shadow overflow-x-auto">
          {filtrees.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">Aucune dépense pour ces critères.</div>
          ) : (
            <table className="w-full text-sm min-w-max">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2">Fournisseur</th>
                  <th className="p-2">Catégorie</th>
                  <th className="p-2">Description</th>
                  <th className="p-2">Projet</th>
                  <th className="p-2 text-right">Montant</th>
                  <th className="p-2 text-center">Reçu</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtrees.map((d) => (
                  <tr key={d.id} className="border-t hover:bg-slate-50">
                    <td className="p-2 whitespace-nowrap">{d.date}</td>
                    <td className="p-2 font-semibold">{d.fournisseur || "—"}</td>
                    <td className="p-2"><span className="text-xs bg-amber-100 text-amber-900 px-2 py-0.5 rounded">{d.categorie || "—"}</span></td>
                    <td className="p-2 text-xs text-slate-600 max-w-xs truncate">{d.description || ""}</td>
                    <td className="p-2 text-xs">
                      {d.projet_id ? <a href={`/projets/${d.projet_id}`} className="text-blue-600 hover:underline">{projNom(d.projet_id)}</a> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="p-2 text-right font-bold text-orange-700 whitespace-nowrap">{formatCAD(d.montant)}</td>
                    <td className="p-2 text-center">
                      {(d as any).a_recu || d.recu_data ? (
                        <a
                          href={`/api/depenses/${d.id}/recu`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-700 hover:underline text-xs"
                        >📎 Voir</a>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <button onClick={() => supprimer(d.id)} className="text-xs text-red-600 hover:underline">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-100 font-bold">
                <tr>
                  <td className="p-2" colSpan={5}>TOTAL {filtrees.length} entrée(s)</td>
                  <td className="p-2 text-right text-orange-700">{formatCAD(total)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>
      </main>
      <FAB onSuccess={charger} />
    </div>
  );
}

function KPI({ label, value, sub, couleur }: { label: string; value: any; sub?: string; couleur?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-3">
      <div className="text-[10px] text-slate-500 uppercase font-semibold">{label}</div>
      <div className={`text-lg font-bold mt-1 ${couleur || "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

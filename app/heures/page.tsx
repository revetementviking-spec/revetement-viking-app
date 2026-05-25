"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import FAB from "@/components/FAB";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";

export default function HeuresPage() {
  const today = new Date().toISOString().slice(0, 10);
  const il_y_a_30j = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

  const [heures, setHeures] = useState<any[]>([]);
  const [projets, setProjets] = useState<any[]>([]);
  const [employes, setEmployes] = useState<any[]>([]);
  const [filtreEmp, setFiltreEmp] = useState("");
  const [depuis, setDepuis] = useState(il_y_a_30j);
  const [jusqu, setJusqu] = useState(today);
  const [editing, setEditing] = useState<any>(null);
  const { toast } = useToast();

  const charger = async () => {
    const params = new URLSearchParams();
    if (filtreEmp) params.set("employe", filtreEmp);
    params.set("depuis", depuis);
    params.set("jusqu_a", jusqu);
    const [h, p, e] = await Promise.all([
      fetch(`/api/heures?${params.toString()}`).then((r) => r.json()),
      fetch("/api/projets").then((r) => r.json()),
      fetch("/api/employes").then((r) => r.json()),
    ]);
    setHeures(h);
    setProjets(p);
    setEmployes(e);
  };

  useEffect(() => { charger(); }, [filtreEmp, depuis, jusqu]);

  const sauverEdit = async () => {
    if (!editing) return;
    const body = {
      id: editing.id,
      projet_id: editing.projet_id,
      date: editing.date,
      heures: +editing.heures,
      taux_horaire: +editing.taux_horaire,
      employe: editing.employe,
      description: editing.description,
    };
    const r = await fetch("/api/heures", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if ((await r.json()).ok) {
      toast("Heures mises à jour", "success");
      setEditing(null);
      charger();
    }
  };

  const supprimer = async (id: number) => {
    if (!confirm("Supprimer cette entrée d'heures ?")) return;
    await fetch(`/api/heures?id=${id}`, { method: "DELETE" });
    toast("Entrée supprimée", "info");
    charger();
  };

  const supprimerTout = async () => {
    if (heures.length === 0) return;
    if (!confirm(`Supprimer les ${heures.length} entrée(s) affichée(s) ?\n\nIRRÉVERSIBLE.`)) return;
    if (!confirm("Tu es ABSOLUMENT sûr ? Toutes les heures filtrées vont disparaître.")) return;
    await Promise.all(heures.map((h) => fetch(`/api/heures?id=${h.id}`, { method: "DELETE" })));
    toast(`${heures.length} entrée(s) supprimée(s)`, "success");
    charger();
  };

  const totalHeures = heures.reduce((s, h) => s + (h.heures || 0), 0);
  const totalCout = heures.reduce((s, h) => s + (h.heures || 0) * (h.taux_horaire || 0), 0);

  // Grouper par employé pour résumé
  const parEmploye = heures.reduce((acc: any, h) => {
    const k = h.employe || "—";
    if (!acc[k]) acc[k] = { heures: 0, cout: 0, n: 0 };
    acc[k].heures += h.heures || 0;
    acc[k].cout += (h.heures || 0) * (h.taux_horaire || 0);
    acc[k].n += 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="⏱️ Horaire" soustitre={`${heures.length} entrée(s) · ${totalHeures.toFixed(1)} h · cliquer ✏️ pour modifier`} />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* Filtres */}
        <section className="bg-white rounded-lg shadow p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Employé</label>
              <select value={filtreEmp} onChange={(e) => setFiltreEmp(e.target.value)} className="w-full px-3 py-2 border rounded text-sm bg-white">
                <option value="">Tous</option>
                {employes.map((e) => <option key={e.id} value={e.nom}>{e.nom}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Depuis</label>
              <input type="date" value={depuis} onChange={(e) => setDepuis(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Jusqu'à</label>
              <input type="date" value={jusqu} onChange={(e) => setJusqu(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" />
            </div>
            <div className="flex items-end gap-1">
              <button onClick={() => { setDepuis(new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)); setJusqu(today); }} className="flex-1 px-2 py-2 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold">7j</button>
              <button onClick={() => { setDepuis(il_y_a_30j); setJusqu(today); }} className="flex-1 px-2 py-2 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold">30j</button>
              <button onClick={() => { setDepuis("2026-01-01"); setJusqu(today); }} className="flex-1 px-2 py-2 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold">Tout</button>
            </div>
          </div>
        </section>

        {/* Résumé par employé */}
        {Object.keys(parEmploye).length > 0 && (
          <section className="bg-white rounded-lg shadow p-4">
            <h2 className="font-semibold mb-3">Résumé · {totalHeures.toFixed(1)} h · {formatCAD(totalCout)}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {Object.entries(parEmploye).map(([emp, d]: any) => (
                <div key={emp} className="bg-slate-50 rounded p-3">
                  <div className="font-bold text-slate-900">{emp}</div>
                  <div className="text-sm text-slate-600">{d.heures.toFixed(1)} h · {d.n} entrée(s)</div>
                  <div className="text-sm font-bold text-emerald-700">{formatCAD(d.cout)}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tableau heures */}
        <section className="bg-white rounded-lg shadow overflow-x-auto">
          <div className="p-3 flex justify-between items-center flex-wrap gap-2 border-b">
            <h2 className="font-semibold">Détail ({heures.length})</h2>
            {heures.length > 0 && (
              <button onClick={supprimerTout} className="text-xs text-red-600 hover:bg-red-50 px-3 py-1 rounded font-semibold">🗑 Tout supprimer (filtré)</button>
            )}
          </div>
          {heures.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">Aucune heure sur cette période.</div>
          ) : (
            <table className="w-full text-sm min-w-max">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-2">Date</th>
                  <th className="p-2">Employé</th>
                  <th className="p-2">Projet</th>
                  <th className="p-2 text-right">Heures</th>
                  <th className="p-2 text-right">$/h</th>
                  <th className="p-2 text-right">Coût</th>
                  <th className="p-2">Description</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {heures.map((h) => (
                  <tr key={h.id} className="border-t hover:bg-slate-50">
                    <td className="p-2 whitespace-nowrap">{h.date}</td>
                    <td className="p-2 font-medium">{h.employe || "—"}</td>
                    <td className="p-2 truncate max-w-xs">
                      {h.projet_nom ? <a href={`/projets/${h.projet_id}`} className="text-blue-600 hover:underline">{h.projet_nom}</a> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="p-2 text-right font-bold">{h.heures.toFixed(1)} h</td>
                    <td className="p-2 text-right">{(h.taux_horaire || 0).toFixed(2)} $</td>
                    <td className="p-2 text-right font-bold text-emerald-700">{formatCAD(h.heures * (h.taux_horaire || 0))}</td>
                    <td className="p-2 text-xs text-slate-600 truncate max-w-xs">{h.description || ""}</td>
                    <td className="p-2 text-right whitespace-nowrap">
                      <button onClick={() => setEditing({ ...h })} className="text-xs text-emerald-700 hover:underline mr-2">✏️ Modifier</button>
                      <button onClick={() => supprimer(h.id)} className="text-xs text-red-600 hover:underline">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {/* Modal édition */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Modifier l'entrée d'heures</h3>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
              <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Employé</label>
              <select value={editing.employe || ""} onChange={(e) => {
                const emp = employes.find(x => x.nom === e.target.value);
                setEditing({ ...editing, employe: e.target.value, taux_horaire: emp ? emp.taux_horaire : editing.taux_horaire });
              }} className="w-full px-3 py-2 border rounded text-sm bg-white">
                <option value="">—</option>
                {employes.map((e) => <option key={e.id} value={e.nom}>{e.nom}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Projet</label>
              <select value={editing.projet_id || ""} onChange={(e) => setEditing({ ...editing, projet_id: +e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                {projets.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Heures</label>
                <input type="number" step={0.5} value={editing.heures} onChange={(e) => setEditing({ ...editing, heures: e.target.value })} className="w-full px-3 py-2 border rounded text-sm text-right font-bold" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Taux $/h</label>
                <input type="number" step={0.01} value={editing.taux_horaire} onChange={(e) => setEditing({ ...editing, taux_horaire: e.target.value })} className="w-full px-3 py-2 border rounded text-sm text-right" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
              <input type="text" value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
            </div>
            <div className="bg-emerald-50 p-2 rounded text-sm flex justify-between">
              <span>Coût :</span>
              <strong className="text-emerald-700">{formatCAD(+editing.heures * +editing.taux_horaire)}</strong>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={sauverEdit} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">Sauver</button>
            </div>
          </div>
        </div>
      )}

      <FAB onSuccess={charger} />
    </div>
  );
}

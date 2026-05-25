"use client";

import { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import FAB from "@/components/FAB";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import { exporterCSV } from "@/lib/csv";

type Vue = "semaine" | "liste";

const JOURS_COURT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const JOURS_LONG = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

/** Retourne le lundi de la semaine d'une date (ISO YYYY-MM-DD). */
function lundiDe(date: Date): Date {
  const d = new Date(date);
  const jour = d.getDay(); // 0 = dim, 1 = lun, ..., 6 = sam
  const diff = jour === 0 ? -6 : 1 - jour;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function fmtISO(d: Date): string { return d.toISOString().slice(0, 10); }
function fmtCourt(d: Date): string { return d.toLocaleDateString("fr-CA", { day: "numeric", month: "short" }); }

export default function HoraireePage() {
  const [vue, setVue] = useState<Vue>("semaine");
  const [semaineDebut, setSemaineDebut] = useState<Date>(() => lundiDe(new Date()));
  const [heures, setHeures] = useState<any[]>([]);
  const [projets, setProjets] = useState<any[]>([]);
  const [employes, setEmployes] = useState<any[]>([]);
  const [filtreEmp, setFiltreEmp] = useState("");
  const [filtreProjet, setFiltreProjet] = useState<number | "">("");
  const [editing, setEditing] = useState<any>(null);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [triCol, setTriCol] = useState<"date" | "employe" | "projet" | "heures" | "cout">("date");
  const [triSens, setTriSens] = useState<"asc" | "desc">("desc");
  const [detailJour, setDetailJour] = useState<{ employe: string; date: string } | null>(null);
  const { toast } = useToast();

  // Plage de la semaine sélectionnée
  const debut = fmtISO(semaineDebut);
  const finD = new Date(semaineDebut); finD.setDate(finD.getDate() + 6);
  const fin = fmtISO(finD);

  const charger = async () => {
    const params = new URLSearchParams();
    if (filtreEmp) params.set("employe", filtreEmp);
    params.set("depuis", debut);
    params.set("jusqu_a", fin);
    const [h, p, e] = await Promise.all([
      fetch(`/api/heures?${params.toString()}`).then((r) => r.json()),
      fetch("/api/projets").then((r) => r.json()),
      fetch("/api/employes").then((r) => r.json()),
    ]);
    setHeures(Array.isArray(h) ? h : []);
    setProjets(Array.isArray(p) ? p : []);
    setEmployes(Array.isArray(e) ? e : []);
    setSelection(new Set());
  };

  useEffect(() => { charger(); }, [filtreEmp, debut, fin]);

  // Décalages semaine
  const reculer = () => { const d = new Date(semaineDebut); d.setDate(d.getDate() - 7); setSemaineDebut(d); };
  const avancer = () => { const d = new Date(semaineDebut); d.setDate(d.getDate() + 7); setSemaineDebut(d); };
  const cetteSemaine = () => setSemaineDebut(lundiDe(new Date()));

  // === GRILLE HEBDO : rows = employés, cols = 7 jours ===
  const heuresFiltrees = useMemo(() => {
    return heures.filter((h) => !filtreProjet || h.projet_id === filtreProjet);
  }, [heures, filtreProjet]);

  const employesPresents = useMemo(() => {
    const set = new Set<string>();
    heuresFiltrees.forEach((h) => set.add(h.employe || "—"));
    return Array.from(set).sort();
  }, [heuresFiltrees]);

  // grille[employe][indexJour 0-6] = { total, lignes[] }
  const grille = useMemo(() => {
    const g: Record<string, Array<{ total: number; cout: number; lignes: any[] }>> = {};
    employesPresents.forEach((emp) => {
      g[emp] = Array.from({ length: 7 }, () => ({ total: 0, cout: 0, lignes: [] }));
    });
    heuresFiltrees.forEach((h) => {
      const d = new Date(h.date);
      const lun = lundiDe(d);
      const idx = Math.floor((d.getTime() - lun.getTime()) / 86400000);
      if (idx >= 0 && idx < 7) {
        const emp = h.employe || "—";
        if (!g[emp]) return;
        g[emp][idx].total += h.heures || 0;
        g[emp][idx].cout += (h.heures || 0) * (h.taux_horaire || 0);
        g[emp][idx].lignes.push(h);
      }
    });
    return g;
  }, [heuresFiltrees, employesPresents]);

  const totauxJour = useMemo(() => {
    const t = Array.from({ length: 7 }, () => ({ heures: 0, cout: 0 }));
    employesPresents.forEach((emp) => {
      grille[emp]?.forEach((c, i) => { t[i].heures += c.total; t[i].cout += c.cout; });
    });
    return t;
  }, [grille, employesPresents]);

  const totalSemaine = totauxJour.reduce((s, t) => ({ heures: s.heures + t.heures, cout: s.cout + t.cout }), { heures: 0, cout: 0 });

  // === LISTE TRIÉE ===
  const heuresTriees = useMemo(() => {
    const arr = [...heuresFiltrees];
    const mult = triSens === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (triCol) {
        case "date": return mult * (a.date || "").localeCompare(b.date || "");
        case "employe": return mult * (a.employe || "").localeCompare(b.employe || "");
        case "projet": return mult * (a.projet_nom || "").localeCompare(b.projet_nom || "");
        case "heures": return mult * ((a.heures || 0) - (b.heures || 0));
        case "cout": return mult * (((a.heures || 0) * (a.taux_horaire || 0)) - ((b.heures || 0) * (b.taux_horaire || 0)));
        default: return 0;
      }
    });
    return arr;
  }, [heuresFiltrees, triCol, triSens]);

  const trier = (col: typeof triCol) => {
    if (triCol === col) setTriSens(triSens === "asc" ? "desc" : "asc");
    else { setTriCol(col); setTriSens("desc"); }
  };

  // === SÉLECTION MULTIPLE ===
  const toggleSel = (id: number) => {
    const ns = new Set(selection);
    if (ns.has(id)) ns.delete(id); else ns.add(id);
    setSelection(ns);
  };
  const toggleSelTout = () => {
    if (selection.size === heuresTriees.length) setSelection(new Set());
    else setSelection(new Set(heuresTriees.map((h) => h.id)));
  };

  const supprimerSelection = async () => {
    if (selection.size === 0) return;
    if (!confirm(`Supprimer ${selection.size} entrée(s) sélectionnée(s) ?\nIRRÉVERSIBLE.`)) return;
    await Promise.all(Array.from(selection).map((id) => fetch(`/api/heures?id=${id}`, { method: "DELETE" })));
    toast(`${selection.size} entrée(s) supprimée(s)`, "success");
    setSelection(new Set());
    charger();
  };

  const supprimerUn = async (id: number) => {
    if (!confirm("Supprimer cette entrée d'heures ?")) return;
    await fetch(`/api/heures?id=${id}`, { method: "DELETE" });
    toast("Entrée supprimée", "info");
    charger();
  };

  const sauverEdit = async () => {
    if (!editing) return;
    const body = {
      id: editing.id, projet_id: editing.projet_id, date: editing.date,
      heures: +editing.heures, taux_horaire: +editing.taux_horaire,
      employe: editing.employe, description: editing.description,
    };
    const r = await fetch("/api/heures", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if ((await r.json()).ok) {
      toast("Heures mises à jour", "success");
      setEditing(null);
      charger();
    }
  };

  const exporter = () => {
    const rows = heuresTriees.map((h) => ({
      date: h.date, jour: JOURS_LONG[(new Date(h.date).getDay() + 6) % 7],
      employe: h.employe || "", projet: h.projet_nom || "",
      heures: h.heures, taux_horaire: h.taux_horaire, cout: (h.heures || 0) * (h.taux_horaire || 0),
      description: h.description || "",
    }));
    exporterCSV(`horaire-semaine-${debut}`, rows);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation
        titre="⏱️ Horaire"
        soustitre={`Semaine du ${fmtCourt(semaineDebut)} au ${fmtCourt(finD)} · ${totalSemaine.heures.toFixed(1)} h`}
      />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">

        {/* === BARRE NAVIGATION SEMAINE === */}
        <section className="bg-white rounded-lg shadow p-3 flex flex-wrap items-center gap-2">
          <button onClick={reculer} aria-label="Semaine précédente" className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded font-bold">←</button>
          <button onClick={cetteSemaine} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold">Aujourd'hui</button>
          <button onClick={avancer} aria-label="Semaine suivante" className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded font-bold">→</button>
          <div className="font-bold text-lg ml-2">
            Du {fmtCourt(semaineDebut)} au {fmtCourt(finD)}
          </div>
          <input
            type="date"
            value={debut}
            onChange={(e) => { const d = new Date(e.target.value); if (!isNaN(d.getTime())) setSemaineDebut(lundiDe(d)); }}
            className="ml-auto px-2 py-1 border rounded text-sm"
            title="Aller à une semaine spécifique"
          />
          <div className="flex gap-1 bg-slate-100 rounded p-1">
            <button onClick={() => setVue("semaine")} className={`px-3 py-1 rounded text-xs font-semibold ${vue === "semaine" ? "bg-white shadow" : "text-slate-600"}`}>📅 Grille</button>
            <button onClick={() => setVue("liste")} className={`px-3 py-1 rounded text-xs font-semibold ${vue === "liste" ? "bg-white shadow" : "text-slate-600"}`}>📋 Liste</button>
          </div>
        </section>

        {/* === FILTRES === */}
        <section className="bg-white rounded-lg shadow p-3 flex flex-wrap items-center gap-2">
          <select value={filtreEmp} onChange={(e) => setFiltreEmp(e.target.value)} className="px-3 py-2 border rounded text-sm bg-white">
            <option value="">Tous les employés</option>
            {employes.map((e) => <option key={e.id} value={e.nom}>{e.nom}</option>)}
          </select>
          <select value={filtreProjet} onChange={(e) => setFiltreProjet(e.target.value ? +e.target.value : "")} className="px-3 py-2 border rounded text-sm bg-white">
            <option value="">Tous les projets</option>
            {projets.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
          </select>
          <button onClick={exporter} className="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded text-xs font-semibold">📊 Exporter CSV</button>
          {selection.size > 0 && (
            <button onClick={supprimerSelection} className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold ml-auto">
              🗑 Supprimer {selection.size} sélection(s)
            </button>
          )}
        </section>

        {/* === VUE GRILLE HEBDO === */}
        {vue === "semaine" && (
          <section className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="w-full text-sm min-w-max">
              <thead>
                <tr className="bg-slate-900 text-white text-xs">
                  <th className="p-2 text-left sticky left-0 bg-slate-900 z-10 min-w-[140px]">Employé</th>
                  {JOURS_COURT.map((j, i) => {
                    const jourD = new Date(semaineDebut); jourD.setDate(jourD.getDate() + i);
                    const estAujourd = fmtISO(jourD) === fmtISO(new Date());
                    return (
                      <th key={j} className={`p-2 text-center min-w-[110px] ${estAujourd ? "bg-emerald-700" : ""}`}>
                        <div className="font-bold">{j}</div>
                        <div className="text-[10px] opacity-80">{jourD.getDate()}/{jourD.getMonth() + 1}</div>
                      </th>
                    );
                  })}
                  <th className="p-2 text-right min-w-[100px] bg-slate-800">Total</th>
                </tr>
              </thead>
              <tbody>
                {employesPresents.length === 0 ? (
                  <tr><td colSpan={9} className="p-8 text-center text-slate-500 text-sm">Aucune heure cette semaine. Saisis des heures via le bouton ⏱️ en bas à droite.</td></tr>
                ) : (
                  employesPresents.map((emp) => {
                    const total = grille[emp].reduce((s, c) => s + c.total, 0);
                    const cout = grille[emp].reduce((s, c) => s + c.cout, 0);
                    return (
                      <tr key={emp} className="border-t hover:bg-slate-50">
                        <td className="p-2 font-bold sticky left-0 bg-white z-10">{emp}</td>
                        {grille[emp].map((c, i) => {
                          const jourD = new Date(semaineDebut); jourD.setDate(jourD.getDate() + i);
                          return (
                            <td
                              key={i}
                              onClick={() => c.lignes.length > 0 && setDetailJour({ employe: emp, date: fmtISO(jourD) })}
                              className={`p-2 text-center align-top ${c.total > 0 ? "cursor-pointer hover:bg-emerald-50" : ""}`}
                            >
                              {c.total > 0 ? (
                                <>
                                  <div className="font-bold text-emerald-700">{c.total.toFixed(1)} h</div>
                                  <div className="text-[10px] text-slate-500">{formatCAD(c.cout)}</div>
                                  {c.lignes.length > 1 && <div className="text-[9px] text-slate-400">{c.lignes.length} entrées</div>}
                                </>
                              ) : (
                                <div className="text-slate-300">—</div>
                              )}
                            </td>
                          );
                        })}
                        <td className="p-2 text-right bg-slate-50">
                          <div className="font-bold">{total.toFixed(1)} h</div>
                          <div className="text-[10px] text-emerald-700">{formatCAD(cout)}</div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                  <td className="p-2 sticky left-0 bg-slate-100 z-10">TOTAL</td>
                  {totauxJour.map((t, i) => (
                    <td key={i} className="p-2 text-center">
                      <div className="text-slate-900">{t.heures.toFixed(1)} h</div>
                      <div className="text-[10px] text-slate-600">{formatCAD(t.cout)}</div>
                    </td>
                  ))}
                  <td className="p-2 text-right bg-emerald-100">
                    <div className="text-emerald-900">{totalSemaine.heures.toFixed(1)} h</div>
                    <div className="text-xs text-emerald-700">{formatCAD(totalSemaine.cout)}</div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        )}

        {/* === VUE LISTE TRIABLE === */}
        {vue === "liste" && (
          <section className="bg-white rounded-lg shadow overflow-x-auto">
            {heuresTriees.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-sm">Aucune heure cette semaine.</div>
            ) : (
              <table className="w-full text-sm min-w-max">
                <thead className="bg-slate-100 text-left text-xs uppercase">
                  <tr>
                    <th className="p-2 w-10">
                      <input type="checkbox" checked={selection.size === heuresTriees.length && heuresTriees.length > 0} onChange={toggleSelTout} aria-label="Tout sélectionner" />
                    </th>
                    <ThTri label="Date" col="date" actuel={triCol} sens={triSens} onClick={trier} />
                    <ThTri label="Employé" col="employe" actuel={triCol} sens={triSens} onClick={trier} />
                    <ThTri label="Projet" col="projet" actuel={triCol} sens={triSens} onClick={trier} />
                    <ThTri label="Heures" col="heures" actuel={triCol} sens={triSens} onClick={trier} align="right" />
                    <th className="p-2 text-right">$/h</th>
                    <ThTri label="Coût" col="cout" actuel={triCol} sens={triSens} onClick={trier} align="right" />
                    <th className="p-2">Description</th>
                    <th className="p-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {heuresTriees.map((h) => {
                    const selected = selection.has(h.id);
                    const jour = JOURS_COURT[(new Date(h.date).getDay() + 6) % 7];
                    return (
                      <tr key={h.id} className={`border-t hover:bg-slate-50 vk-lazy-render ${selected ? "bg-blue-50" : ""}`}>
                        <td className="p-2">
                          <input type="checkbox" checked={selected} onChange={() => toggleSel(h.id)} aria-label="Sélectionner" />
                        </td>
                        <td className="p-2 whitespace-nowrap"><span className="text-slate-400 text-[10px] mr-1">{jour}</span>{h.date}</td>
                        <td className="p-2 font-medium">{h.employe || "—"}</td>
                        <td className="p-2 truncate max-w-xs">
                          {h.projet_nom ? <a href={`/projets/${h.projet_id}`} className="text-blue-600 hover:underline">{h.projet_nom}</a> : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="p-2 text-right font-bold">{h.heures.toFixed(1)} h</td>
                        <td className="p-2 text-right text-slate-600">{(h.taux_horaire || 0).toFixed(2)} $</td>
                        <td className="p-2 text-right font-bold text-emerald-700">{formatCAD(h.heures * (h.taux_horaire || 0))}</td>
                        <td className="p-2 text-xs text-slate-600 truncate max-w-xs">{h.description || ""}</td>
                        <td className="p-2 text-right whitespace-nowrap">
                          <button onClick={() => setEditing({ ...h })} className="text-xs text-emerald-700 hover:underline mr-2">✏️</button>
                          <button onClick={() => supprimerUn(h.id)} className="text-xs text-red-600 hover:underline">🗑</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-100 font-bold border-t-2">
                    <td colSpan={4} className="p-2">{heuresTriees.length} entrée(s)</td>
                    <td className="p-2 text-right">{totalSemaine.heures.toFixed(1)} h</td>
                    <td></td>
                    <td className="p-2 text-right text-emerald-700">{formatCAD(totalSemaine.cout)}</td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
        )}
      </main>

      {/* === MODAL DÉTAIL JOUR (clic sur cellule) === */}
      {detailJour && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setDetailJour(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="text-lg font-bold">{detailJour.employe}</h3>
                <p className="text-sm text-slate-600">{new Date(detailJour.date).toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" })}</p>
              </div>
              <button onClick={() => setDetailJour(null)} className="text-2xl text-slate-400 hover:text-slate-700">×</button>
            </div>
            <div className="space-y-2">
              {heuresFiltrees.filter((h) => h.date === detailJour.date && (h.employe || "—") === detailJour.employe).map((h) => (
                <div key={h.id} className="bg-slate-50 rounded p-3 flex justify-between items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{h.projet_nom || "Sans projet"}</div>
                    <div className="text-xs text-slate-600">{h.heures.toFixed(1)} h · {formatCAD((h.heures || 0) * (h.taux_horaire || 0))}</div>
                    {h.description && <div className="text-xs text-slate-500 mt-1">{h.description}</div>}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => { setEditing({ ...h }); setDetailJour(null); }} className="text-xs text-emerald-700 hover:underline">✏️ Modifier</button>
                    <button onClick={async () => { await supprimerUn(h.id); setDetailJour(null); }} className="text-xs text-red-600 hover:underline">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* === MODAL ÉDITION === */}
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

function ThTri({ label, col, actuel, sens, onClick, align }: { label: string; col: any; actuel: string; sens: "asc" | "desc"; onClick: (c: any) => void; align?: "right" }) {
  const actif = col === actuel;
  return (
    <th className={`p-2 cursor-pointer select-none hover:bg-slate-200 ${align === "right" ? "text-right" : ""}`} onClick={() => onClick(col)}>
      {label} {actif && <span className="text-emerald-600">{sens === "asc" ? "▲" : "▼"}</span>}
    </th>
  );
}

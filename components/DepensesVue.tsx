"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import FAB from "@/components/FAB";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import { exporterCSV } from "@/lib/csv";
import Pagination, { usePagination } from "@/components/Pagination";
import { nombreSaisi, depensesAvantTaxes } from "@/lib/calculs";
import { ecrire, envoyer, lireListe } from "@/lib/envoi";
import ErreurChargement from "@/components/ErreurChargement";
import Modale from "@/components/Modale";

type TriCol = "date" | "fournisseur" | "categorie" | "projet" | "montant";
type TriSens = "asc" | "desc";

function fmtLocal(d: Date): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const j = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${j}`;
}

export default function DepensesVue() {
  const [depenses, setDepenses] = useState<any[]>([]);
  const [projets, setProjets] = useState<any[]>([]);
  const [categories, setCategories] = useState<{ id: number; nom: string }[]>([]);
  const [gestionCatOuverte, setGestionCatOuverte] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [filtreCat, setFiltreCat] = useState("");
  const [filtreProj, setFiltreProj] = useState<string>("");
  const today = fmtLocal(new Date());
  const [depuis, setDepuis] = useState(fmtLocal(new Date(Date.now() - 90 * 86400000)));
  const [jusqu, setJusqu] = useState(today);
  const [triCol, setTriCol] = useState<TriCol>("date");
  const [triSens, setTriSens] = useState<TriSens>("desc");
  const [editing, setEditing] = useState<any>(null);
  const [recuOuvert, setRecuOuvert] = useState<{ id: number; type?: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const sp = useSearchParams();
  const { toast } = useToast();

  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const charger = async () => {
    setChargement(true);
    try {
      // Lectures avec filet : un 500 sur /api/depenses rejetait la promesse et laissait
      // la page vide, comme s'il n'y avait « aucune dépense ».
      const [d, p, c] = await Promise.all([
        lireListe("/api/depenses?data=0"),
        lireListe("/api/projets?lite=1"),
        lireListe("/api/categories-depense"),
      ]);
      if (!d.ok) { setErreur(d.erreur); return; }
      setErreur(null);
      setDepenses(d.data);
      if (p.ok) setProjets(p.data);
      if (c.ok) setCategories(c.data);
      setSelection(new Set());
    } finally { setChargement(false); }
  };

  useEffect(() => { charger(); }, []);
  useEffect(() => { setZoom(1); }, [recuOuvert]); // remet le zoom à 100 % à chaque ouverture

  // Arrivée depuis la recherche globale (?depense=ID) : cibler cette dépense —
  // élargir la période pour la rendre visible, filtrer sur son montant, surligner.
  useEffect(() => {
    const fid = sp.get("depense");
    if (!fid || depenses.length === 0) return;
    const d = depenses.find((x) => String(x.id) === fid);
    if (!d) return;
    setDepuis("2020-01-01");
    setRecherche(String(d.montant ?? ""));
    setHighlightId(d.id);
    const t = setTimeout(() => { document.getElementById(`dep-${d.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }); }, 350);
    return () => clearTimeout(t);
  }, [depenses, sp]);

  const projNom = (id: number | null) => projets.find((p) => p.id === id)?.nom || "—";

  const filtrees = useMemo(() => {
    let arr = depenses.filter((d) => {
      if (d.date < depuis || d.date > jusqu) return false;
      if (filtreCat && d.categorie !== filtreCat) return false;
      if (filtreProj === "aucun" && d.projet_id) return false;
      if (filtreProj && filtreProj !== "aucun" && d.projet_id !== +filtreProj) return false;
      if (recherche) {
        const q = recherche.toLowerCase().trim();
        const fields = [
          d.fournisseur, d.description, d.categorie, projNom(d.projet_id),
          d.date,                                  // ex: "2026-05" ou "29"
          String(d.montant ?? ""),                 // ex: "12.5"
          formatCAD(d.montant || 0),               // ex: "12,50 $"
        ].filter(Boolean);
        if (!fields.some((f: any) => String(f).toLowerCase().includes(q))) return false;
      }
      return true;
    });
    const mult = triSens === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (triCol) {
        case "date": return mult * (a.date || "").localeCompare(b.date || "");
        case "fournisseur": return mult * (a.fournisseur || "").localeCompare(b.fournisseur || "");
        case "categorie": return mult * (a.categorie || "").localeCompare(b.categorie || "");
        case "projet": return mult * projNom(a.projet_id).localeCompare(projNom(b.projet_id));
        case "montant": return mult * ((a.montant || 0) - (b.montant || 0));
      }
    });
    return arr;
  }, [depenses, recherche, filtreCat, filtreProj, depuis, jusqu, triCol, triSens, projets]);

  const trier = (col: TriCol) => {
    if (triCol === col) setTriSens(triSens === "asc" ? "desc" : "asc");
    else { setTriCol(col); setTriSens(col === "montant" ? "desc" : "asc"); }
  };

  // Pagination de l'AFFICHAGE — les KPIs/totaux/CSV ci-dessous restent sur `filtrees` (jeu complet).
  const pg = usePagination(filtrees.length, 50);
  const visibles = useMemo(() => filtrees.slice(pg.debut, pg.fin), [filtrees, pg.debut, pg.fin]);
  // Revenir à la 1re page dès qu'un filtre change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { pg.reset(); }, [recherche, filtreCat, filtreProj, depuis, jusqu]);

  const total = filtrees.reduce((s, d) => s + (d.montant || 0), 0);
  // Le seul chiffre affiché était le total TAXES INCLUSES, sans le dire. C'est pourtant
  // l'avant-taxes qui entre dans la marge et dans /finances — deux nombres différents,
  // et l'écran n'en montrait qu'un, sans étiquette. On affiche les deux.
  const totalDetaxe = filtrees.filter((d) => (d as any).detaxe).reduce((s, d) => s + (d.montant || 0), 0);
  const totalAvantTaxes = depensesAvantTaxes(total, totalDetaxe);
  const totalAvecRecu = filtrees.filter((d) => (d as any).a_recu || d.recu_data).reduce((s, d) => s + d.montant, 0);

  const parCat = filtrees.reduce((acc: any, d) => {
    const k = d.categorie || "autre";
    if (!acc[k]) acc[k] = 0;
    acc[k] += d.montant;
    return acc;
  }, {});

  const toggleSel = (id: number) => {
    const ns = new Set(selection);
    ns.has(id) ? ns.delete(id) : ns.add(id);
    setSelection(ns);
  };
  const toggleSelTout = () => {
    if (selection.size === filtrees.length) setSelection(new Set());
    else setSelection(new Set(filtrees.map((d) => d.id)));
  };
  const supprimerSel = async () => {
    if (selection.size === 0) return;
    if (!confirm(`Supprimer ${selection.size} dépense(s) sélectionnée(s) ? IRRÉVERSIBLE.`)) return;
    // Compte les vrais succès : une suppression refusée ne doit pas être annoncée comme
    // faite (la dépense réapparaissait au rechargement suivant).
    const res = await Promise.all(Array.from(selection).map((id) => envoyer(`/api/depenses?id=${id}`, { methode: "DELETE" })));
    const ok = res.filter((r) => r.ok).length;
    const echecs = res.length - ok;
    if (ok > 0) toast(`${ok} dépense(s) supprimée(s)`, "success");
    if (echecs > 0) toast(`${echecs} suppression(s) refusée(s) : ${res.find((r) => !r.ok)?.erreur || "erreur"}`, "error");
    setSelection(new Set());
    charger();
  };

  const supprimer = async (id: number) => {
    if (!confirm("Supprimer cette dépense ?")) return;
    if (!(await ecrire(`/api/depenses?id=${id}`, "DELETE", undefined, "Suppression"))) return;
    toast("Dépense supprimée", "info");
    charger();
  };

  const sauverEdit = async () => {
    if (!editing) return;
    if (!Number.isFinite(nombreSaisi(editing.montant))) { toast("Montant illisible (ex. : 1 149,75)", "warning"); return; }
    const body = {
      id: editing.id,
      date: editing.date,
      fournisseur: editing.fournisseur,
      categorie: editing.categorie,
      description: editing.description,
      projet_id: editing.projet_id ? +editing.projet_id : null,
      // nombreSaisi et non `+` : « 1 149,75 » (espace + virgule, la saisie québécoise)
      // donnait NaN, et un champ vidé donnait 0 — ce 0 partait au serveur et ramenait
      // la dépense à zéro. Même parseur que partout ailleurs dans l'app.
      montant: nombreSaisi(editing.montant),
      detaxe: !!editing.detaxe,
      version: editing.version, // verrouillage optimiste (B7)
    };
    // envoyer() : `r.ok` vérifié, message du serveur affiché, et le 409 (verrou
    // optimiste) reconnu par son statut.
    const r = await envoyer("/api/depenses", { methode: "PATCH", corps: body });
    if (!r.ok && r.statut === 409) {
      toast(r.data?.message || "Conflit : cette dépense a été modifiée ailleurs. Liste rechargée.", "warning");
      setEditing(null);
      charger();
      return;
    }
    if (!r.ok) { toast(`Modification refusée : ${r.erreur}`, "error"); return; }
    toast("Dépense modifiée", "success");
    setEditing(null);
    charger();
  };

  const exportCSV = () => {
    const rows = filtrees.map((d) => ({
      date: d.date,
      fournisseur: d.fournisseur || "",
      categorie: d.categorie || "",
      description: d.description || "",
      projet: projNom(d.projet_id),
      // L'export part chez le comptable : sans la colonne « détaxé » et l'avant-taxes,
      // il ne peut pas refaire le calcul de TPS/TVQ à partir du fichier.
      montant_taxes_incluses: d.montant.toFixed(2),
      detaxe: (d as any).detaxe ? "Oui" : "Non",
      montant_avant_taxes: depensesAvantTaxes(d.montant || 0, (d as any).detaxe ? (d.montant || 0) : 0).toFixed(2),
      recu: (d as any).a_recu || d.recu_data ? "Oui" : "Non",
    }));
    exporterCSV(`depenses-${depuis}_${jusqu}`, rows);
  };

  return (
    <>
      <div className="space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Total filtré (taxes incl.)" value={formatCAD(total)} couleur="text-orange-700" sub={`avant taxes : ${formatCAD(totalAvantTaxes)}${totalDetaxe > 0 ? ` · dont ${formatCAD(totalDetaxe)} détaxé` : ""}`} />
          <KPI label="Avec reçu" value={formatCAD(totalAvecRecu)} couleur="text-emerald-700" sub={`${filtrees.filter((d) => (d as any).a_recu || d.recu_data).length} sur ${filtrees.length}`} />
          <KPI label="Sans reçu" value={formatCAD(total - totalAvecRecu)} couleur="text-amber-700" sub="à régulariser" />
          <KPI label="Nb entrées" value={`${filtrees.length}`} />
        </div>

        {/* Recherche et filtres */}
        <section className="bg-white rounded-lg shadow p-3 space-y-2">
          {/* text-base (16 px) sur mobile : en dessous de 16 px, iOS zoome tout seul
              quand on tape dans le champ, puis il faut dézoomer à la main. */}
          <input type="search" placeholder="🔍 Rechercher (fournisseur, description, projet, date, montant…)" value={recherche} onChange={(e) => setRecherche(e.target.value)} className="w-full px-3 py-2 border rounded text-base sm:text-sm" />
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
                <option value="">Toutes</option>
                {categories.map((c) => <option key={c.id} value={c.nom}>{c.nom}</option>)}
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
          <div className="flex gap-1 flex-wrap items-center">
            <button onClick={() => { setDepuis(fmtLocal(new Date(Date.now() - 7 * 86400000))); setJusqu(today); }} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold">7j</button>
            <button onClick={() => { setDepuis(fmtLocal(new Date(Date.now() - 30 * 86400000))); setJusqu(today); }} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold">30j</button>
            <button onClick={() => { setDepuis(`${new Date().getFullYear()}-01-01`); setJusqu(today); }} className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold">Année</button>
            <button onClick={() => { setRecherche(""); setFiltreCat(""); setFiltreProj(""); }} className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-xs font-semibold">✕ Reset filtres</button>
            <button onClick={exportCSV} className="ml-auto px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold">📥 Export CSV (QuickBooks)</button>
          </div>
        </section>

        {/* Sélection multiple — barre */}
        {selection.size > 0 && (
          <div className="bg-blue-50 border border-blue-300 rounded p-2 flex items-center justify-between sticky top-16 z-10">
            <span className="text-sm font-semibold text-blue-900">{selection.size} dépense(s) sélectionnée(s)</span>
            <div className="flex gap-2">
              <button onClick={() => setSelection(new Set())} className="text-xs text-slate-600 hover:underline">Désélectionner</button>
              <button onClick={supprimerSel} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold">🗑 Supprimer</button>
            </div>
          </div>
        )}

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
        <section className="bg-white rounded-lg shadow">
          <div className="overflow-x-auto">
          {erreur ? (
            <ErreurChargement erreur={erreur} onReessayer={charger} />
          ) : chargement && depenses.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">Chargement...</div>
          ) : filtrees.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">Aucune dépense pour ces critères.</div>
          ) : (
            <table className="w-full text-sm min-w-max">
              <thead className="bg-slate-100 text-left text-xs uppercase">
                <tr>
                  <th className="p-2 w-10">
                    <input type="checkbox" checked={selection.size === filtrees.length && filtrees.length > 0} onChange={toggleSelTout} aria-label="Tout sélectionner" />
                  </th>
                  <ThTri label="Date" col="date" actuel={triCol} sens={triSens} onClick={trier} />
                  <ThTri label="Fournisseur" col="fournisseur" actuel={triCol} sens={triSens} onClick={trier} />
                  <ThTri label="Catégorie" col="categorie" actuel={triCol} sens={triSens} onClick={trier} />
                  <th className="p-2">Description</th>
                  <ThTri label="Projet" col="projet" actuel={triCol} sens={triSens} onClick={trier} />
                  <ThTri label="Montant" col="montant" actuel={triCol} sens={triSens} onClick={trier} align="right" />
                  <th className="p-2 text-center">Reçu</th>
                  <th className="p-2 text-left">Saisi par</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibles.map((d) => {
                  const sel = selection.has(d.id);
                  return (
                    <tr key={d.id} id={`dep-${d.id}`} className={`border-t hover:bg-slate-50 vk-lazy-render ${sel ? "bg-blue-50" : ""} ${highlightId === d.id ? "ring-2 ring-emerald-500 bg-emerald-50" : ""}`}>
                      <td className="p-2">
                        <input type="checkbox" checked={sel} onChange={() => toggleSel(d.id)} />
                      </td>
                      <td className="p-2 whitespace-nowrap">{d.date}</td>
                      <td className="p-2 font-semibold">{d.fournisseur || "—"}</td>
                      <td className="p-2"><span className="text-xs bg-amber-100 text-amber-900 px-2 py-0.5 rounded">{d.categorie || "—"}</span></td>
                      <td className="p-2 text-xs text-slate-600 max-w-xs truncate">{d.description || ""}</td>
                      <td className="p-2 text-xs">
                        {d.projet_id ? <a href={`/projets/${d.projet_id}`} className="text-blue-600 hover:underline">{projNom(d.projet_id)}</a> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2 text-right font-bold text-orange-700 whitespace-nowrap">
                        {formatCAD(d.montant)}
                        {/* Marque visible : sans elle, impossible de repérer à l'œil une
                            facture mal cochée, alors que c'est ce drapeau qui décide si
                            on retire 14,975 % pour la rentabilité. */}
                        {(d as any).detaxe ? (
                          <span className="ml-1 text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded align-middle" title="Facture détaxée : aucune TPS/TVQ à retirer">détaxé</span>
                        ) : null}
                      </td>
                      <td className="p-2 text-center">
                        {(d as any).a_recu || d.recu_data ? (
                          <button onClick={() => setRecuOuvert({ id: d.id, type: d.recu_type })} className="text-emerald-700 hover:underline text-xs font-semibold">📎 Voir</button>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        {d.ajoute_par ? <span className={`px-2 py-0.5 rounded font-semibold ${d.ajoute_par === "Francis" ? "bg-emerald-100 text-emerald-900" : "bg-blue-100 text-blue-900"}`}>👤 {d.ajoute_par}</span> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <button onClick={() => setEditing({ ...d })} aria-label="Modifier cette dépense" className="inline-flex items-center justify-center min-w-11 min-h-11 text-xs text-emerald-700 hover:bg-emerald-50 rounded mr-1">✏️</button>
                        <button onClick={() => supprimer(d.id)} aria-label="Supprimer cette dépense" className="inline-flex items-center justify-center min-w-11 min-h-11 text-xs text-red-600 hover:bg-red-50 rounded">🗑</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-slate-100 font-bold">
                <tr>
                  <td className="p-2" colSpan={6}>TOTAL {filtrees.length} entrée(s)</td>
                  <td className="p-2 text-right text-orange-700">{formatCAD(total)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          )}
          </div>
          {filtrees.length > 0 && (
            <Pagination total={filtrees.length} page={pg.page} pageSize={pg.pageSize} onPage={pg.setPage} onPageSize={pg.setPageSize} label="dépenses" />
          )}
        </section>

        {/* Gestion des catégories — bas de page (repliable) */}
        <section className="bg-white rounded-lg shadow mt-2">
          <button onClick={() => setGestionCatOuverte(!gestionCatOuverte)} className="w-full p-3 flex justify-between items-center text-left">
            <span className="font-bold text-sm">🏷️ Catégories de dépenses <span className="text-xs font-normal text-slate-500 ml-1">({categories.length})</span></span>
            <span className="text-slate-400">{gestionCatOuverte ? "▾" : "▸"}</span>
          </button>
          {gestionCatOuverte && (
            <CategoriesGestion categories={categories} onChange={charger} />
          )}
        </section>
      </div>

      {/* MODAL ÉDITION */}
      {editing && (
        <Modale onClose={() => setEditing(null)} titre="Modifier la dépense" className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Modifier la dépense</h3>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
              <input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Fournisseur</label>
              <input type="text" value={editing.fournisseur || ""} onChange={(e) => setEditing({ ...editing, fournisseur: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Catégorie</label>
                <select value={editing.categorie || ""} onChange={(e) => setEditing({ ...editing, categorie: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  <option value="">—</option>
                  {categories.map((c) => <option key={c.id} value={c.nom}>{c.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Montant *</label>
                {/* type="text" + inputMode : un champ number refuse « 1 149,75 » (virgule du clavier québécois). */}
                <input type="text" inputMode="decimal" value={editing.montant} onChange={(e) => setEditing({ ...editing, montant: e.target.value })} placeholder="Ex. : 1 149,75" className="w-full px-3 py-2 border rounded text-sm text-right font-bold" />
              </div>
            </div>
            {/* Le drapeau « détaxé » n'était visible NULLE PART sur cet écran : ni affiché,
                ni modifiable. Une facture mal cochée à la saisie ne pouvait se corriger
                qu'en la supprimant et en la ressaisissant. Or c'est lui qui décide si on
                retire 14,975 % du montant pour la rentabilité. */}
            <button
              type="button"
              onClick={() => setEditing({ ...editing, detaxe: !editing.detaxe })}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border-2 text-sm font-semibold transition ${editing.detaxe ? "bg-emerald-50 border-emerald-500 text-emerald-900" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"}`}
            >
              <span>{editing.detaxe ? "Détaxée (aucune TPS/TVQ sur la facture)" : "Taxable (TPS + TVQ incluses)"}</span>
              <span className={`w-10 h-6 rounded-full flex items-center transition ${editing.detaxe ? "bg-emerald-500 justify-end" : "bg-slate-300 justify-start"} px-0.5`}>
                <span className="w-5 h-5 bg-white rounded-full shadow" />
              </span>
            </button>
            <p className="text-[11px] text-slate-500">
              Avant taxes : <strong>{formatCAD(depensesAvantTaxes(nombreSaisi(editing.montant) || 0, editing.detaxe ? (nombreSaisi(editing.montant) || 0) : 0))}</strong> — c'est ce montant qui entre dans la marge.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Projet</label>
              <select value={editing.projet_id || ""} onChange={(e) => setEditing({ ...editing, projet_id: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                <option value="">— Aucun —</option>
                {projets.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
              <input type="text" value={editing.description || ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={sauverEdit} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">Sauver</button>
            </div>
          </div>
        </Modale>
      )}

      {/* VISIONNEUSE DE REÇU (avec bouton Retour) */}
      {recuOuvert && (() => {
        const estPdf = (recuOuvert.type || "").includes("pdf");
        return (
          <Modale onClose={() => setRecuOuvert(null)} titre="Reçu de la dépense" className="fixed inset-0 bg-black/85 z-50 flex flex-col">
            <div className="flex items-center justify-between gap-2 p-3 bg-slate-900 text-white flex-shrink-0" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setRecuOuvert(null)} className="px-4 py-2 bg-white/15 hover:bg-white/25 rounded-lg font-bold text-sm">← Retour</button>
              {!estPdf && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(2)))} className="w-9 h-9 bg-white/15 hover:bg-white/25 rounded-lg font-bold text-lg" aria-label="Dézoomer">−</button>
                  <span className="text-xs w-12 text-center tabular-nums">{Math.round(zoom * 100)} %</span>
                  <button onClick={() => setZoom((z) => Math.min(6, +(z + 0.5).toFixed(2)))} className="w-9 h-9 bg-white/15 hover:bg-white/25 rounded-lg font-bold text-lg" aria-label="Zoomer">＋</button>
                  {zoom !== 1 && <button onClick={() => setZoom(1)} className="px-2 h-9 bg-white/15 hover:bg-white/25 rounded-lg text-xs" aria-label="Réinitialiser">⟳</button>}
                </div>
              )}
              <a href={`/api/depenses/${recuOuvert.id}/recu`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs underline opacity-80 hover:opacity-100">Ouvrir ↗</a>
            </div>
            <div className="flex-1 overflow-auto flex items-center justify-center p-3" onClick={(e) => e.stopPropagation()}>
              {estPdf ? (
                <iframe src={`/api/depenses/${recuOuvert.id}/recu`} className="w-full h-full bg-white rounded" title="Reçu PDF" />
              ) : (
                <img
                  src={`/api/depenses/${recuOuvert.id}/recu`}
                  alt="Reçu"
                  onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2.5))}
                  className="max-w-full max-h-full object-contain rounded shadow-lg"
                  style={{ transform: `scale(${zoom})`, transformOrigin: "center", transition: "transform 0.15s", cursor: zoom > 1 ? "grab" : "zoom-in" }}
                />
              )}
            </div>
            {!estPdf && <p className="text-center text-white/50 text-[10px] pb-2">Double-clic pour zoomer · glisse pour te déplacer</p>}
          </Modale>
        );
      })()}

      <FAB onSuccess={charger} />
    </>
  );
}

function CategoriesGestion({ categories, onChange }: { categories: { id: number; nom: string }[]; onChange: () => void }) {
  const [nouveau, setNouveau] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editNom, setEditNom] = useState("");
  const { toast } = useToast();

  const ajouter = async () => {
    const nom = nouveau.trim();
    if (!nom) return;
    const res = await envoyer("/api/categories-depense", { corps: { nom } });
    if (res.ok) { toast(`Catégorie « ${nom} » ajoutée`, "success"); setNouveau(""); onChange(); }
    else toast(res.erreur || "Erreur", "warning");
  };
  const sauverEdition = async (id: number) => {
    const nom = editNom.trim();
    if (!nom) return;
    if (!(await ecrire("/api/categories-depense", "PATCH", { id, nom }, "Enregistrement"))) return;
    toast("Catégorie renommée (les dépenses existantes sont mises à jour)", "success");
    setEditId(null); onChange();
  };
  const supprimer = async (c: { id: number; nom: string }) => {
    if (!confirm(`Désactiver la catégorie « ${c.nom} » ?\n(L'historique des dépenses reste intact, mais elle n'apparaît plus dans les listes.)`)) return;
    if (!(await ecrire(`/api/categories-depense?id=${c.id}`, "DELETE", undefined, "Suppression"))) return;
    toast("Catégorie désactivée", "info"); onChange();
  };

  return (
    <div className="px-3 pb-3 space-y-2">
      <div className="flex gap-2">
        <input type="text" value={nouveau} onChange={(e) => setNouveau(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ajouter()} placeholder="Nouvelle catégorie (ex: assurance, sous-location)" className="flex-1 px-3 py-2 border rounded text-sm" />
        <button onClick={ajouter} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">＋ Ajouter</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center gap-2 bg-slate-50 rounded p-2">
            {editId === c.id ? (
              <>
                <input type="text" value={editNom} onChange={(e) => setEditNom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sauverEdition(c.id)} className="flex-1 px-2 py-1 border rounded text-sm" autoFocus />
                <button onClick={() => sauverEdition(c.id)} className="text-xs bg-emerald-600 text-white px-2 py-1 rounded font-bold">✓</button>
                <button onClick={() => setEditId(null)} className="text-xs bg-slate-300 px-2 py-1 rounded">✕</button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm text-slate-800">{c.nom}</span>
                <button onClick={() => { setEditId(c.id); setEditNom(c.nom); }} className="text-xs text-emerald-700 hover:underline">✏️ Renommer</button>
                <button onClick={() => supprimer(c)} className="text-xs text-red-600 hover:underline">🗑</button>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-500 italic">Renommer une catégorie met à jour toutes les dépenses existantes. Supprimer = désactiver (l'historique reste intact).</p>
    </div>
  );
}

function ThTri({ label, col, actuel, sens, onClick, align }: { label: string; col: TriCol; actuel: TriCol; sens: TriSens; onClick: (c: TriCol) => void; align?: "right" }) {
  const actif = col === actuel;
  return (
    <th className={`p-2 cursor-pointer select-none hover:bg-slate-200 ${align === "right" ? "text-right" : ""}`} onClick={() => onClick(col)}>
      {label} {actif && <span className="text-emerald-600">{sens === "asc" ? "▲" : "▼"}</span>}
    </th>
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

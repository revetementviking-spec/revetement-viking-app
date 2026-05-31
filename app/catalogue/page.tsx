"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import { formatCAD } from "@/lib/calculateur";

const TYPES = [
  { v: "demolition", l: "Démolition" },
  { v: "membrane", l: "Membrane & préparation" },
  { v: "maibec", l: "Maibec" },
  { v: "canexel", l: "Canexel" },
  { v: "hardie", l: "Hardie / Fibrociment" },
  { v: "vinyle", l: "Vinyle" },
  { v: "aluminium", l: "Aluminium" },
  { v: "acier", l: "Acier Galvalume" },
  { v: "bois", l: "Bois naturel" },
  { v: "soffite_fascia", l: "Soffite & Fascia" },
  { v: "quincaillerie", l: "Quincaillerie" },
  { v: "main_oeuvre", l: "Main-d'œuvre" },
  { v: "forfait", l: "Frais forfaitaire" },
  { v: "fenetres_portes", l: "Fenêtres & portes" },
  { v: "autre", l: "Autre" },
];

const UNITES = ["pi²", "pi lin", "unité", "heure", "boîte", "tube", "rouleau", "panneau", "section", "forfait"];

interface Mat {
  id?: number;
  nom: string;
  type: string;
  fournisseur: string;
  unite: string;
  format_paquet: string;          // ex: 44 pour Canexel
  format_paquet_label: string;    // ex: "paquet de 44 pi²"
  prix_coutant: string;
  majoration_pct: string;
  prix_vente: string;
  notes: string;
}

const VIDE: Mat = { nom: "", type: "canexel", fournisseur: "", unite: "pi²", format_paquet: "", format_paquet_label: "", prix_coutant: "", majoration_pct: "20", prix_vente: "", notes: "" };

export default function CataloguePage() {
  const [items, setItems] = useState<any[]>([]);
  const [recherche, setRecherche] = useState("");
  const [filtreType, setFiltreType] = useState("");
  const [edit, setEdit] = useState<Mat | null>(null);
  const { toast } = useToast();

  const charger = () => fetch("/api/catalogue", { cache: "no-store" }).then((r) => r.json()).then((d) => setItems(Array.isArray(d) ? d : []));
  useEffect(() => { charger(); }, []);

  // Calcul auto du prix de vente quand coutant/majoration changent
  useEffect(() => {
    if (!edit) return;
    const c = parseFloat(edit.prix_coutant);
    const m = parseFloat(edit.majoration_pct);
    if (!isNaN(c) && c > 0 && !isNaN(m)) {
      const v = (c * (1 + m / 100)).toFixed(2);
      if (v !== edit.prix_vente) setEdit({ ...edit, prix_vente: v });
    }
  }, [edit?.prix_coutant, edit?.majoration_pct]);

  const sauvegarder = async () => {
    if (!edit?.nom?.trim() || !edit?.unite) { toast("Nom et unité requis", "warning"); return; }
    const body = {
      ...edit,
      format_paquet: edit.format_paquet ? +edit.format_paquet : null,
      prix_coutant: edit.prix_coutant ? +edit.prix_coutant : null,
      majoration_pct: edit.majoration_pct ? +edit.majoration_pct : 20,
      prix_vente: edit.prix_vente ? +edit.prix_vente : null,
    };
    const r = await fetch("/api/catalogue", {
      method: edit.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) { toast(edit.id ? "Modifié" : "Matériau ajouté", "success"); setEdit(null); charger(); }
    else toast("Erreur", "error");
  };

  const supprimer = async (id: number) => {
    if (!confirm("Désactiver ce matériau ? (les soumissions passées ne sont pas affectées)")) return;
    await fetch(`/api/catalogue?id=${id}`, { method: "DELETE" });
    charger();
  };

  const filtres = items.filter((m) => {
    if (filtreType && m.type !== filtreType) return false;
    if (recherche.trim()) {
      const q = recherche.toLowerCase();
      return `${m.nom} ${m.type} ${m.fournisseur} ${m.notes || ""}`.toLowerCase().includes(q);
    }
    return true;
  });

  // Statistiques par type
  const stats = items.reduce((s: Record<string, number>, m) => { s[m.type || "autre"] = (s[m.type || "autre"] || 0) + 1; return s; }, {});

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📚 Catalogue matériaux" soustitre={`${items.length} matériau(x) actifs`} actions={
        <button onClick={() => setEdit({ ...VIDE })} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">➕ Nouveau matériau</button>
      } />

      <main className="max-w-7xl mx-auto p-3 md:p-4 space-y-3">

        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900">
          💡 <strong>Format paquet</strong> : si un matériau se vend par paquet (ex: Canexel 44 pi²/paquet), entre <strong>44</strong> dans « format paquet ». Quand tu mets ce matériau dans une soumission, les quantités seront automatiquement arrondies aux paquets entiers.
        </div>

        {/* Filtres */}
        <div className="flex flex-wrap gap-2 items-center">
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="🔎 Rechercher (nom/fournisseur/notes)..." className="flex-1 min-w-[200px] px-3 py-2 border rounded text-sm" />
          <select value={filtreType} onChange={(e) => setFiltreType(e.target.value)} className="px-3 py-2 border rounded text-sm bg-white">
            <option value="">Tous types ({items.length})</option>
            {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l} {stats[t.v] ? `(${stats[t.v]})` : ""}</option>)}
          </select>
        </div>

        {/* Tableau */}
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr className="text-left">
                <th className="p-2">Nom</th>
                <th className="p-2">Type</th>
                <th className="p-2">Fournisseur</th>
                <th className="p-2">Unité</th>
                <th className="p-2 text-right">Coût $</th>
                <th className="p-2 text-right">Maj %</th>
                <th className="p-2 text-right">Vente $</th>
                <th className="p-2">Format</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtres.length === 0 ? (
                <tr><td colSpan={9} className="p-8 text-center text-slate-400 italic">Aucun matériau. Clique « Nouveau matériau » pour commencer.</td></tr>
              ) : filtres.map((m) => (
                <tr key={m.id} className="border-t hover:bg-emerald-50 cursor-pointer" onClick={() => setEdit({
                  id: m.id, nom: m.nom || "", type: m.type || "", fournisseur: m.fournisseur || "", unite: m.unite || "",
                  format_paquet: m.format_paquet ? String(m.format_paquet) : "", format_paquet_label: m.format_paquet_label || "",
                  prix_coutant: m.prix_coutant != null ? String(m.prix_coutant) : "",
                  majoration_pct: m.majoration_pct != null ? String(m.majoration_pct) : "20",
                  prix_vente: m.prix_vente != null ? String(m.prix_vente) : "",
                  notes: m.notes || "",
                })}>
                  <td className="p-2 font-semibold">{m.nom}</td>
                  <td className="p-2 text-xs">{TYPES.find((t) => t.v === m.type)?.l || m.type}</td>
                  <td className="p-2 text-xs">{m.fournisseur || "—"}</td>
                  <td className="p-2">{m.unite}</td>
                  <td className="p-2 text-right">{m.prix_coutant != null ? formatCAD(m.prix_coutant) : "—"}</td>
                  <td className="p-2 text-right text-slate-500">{m.majoration_pct != null ? `${m.majoration_pct}%` : "—"}</td>
                  <td className="p-2 text-right font-bold text-emerald-700">{m.prix_vente != null ? formatCAD(m.prix_vente) : "—"}</td>
                  <td className="p-2 text-xs">{m.format_paquet ? `📦 ${m.format_paquet} ${m.unite}/${m.format_paquet_label || "paquet"}` : "—"}</td>
                  <td className="p-2 text-right">
                    <button onClick={(e) => { e.stopPropagation(); if (m.id) supprimer(m.id); }} className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded">🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* Modal édition */}
      {edit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setEdit(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-2xl w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{edit.id ? "✏️ Modifier" : "➕ Nouveau matériau"}</h3>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nom du produit *</label>
              <input type="text" value={edit.nom} onChange={(e) => setEdit({ ...edit, nom: e.target.value })} placeholder='Ex: Canexel Ridgewood 8 mil — Côte Atlantique' className="w-full px-3 py-2 border rounded text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                <select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fournisseur</label>
                <input type="text" value={edit.fournisseur} onChange={(e) => setEdit({ ...edit, fournisseur: e.target.value })} placeholder="Patrick Morin, BMR, Maibec direct..." className="w-full px-3 py-2 border rounded text-sm" />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Unité *</label>
                <select value={edit.unite} onChange={(e) => setEdit({ ...edit, unite: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  {UNITES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">📦 Format paquet</label>
                <input type="number" step="0.1" value={edit.format_paquet} onChange={(e) => setEdit({ ...edit, format_paquet: e.target.value })} placeholder="Ex: 44 (Canexel)" className="w-full px-3 py-2 border rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Label paquet</label>
                <input type="text" value={edit.format_paquet_label} onChange={(e) => setEdit({ ...edit, format_paquet_label: e.target.value })} placeholder="paquet, boîte..." className="w-full px-3 py-2 border rounded text-sm" />
              </div>
            </div>
            {edit.format_paquet && (
              <div className="bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-900">
                📦 Ce matériau se vend par paquet de <strong>{edit.format_paquet} {edit.unite}</strong>. Les soumissions arrondiront automatiquement aux paquets entiers.
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Prix coûtant $/{edit.unite}</label>
                <input type="number" step="0.01" value={edit.prix_coutant} onChange={(e) => setEdit({ ...edit, prix_coutant: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Majoration %</label>
                <input type="number" step="1" value={edit.majoration_pct} onChange={(e) => setEdit({ ...edit, majoration_pct: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Prix vente $/{edit.unite}</label>
                <input type="number" step="0.01" value={edit.prix_vente} onChange={(e) => setEdit({ ...edit, prix_vente: e.target.value })} className="w-full px-3 py-2 border rounded text-sm font-bold text-emerald-700" />
              </div>
            </div>
            {edit.format_paquet && edit.prix_vente && (
              <div className="bg-emerald-50 border border-emerald-200 rounded p-2 text-xs text-emerald-900">
                💰 Prix par paquet : <strong>{formatCAD(+edit.prix_vente * +edit.format_paquet)}</strong> ({edit.format_paquet} {edit.unite} × {formatCAD(+edit.prix_vente)}/{edit.unite})
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} rows={2} placeholder="Couleur, garantie, alternative..." className="w-full px-3 py-2 border rounded text-sm" />
            </div>

            <div className="flex gap-2 justify-end pt-2 sticky bottom-0 bg-white">
              <button onClick={() => setEdit(null)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={sauvegarder} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">{edit.id ? "💾 Sauver" : "➕ Créer"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

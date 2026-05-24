"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import FAB from "@/components/FAB";
import { useToast } from "@/components/Toasts";
import { formatCAD } from "@/lib/calculateur";

const CATEGORIES = ["électrique", "manuel", "mesure", "sécurité", "échafaudage", "véhicule", "autre"];
const ETATS = ["bon", "à réparer", "perdu", "vendu"];

interface Outil {
  id: number; nom: string; categorie?: string; etat?: string;
  localisation?: string; numero_serie?: string; prix_achat?: number;
  date_achat?: string; notes?: string;
  ajoute_par?: string; date_ajout?: string;
  modifie_par?: string; date_modif?: string;
}

export default function OutilsPage() {
  const [outils, setOutils] = useState<Outil[]>([]);
  const [employes, setEmployes] = useState<{ id: number; nom: string }[]>([]);
  const [creerOuvert, setCreerOuvert] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [filtreCat, setFiltreCat] = useState<string>("");
  const [form, setForm] = useState<any>({ nom: "", categorie: "manuel", etat: "bon", localisation: "", numero_serie: "", prix_achat: "", date_achat: "", notes: "", ajoute_par: "" });
  const { toast } = useToast();

  const charger = async () => {
    const [o, e] = await Promise.all([
      fetch("/api/outils").then((r) => r.json()),
      fetch("/api/employes").then((r) => r.json()),
    ]);
    setOutils(o);
    setEmployes(e);
    if (!form.ajoute_par && e.length > 0) setForm((f: any) => ({ ...f, ajoute_par: e[0].nom }));
  };

  useEffect(() => { charger(); }, []);

  const reset = () => setForm({ nom: "", categorie: "manuel", etat: "bon", localisation: "", numero_serie: "", prix_achat: "", date_achat: "", notes: "", ajoute_par: employes[0]?.nom || "" });

  const enregistrer = async () => {
    if (!form.nom.trim()) { toast("Nom requis", "warning"); return; }
    const body = {
      ...form,
      prix_achat: form.prix_achat ? +form.prix_achat : null,
    };
    const r = editId
      ? await fetch("/api/outils", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, id: editId, modifie_par: form.ajoute_par }) })
      : await fetch("/api/outils", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (d.ok) {
      toast(editId ? "Outil mis à jour" : "Outil ajouté", "success");
      setCreerOuvert(false);
      setEditId(null);
      reset();
      charger();
    }
  };

  const ouvrirEdit = (o: Outil) => {
    setEditId(o.id);
    setForm({
      nom: o.nom, categorie: o.categorie || "manuel", etat: o.etat || "bon",
      localisation: o.localisation || "", numero_serie: o.numero_serie || "",
      prix_achat: o.prix_achat ? String(o.prix_achat) : "",
      date_achat: o.date_achat || "", notes: o.notes || "",
      ajoute_par: o.ajoute_par || employes[0]?.nom || "",
    });
    setCreerOuvert(true);
  };

  const supprimer = async (id: number) => {
    if (!confirm("Supprimer cet outil ?")) return;
    await fetch(`/api/outils?id=${id}`, { method: "DELETE" });
    toast("Outil supprimé", "info");
    charger();
  };

  const outilsFiltres = filtreCat ? outils.filter((o) => o.categorie === filtreCat) : outils;
  const totalValeur = outils.reduce((s, o) => s + (o.prix_achat || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation
        titre="🔧 Outils"
        soustitre={`${outils.length} outil(s) · valeur ${formatCAD(totalValeur)}`}
        actions={
          <button onClick={() => { setEditId(null); reset(); setCreerOuvert(true); }} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold text-left">
            ➕ Nouvel outil
          </button>
        }
      />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* Filtres catégories */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFiltreCat("")} className={`px-3 py-1 rounded text-sm ${!filtreCat ? "bg-slate-900 text-white" : "bg-white border"}`}>Tous</button>
          {CATEGORIES.map((c) => (
            <button key={c} onClick={() => setFiltreCat(c)} className={`px-3 py-1 rounded text-sm ${filtreCat === c ? "bg-slate-900 text-white" : "bg-white border"}`}>{c}</button>
          ))}
        </div>

        {outilsFiltres.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">🔧</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucun outil</h3>
            <p className="text-sm text-slate-500 mb-4">Ajoute tes outils pour suivre le matériel et qui les a inscrits.</p>
            <button onClick={() => { setEditId(null); reset(); setCreerOuvert(true); }} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Premier outil</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {outilsFiltres.map((o) => (
              <div key={o.id} className="bg-white rounded-lg shadow hover:shadow-lg transition p-4 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 truncate">{o.nom}</div>
                    <div className="text-xs text-slate-500">{o.categorie} · {o.numero_serie || "—"}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap font-semibold ${
                    o.etat === "bon" ? "bg-emerald-100 text-emerald-900" :
                    o.etat === "à réparer" ? "bg-amber-100 text-amber-900" :
                    "bg-red-100 text-red-900"
                  }`}>{o.etat}</span>
                </div>
                {o.localisation && <div className="text-xs text-slate-600">📍 {o.localisation}</div>}
                {o.prix_achat ? <div className="text-xs"><span className="text-slate-500">Valeur :</span> <strong>{formatCAD(o.prix_achat)}</strong></div> : null}
                {o.notes && <div className="text-xs text-slate-600 italic line-clamp-2">📝 {o.notes}</div>}
                <div className="pt-2 border-t text-[10px] text-slate-500 flex justify-between">
                  <span>👤 Ajouté par <strong>{o.ajoute_par || "—"}</strong></span>
                  <span>{o.date_ajout ? new Date(o.date_ajout).toLocaleDateString("fr-CA") : ""}</span>
                </div>
                {o.modifie_par && (
                  <div className="text-[10px] text-slate-500">
                    ✏️ Modifié par <strong>{o.modifie_par}</strong> · {o.date_modif ? new Date(o.date_modif).toLocaleDateString("fr-CA") : ""}
                  </div>
                )}
                <div className="flex gap-1 pt-1">
                  <button onClick={() => ouvrirEdit(o)} className="flex-1 px-2 py-1.5 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold">✏️ Modifier</button>
                  <button onClick={() => supprimer(o.id)} className="px-2 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs">🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal créer / éditer */}
      {creerOuvert && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setCreerOuvert(false)}>
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{editId ? "Modifier outil" : "Nouvel outil"}</h3>

            <Input label="Nom *" value={form.nom} onChange={(v) => setForm({ ...form, nom: v })} placeholder="Scie circulaire DeWalt..." />

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Catégorie</label>
                <select value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">État</label>
                <select value={form.etat} onChange={(e) => setForm({ ...form, etat: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  {ETATS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
            </div>

            <Input label="Localisation" value={form.localisation} onChange={(v) => setForm({ ...form, localisation: v })} placeholder="Camion, atelier..." />
            <Input label="N° série" value={form.numero_serie} onChange={(v) => setForm({ ...form, numero_serie: v })} />

            <div className="grid grid-cols-2 gap-2">
              <Input label="Prix achat $" value={form.prix_achat} onChange={(v) => setForm({ ...form, prix_achat: v })} type="number" />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date achat</label>
                <input type="date" value={form.date_achat} onChange={(e) => setForm({ ...form, date_achat: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">👤 {editId ? "Modifié" : "Inscrit"} par *</label>
              <select value={form.ajoute_par} onChange={(e) => setForm({ ...form, ajoute_par: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                <option value="">— Choisir —</option>
                {employes.map((e) => <option key={e.id} value={e.nom}>{e.nom}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border rounded text-sm" />
            </div>

            <div className="flex gap-2 justify-end pt-2 sticky bottom-0 bg-white">
              <button onClick={() => { setCreerOuvert(false); setEditId(null); }} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={enregistrer} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">{editId ? "Mettre à jour" : "Créer"}</button>
            </div>
          </div>
        </div>
      )}

      <FAB onSuccess={charger} />
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 border rounded text-sm" />
    </div>
  );
}

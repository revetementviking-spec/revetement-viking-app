"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import { ecrire, lireListe, nombreSaisi } from "@/lib/envoi";
import { useVerrou } from "@/lib/verrou";
import ErreurChargement from "@/components/ErreurChargement";
import Modale from "@/components/Modale";

export default function VehiculesPage() {
  const [vehicules, setVehicules] = useState<any[]>([]);
  const [creerOuvert, setCreerOuvert] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const vide = { nom: "", marque: "", modele: "", annee: "", plaque: "", vin: "", date_achat: "", notes: "" };
  const [form, setForm] = useState<any>(vide);
  const { toast } = useToast();

  const charger = () => lireListe("/api/vehicules").then((r) => { if (r.ok) { setErreur(null); setVehicules(r.data); } else setErreur(r.erreur); });
  useEffect(() => { charger(); }, []);

  const verrou = useVerrou();
  const sauver = () => verrou.executer(async () => {
    if (!form.nom?.trim()) { toast("Nom du véhicule requis", "warning"); return; }
    const annee = form.annee ? nombreSaisi(form.annee) : null;
    if (annee !== null && !Number.isInteger(annee)) { toast("Année invalide (ex. : 2021)", "warning"); return; }
    const body = { ...form, annee, ...(edit ? { id: edit.id } : {}) };
    // `ok !== false` acceptait un corps `{ error }` (400, 401) comme un succès : la
    // fenêtre se fermait, « Véhicule ajouté » s'affichait, et rien n'était en base.
    if (!(await ecrire("/api/vehicules", edit ? "PATCH" : "POST", body, "Enregistrement du véhicule"))) return;
    toast(edit ? "Véhicule modifié" : "Véhicule ajouté", "success");
    setCreerOuvert(false); setEdit(null); setForm(vide); charger();
  });
  const supprimer = async (id: number) => {
    if (!confirm("Supprimer ce véhicule ?")) return;
    if (!(await ecrire(`/api/vehicules?id=${id}`, "DELETE", undefined, "Suppression"))) return;
    toast("Véhicule supprimé", "info"); charger();
  };
  const ouvrirEdit = (v: any) => { setEdit(v); setForm({ ...vide, ...v, annee: v.annee || "" }); setCreerOuvert(true); };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="🚚 Véhicules" soustitre={`${vehicules.length} véhicule(s)`} />
      <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
        <button onClick={() => { setEdit(null); setForm(vide); setCreerOuvert(true); }} className="w-full md:w-auto px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold shadow">➕ Ajouter un véhicule</button>

        {erreur ? (
          <ErreurChargement erreur={erreur} onReessayer={charger} />
        ) : vehicules.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center text-slate-500"><div className="text-5xl mb-3">🚚</div>Aucun véhicule enregistré.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {vehicules.map((v) => (
              <div key={v.id} className="bg-white rounded-lg shadow p-4">
                <div className="flex justify-between items-start">
                  <div className="font-bold text-slate-900">{v.nom}</div>
                  <div className="flex gap-2">
                    <button onClick={() => ouvrirEdit(v)} aria-label={`Modifier ${v.nom}`} className="min-w-11 min-h-11 flex items-center justify-center text-xs text-emerald-700 hover:bg-emerald-50 rounded">✏️</button>
                    <button onClick={() => supprimer(v.id)} aria-label={`Supprimer ${v.nom}`} className="min-w-11 min-h-11 flex items-center justify-center text-xs text-red-600 hover:bg-red-50 rounded">🗑</button>
                  </div>
                </div>
                <div className="text-sm text-slate-600 mt-1">{[v.marque, v.modele, v.annee].filter(Boolean).join(" · ")}</div>
                {v.plaque && <div className="text-xs text-slate-500 mt-1">🔖 Plaque : <strong>{v.plaque}</strong></div>}
                {v.vin && <div className="text-xs text-slate-500">VIN : <code className="text-[10px]">{v.vin}</code></div>}
                {v.date_achat && <div className="text-xs text-slate-500">📅 Acheté : {v.date_achat}</div>}
                {v.notes && <div className="text-xs italic text-slate-600 mt-1 p-2 bg-slate-50 rounded">{v.notes}</div>}
              </div>
            ))}
          </div>
        )}
      </main>

      {creerOuvert && (
        <Modale onClose={() => setCreerOuvert(false)} titre={edit ? "Modifier le véhicule" : "Nouveau véhicule"} className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{edit ? "Modifier" : "Nouveau"} véhicule</h3>
            <I label="Nom / identifiant *" v={form.nom} on={(x: string) => setForm({ ...form, nom: x })} ph="Ex: Camion #1, F-150 blanc" />
            <div className="grid grid-cols-2 gap-2">
              <I label="Marque" v={form.marque} on={(x: string) => setForm({ ...form, marque: x })} ph="Ford" />
              <I label="Modèle" v={form.modele} on={(x: string) => setForm({ ...form, modele: x })} ph="F-150" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <I label="Année" v={form.annee} on={(x: string) => setForm({ ...form, annee: x })} type="number" />
              <I label="Plaque" v={form.plaque} on={(x: string) => setForm({ ...form, plaque: x })} />
            </div>
            <I label="VIN (n° de série)" v={form.vin} on={(x: string) => setForm({ ...form, vin: x })} />
            <I label="Date d'achat" v={form.date_achat} on={(x: string) => setForm({ ...form, date_achat: x })} type="date" />
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" rows={2} />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setCreerOuvert(false)} className="px-4 py-2 bg-slate-200 rounded text-sm">Annuler</button>
              <button onClick={sauver} disabled={verrou.occupe} className="px-4 py-2 bg-emerald-600 disabled:opacity-50 text-white rounded text-sm font-bold">{verrou.occupe ? "…" : "Sauver"}</button>
            </div>
          </div>
        </Modale>
      )}
    </div>
  );
}

function I({ label, v, on, ph, type = "text" }: { label: string; v: string; on: (x: string) => void; ph?: string; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} value={v} onChange={(e) => on(e.target.value)} placeholder={ph} className="w-full px-3 py-2 border rounded text-sm" />
    </div>
  );
}

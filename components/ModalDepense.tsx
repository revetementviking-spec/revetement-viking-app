"use client";

import { useEffect, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import BottomSheet from "@/components/BottomSheet";

interface Props { ouvert: boolean; onClose: () => void; onSuccess?: () => void; projetIdInitial?: number; }
const CATEGORIES = ["matériaux", "location", "sous-traitant", "transport", "permis", "essence", "autre"];

export default function ModalDepense({ ouvert, onClose, onSuccess, projetIdInitial }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [projets, setProjets] = useState<any[]>([]);
  const [form, setForm] = useState({ projet_id: 0, date: today, montant: "", fournisseur: "", description: "", categorie: "matériaux" });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!ouvert) return;
    fetch("/api/projets?statut=actif").then((r) => r.json()).then((d) => {
      setProjets(d);
      if (d.length > 0 && !form.projet_id) setForm((f) => ({ ...f, projet_id: projetIdInitial || d[0].id }));
    });
  }, [ouvert]);

  const projet = projets.find((p) => p.id === form.projet_id);

  const enregistrer = async () => {
    if (!form.projet_id) { toast("Sélectionne un projet", "warning"); return; }
    if (!form.montant || +form.montant <= 0) { toast("Montant requis", "warning"); return; }
    setLoading(true);
    try {
      const r = await fetch("/api/depenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, montant: +form.montant }),
      });
      if ((await r.json()).ok) {
        toast(`✓ Dépense ${formatCAD(+form.montant)} ajoutée`, "success");
        setForm({ projet_id: form.projet_id, date: today, montant: "", fournisseur: "", description: "", categorie: "matériaux" });
        onSuccess?.();
        onClose();
      }
    } finally { setLoading(false); }
  };

  return (
    <BottomSheet
      ouvert={ouvert}
      onClose={onClose}
      titre="💸 Ajouter une dépense"
      soustitre="Imputée à un projet"
      couleurHeader="from-orange-600 to-amber-600"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-3 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-semibold">Annuler</button>
          <button onClick={enregistrer} disabled={loading || projets.length === 0} className="px-5 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-bold disabled:opacity-50">
            {loading ? "⏳..." : "💾 Enregistrer"}
          </button>
        </>
      }
    >
      {projets.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
          ⚠️ Aucun projet actif. <a href="/projets" className="font-bold underline">Crée un projet</a> d'abord.
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Projet *</label>
            <select value={form.projet_id} onChange={(e) => setForm({ ...form, projet_id: +e.target.value })} className="w-full px-3 py-3 border rounded-lg text-sm bg-white">
              {projets.map((p) => <option key={p.id} value={p.id}>{p.nom}{p.client_nom ? ` (${p.client_nom})` : ""}</option>)}
            </select>
            {projet && (
              <div className="text-xs text-slate-500 mt-1 flex justify-between">
                <span>Budget : <strong>{formatCAD(projet.budget_estime || 0)}</strong></span>
                <span>Dépenses : <strong className="text-orange-700">{formatCAD(projet.total_depenses)}</strong></span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full px-3 py-3 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Montant $ *</label>
              <input type="number" inputMode="decimal" step={0.01} value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} placeholder="0.00" className="w-full px-3 py-3 border rounded-lg text-base text-right font-bold" autoFocus />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Fournisseur</label>
            <input type="text" autoCapitalize="words" value={form.fournisseur} onChange={(e) => setForm({ ...form, fournisseur: e.target.value })} placeholder="Gentek, MAC, Maibec..." className="w-full px-3 py-3 border rounded-lg text-sm" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Catégorie</label>
            <div className="grid grid-cols-3 gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setForm({ ...form, categorie: c })} className={`px-2 py-2.5 rounded-lg text-xs font-medium ${form.categorie === c ? "bg-orange-600 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Détails..." className="w-full px-3 py-3 border rounded-lg text-sm" />
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

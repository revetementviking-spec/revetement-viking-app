"use client";

import { useEffect, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import BottomSheet from "@/components/BottomSheet";

interface Props { ouvert: boolean; onClose: () => void; onSuccess?: () => void; }
interface LigneJour { projet_id: number; heures: string; description: string; }

export default function ModalHeuresJour({ ouvert, onClose, onSuccess }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [employe, setEmploye] = useState("Frédéric");
  const [tauxHoraire, setTauxHoraire] = useState("90");
  const [projets, setProjets] = useState<any[]>([]);
  const [lignes, setLignes] = useState<LigneJour[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!ouvert) return;
    fetch("/api/projets?statut=actif").then((r) => r.json()).then((d) => {
      setProjets(d);
      if (d.length > 0 && lignes.length === 0) {
        setLignes([{ projet_id: d[0].id, heures: "", description: "" }]);
      }
    });
  }, [ouvert]);

  const ajouterLigne = () => setLignes([...lignes, { projet_id: projets[0]?.id || 0, heures: "", description: "" }]);
  const supprimerLigne = (i: number) => setLignes(lignes.filter((_, idx) => idx !== i));
  const modifier = (i: number, patch: Partial<LigneJour>) => setLignes(lignes.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  const totalHeures = lignes.reduce((s, l) => s + (+l.heures || 0), 0);
  const totalCout = totalHeures * +tauxHoraire;

  const enregistrer = async () => {
    const valides = lignes.filter((l) => +l.heures > 0);
    if (valides.length === 0) { toast("Saisis au moins une ligne", "warning"); return; }
    setLoading(true);
    try {
      await Promise.all(valides.map((l) =>
        fetch("/api/heures", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projet_id: l.projet_id, date, heures: +l.heures, description: l.description, employe, taux_horaire: +tauxHoraire }),
        })
      ));
      toast(`✓ ${totalHeures} h enregistrées (${formatCAD(totalCout)})`, "success");
      setLignes([{ projet_id: projets[0]?.id || 0, heures: "", description: "" }]);
      onSuccess?.();
      onClose();
    } finally { setLoading(false); }
  };

  return (
    <BottomSheet
      ouvert={ouvert}
      onClose={onClose}
      titre="⏱️ Saisir mes heures"
      soustitre="Répartis ta journée entre projets"
      couleurHeader="from-emerald-600 to-teal-600"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-3 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-semibold">Annuler</button>
          <button onClick={enregistrer} disabled={loading || projets.length === 0} className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold disabled:opacity-50">
            {loading ? "⏳..." : "💾 Enregistrer"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-3 border rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Employé</label>
          <input type="text" autoCapitalize="words" value={employe} onChange={(e) => setEmploye(e.target.value)} className="w-full px-3 py-3 border rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">$/h</label>
          <input type="number" inputMode="decimal" value={tauxHoraire} onChange={(e) => setTauxHoraire(e.target.value)} className="w-full px-3 py-3 border rounded-lg text-sm text-right" />
        </div>
      </div>

      {projets.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
          ⚠️ Aucun projet actif. <a href="/projets" className="font-bold underline">Crée un projet</a>.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {lignes.map((l, i) => {
              const proj = projets.find((p) => p.id === l.projet_id);
              return (
                <div key={i} className="border-2 border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
                  <div className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-8">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Projet</label>
                      <select value={l.projet_id} onChange={(e) => modifier(i, { projet_id: +e.target.value })} className="w-full px-2 py-3 border rounded-lg text-sm bg-white">
                        {projets.map((p) => <option key={p.id} value={p.id}>{p.nom}{p.client_nom ? ` (${p.client_nom})` : ""}</option>)}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Heures</label>
                      <input type="number" inputMode="decimal" step={0.5} value={l.heures} onChange={(e) => modifier(i, { heures: e.target.value })} className="w-full px-2 py-3 border rounded-lg text-sm text-right font-bold" />
                    </div>
                    <div className="col-span-1">
                      {lignes.length > 1 && (
                        <button onClick={() => supprimerLigne(i)} className="w-full h-12 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-base">✕</button>
                      )}
                    </div>
                  </div>
                  <input type="text" value={l.description} onChange={(e) => modifier(i, { description: e.target.value })} placeholder="Description (optionnel)" className="w-full px-3 py-2 border rounded text-xs bg-white" />
                  {proj && (+l.heures > 0) && (
                    <div className="text-xs text-slate-600 flex justify-between">
                      <span>Reste budget: {formatCAD((proj.budget_estime || 0) - proj.cout_total)}</span>
                      <span className="font-bold text-emerald-700">+ {formatCAD(+l.heures * +tauxHoraire)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button onClick={ajouterLigne} className="w-full mt-2 px-3 py-3 border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 rounded-lg text-sm text-slate-600 font-semibold">
            ＋ Autre projet
          </button>

          {totalHeures > 0 && (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 mt-3 flex justify-between items-center">
              <div>
                <div className="text-xs text-emerald-700 uppercase font-bold">Total journée</div>
                <div className="text-2xl font-bold text-emerald-900">{totalHeures} h</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-emerald-700">Coût MO</div>
                <div className="text-xl font-bold text-emerald-900">{formatCAD(totalCout)}</div>
              </div>
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}

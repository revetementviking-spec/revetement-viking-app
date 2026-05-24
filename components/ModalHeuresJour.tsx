"use client";

import { useEffect, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import BottomSheet from "@/components/BottomSheet";

interface Props { ouvert: boolean; onClose: () => void; onSuccess?: () => void; }
interface LigneJour { projet_id: number; heures: string; description: string; }
interface Employe { id: number; nom: string; taux_horaire: number; das_pct: number; }

export default function ModalHeuresJour({ ouvert, onClose, onSuccess }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [employes, setEmployes] = useState<Employe[]>([]);
  const [empSelectionnes, setEmpSelectionnes] = useState<Set<number>>(new Set());
  const [projets, setProjets] = useState<any[]>([]);
  const [lignes, setLignes] = useState<LigneJour[]>([]);
  const [loading, setLoading] = useState(false);
  const [ajoutEmpOuvert, setAjoutEmpOuvert] = useState(false);
  const [nouvelEmp, setNouvelEmp] = useState({ nom: "", taux_horaire: "30" });
  const { toast } = useToast();

  const chargerEmployes = async () => {
    const r = await fetch("/api/employes");
    const d: Employe[] = await r.json();
    setEmployes(d);
    if (empSelectionnes.size === 0 && d.length > 0) {
      setEmpSelectionnes(new Set([d[0].id]));
    }
  };

  useEffect(() => {
    if (!ouvert) return;
    chargerEmployes();
    fetch("/api/projets?statut=actif").then((r) => r.json()).then((d) => {
      setProjets(d);
      if (d.length > 0 && lignes.length === 0) {
        setLignes([{ projet_id: d[0].id, heures: "", description: "" }]);
      }
    });
  }, [ouvert]);

  const toggleEmp = (id: number) => {
    setEmpSelectionnes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const ajouterEmploye = async () => {
    if (!nouvelEmp.nom.trim() || !+nouvelEmp.taux_horaire) { toast("Nom et taux requis", "warning"); return; }
    const r = await fetch("/api/employes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: nouvelEmp.nom.trim(), taux_horaire: +nouvelEmp.taux_horaire, das_pct: 0.15 }),
    });
    const d = await r.json();
    if (d.ok) {
      toast(`✓ ${nouvelEmp.nom} ajouté`, "success");
      setNouvelEmp({ nom: "", taux_horaire: "30" });
      setAjoutEmpOuvert(false);
      await chargerEmployes();
      setEmpSelectionnes((prev) => new Set([...prev, d.id]));
    } else {
      toast("Erreur : " + (d.error || "inconnue"), "error");
    }
  };

  const ajouterLigne = () => setLignes([...lignes, { projet_id: projets[0]?.id || 0, heures: "", description: "" }]);
  const supprimerLigne = (i: number) => setLignes(lignes.filter((_, idx) => idx !== i));
  const modifier = (i: number, patch: Partial<LigneJour>) => setLignes(lignes.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  const empsActifs = employes.filter((e) => empSelectionnes.has(e.id));
  const totalHeures = lignes.reduce((s, l) => s + (+l.heures || 0), 0);
  // Coût total = heures × somme(taux × (1 + DAS)) pour chaque employé sélectionné
  const coutEmployes = empsActifs.reduce((s, e) => s + e.taux_horaire * (1 + (e.das_pct || 0)), 0);
  const totalCout = totalHeures * coutEmployes;

  const enregistrer = async () => {
    const valides = lignes.filter((l) => +l.heures > 0);
    if (valides.length === 0) { toast("Saisis au moins une ligne", "warning"); return; }
    if (empsActifs.length === 0) { toast("Sélectionne au moins un employé", "warning"); return; }
    setLoading(true);
    try {
      // Une entrée par employé × ligne (chaque employé fait ces heures sur ce projet)
      const inserts: Promise<any>[] = [];
      for (const emp of empsActifs) {
        const tauxAvecDAS = emp.taux_horaire * (1 + (emp.das_pct || 0));
        for (const l of valides) {
          inserts.push(fetch("/api/heures", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projet_id: l.projet_id, date, heures: +l.heures,
              description: l.description, employe: emp.nom, taux_horaire: tauxAvecDAS,
            }),
          }));
        }
      }
      await Promise.all(inserts);
      toast(`✓ ${totalHeures} h × ${empsActifs.length} employé(s) (${formatCAD(totalCout)})`, "success");
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
      soustitre="Multi-employés, multi-projets"
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
      <div className="mb-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-3 border rounded-lg text-sm" />
      </div>

      {/* Sélection employés */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <label className="text-xs font-medium text-slate-600">Employés ({empSelectionnes.size} sélectionné(s))</label>
          <button type="button" onClick={() => setAjoutEmpOuvert(!ajoutEmpOuvert)} className="text-xs text-emerald-700 hover:underline font-semibold">
            {ajoutEmpOuvert ? "✕ Annuler" : "＋ Nouvel employé"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {employes.map((e) => {
            const selected = empSelectionnes.has(e.id);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => toggleEmp(e.id)}
                className={`text-left px-3 py-2 rounded-lg border-2 transition ${selected ? "bg-emerald-50 border-emerald-500" : "bg-white border-slate-200 hover:border-emerald-300"}`}
              >
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={selected} readOnly className="w-4 h-4" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{e.nom}</div>
                    <div className="text-[10px] text-slate-500">{e.taux_horaire}$/h + {((e.das_pct || 0) * 100).toFixed(0)}% DAS</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {ajoutEmpOuvert && (
          <div className="mt-2 p-3 bg-emerald-50 border-2 border-emerald-200 rounded-lg space-y-2">
            <input type="text" autoCapitalize="words" placeholder="Nom complet" value={nouvelEmp.nom} onChange={(e) => setNouvelEmp({ ...nouvelEmp, nom: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
            <div className="flex gap-2">
              <input type="number" inputMode="decimal" placeholder="Taux $/h" value={nouvelEmp.taux_horaire} onChange={(e) => setNouvelEmp({ ...nouvelEmp, taux_horaire: e.target.value })} className="flex-1 px-3 py-2 border rounded text-sm text-right" />
              <button onClick={ajouterEmploye} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">Ajouter</button>
            </div>
            <p className="text-[10px] text-slate-600">+ 15% DAS appliqué automatiquement</p>
          </div>
        )}
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
                  {proj && (+l.heures > 0) && empsActifs.length > 0 && (
                    <div className="text-xs text-slate-600 flex justify-between">
                      <span>Reste budget: {formatCAD((proj.budget_estime || 0) - proj.cout_total)}</span>
                      <span className="font-bold text-emerald-700">+ {formatCAD(+l.heures * coutEmployes)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button onClick={ajouterLigne} className="w-full mt-2 px-3 py-3 border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 rounded-lg text-sm text-slate-600 font-semibold">
            ＋ Autre projet
          </button>

          {totalHeures > 0 && empsActifs.length > 0 && (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 mt-3 flex justify-between items-center">
              <div>
                <div className="text-xs text-emerald-700 uppercase font-bold">Total journée</div>
                <div className="text-2xl font-bold text-emerald-900">{totalHeures} h × {empsActifs.length}</div>
                <div className="text-[10px] text-emerald-700">{empsActifs.map(e => e.nom).join(", ")}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-emerald-700">Coût MO (DAS inclus)</div>
                <div className="text-xl font-bold text-emerald-900">{formatCAD(totalCout)}</div>
              </div>
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}

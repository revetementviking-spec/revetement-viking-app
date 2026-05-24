"use client";

import { useEffect, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import BottomSheet from "@/components/BottomSheet";
import { compresserImage } from "@/lib/img";

interface Props { ouvert: boolean; onClose: () => void; onSuccess?: () => void; }
interface LigneJour {
  projet_id: number; heures: string; description: string;
  photos: { data: string; type: string; nom: string }[];
  heure_debut: string; heure_fin: string; dejeuner_retire: boolean;
}

/** Calcule heures entre debut et fin (format HH:MM), minus pause dîner 30 min si activé */
function calculerHeures(debut: string, fin: string, dejeunerRetire: boolean): number {
  if (!debut || !fin) return 0;
  const [hd, md] = debut.split(":").map(Number);
  const [hf, mf] = fin.split(":").map(Number);
  let mins = (hf * 60 + mf) - (hd * 60 + md);
  if (mins < 0) mins += 24 * 60; // si fin le lendemain
  if (dejeunerRetire) mins -= 30;
  return Math.max(0, mins / 60);
}
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
      // Préselectionner Gabriel si présent, sinon le premier de la liste
      const gabriel = d.find((e) => /gabriel/i.test(e.nom));
      setEmpSelectionnes(new Set([gabriel ? gabriel.id : d[0].id]));
    }
  };

  useEffect(() => {
    if (!ouvert) return;
    chargerEmployes();
    fetch("/api/projets?statut=actif").then((r) => r.json()).then((d) => {
      setProjets(d);
      if (d.length > 0 && lignes.length === 0) {
        setLignes([{ projet_id: d[0].id, heures: "", description: "", photos: [], heure_debut: "07:00", heure_fin: "15:00", dejeuner_retire: true }]);
      }
    });
  }, [ouvert]);

  const ajouterPhoto = async (ligneIdx: number, file: File) => {
    if (file.size > 20 * 1024 * 1024) { toast("Photo > 20 MB", "warning"); return; }
    try {
      const data = await compresserImage(file);
      setLignes((prev) => prev.map((l, i) => i === ligneIdx ? { ...l, photos: [...l.photos, { data, type: "image/jpeg", nom: file.name }] } : l));
    } catch (e: any) {
      toast("Erreur compression : " + e.message, "error");
    }
  };

  const retirerPhoto = (ligneIdx: number, photoIdx: number) => {
    setLignes((prev) => prev.map((l, i) => i === ligneIdx ? { ...l, photos: l.photos.filter((_, j) => j !== photoIdx) } : l));
  };

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

  const ajouterLigne = () => setLignes([...lignes, { projet_id: projets[0]?.id || 0, heures: "", description: "", photos: [], heure_debut: "07:00", heure_fin: "15:00", dejeuner_retire: true }]);
  const supprimerLigne = (i: number) => setLignes(lignes.filter((_, idx) => idx !== i));
  const modifier = (i: number, patch: Partial<LigneJour>) => setLignes(lignes.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  const empsActifs = employes.filter((e) => empSelectionnes.has(e.id));
  // Calcul auto des heures à partir de heure_debut/fin si présents et heures vide
  const heuresEffectives = (l: LigneJour): number => {
    if (l.heures) return +l.heures || 0;
    return calculerHeures(l.heure_debut, l.heure_fin, l.dejeuner_retire);
  };
  const totalHeures = lignes.reduce((s, l) => s + heuresEffectives(l), 0);
  // Coût total affiché = heures × somme(taux de base) — DAS calculée en arrière-plan
  const coutEmployes = empsActifs.reduce((s, e) => s + e.taux_horaire, 0);
  const totalCout = totalHeures * coutEmployes;

  const enregistrer = async () => {
    // Une ligne est valide si elle a des heures > 0 OU si début/fin permettent de les calculer
    const valides = lignes
      .map((l) => ({ ...l, heures_effectives: heuresEffectives(l) }))
      .filter((l) => l.heures_effectives > 0);
    if (valides.length === 0) { toast("Saisis au moins une ligne avec heures (manuel ou début/fin)", "warning"); return; }
    if (empsActifs.length === 0) { toast("Sélectionne au moins un employé", "warning"); return; }
    // Alerte budget dépassé
    for (const l of valides) {
      const p = projets.find((x) => x.id === l.projet_id);
      if (p?.budget_estime > 0) {
        const ajout = +l.heures * coutEmployes;
        const nouveauCout = p.cout_total + ajout;
        const pct = (nouveauCout / p.budget_estime) * 100;
        if (pct > 100) toast(`⚠️ ${p.nom} : budget DÉPASSÉ (${pct.toFixed(0)}%)`, "error");
        else if (pct > 90) toast(`⚠️ ${p.nom} : ${pct.toFixed(0)}% du budget`, "warning");
      }
    }
    setLoading(true);
    try {
      // Une entrée par employé × ligne (chaque employé fait ces heures sur ce projet)
      const inserts: Promise<any>[] = [];
      for (const emp of empsActifs) {
        for (const l of valides) {
          const descBase = l.description || "";
          const trace = (l.heure_debut && l.heure_fin && !l.heures)
            ? `${l.heure_debut}→${l.heure_fin}${l.dejeuner_retire ? " (-30min dîner)" : ""}`
            : "";
          const desc = [descBase, trace].filter(Boolean).join(" · ");
          inserts.push(fetch("/api/heures", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projet_id: l.projet_id, date, heures: l.heures_effectives,
              description: desc, employe: emp.nom, taux_horaire: emp.taux_horaire,
            }),
          }));
        }
      }
      await Promise.all(inserts);

      // Sauvegarder les photos par projet × ligne
      const nomsEmps = empsActifs.map((e) => e.nom).join(", ");
      const photosInserts: Promise<any>[] = [];
      for (const l of valides) {
        for (const p of l.photos) {
          photosInserts.push(fetch("/api/photos", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projet_id: l.projet_id, date, employes: nomsEmps,
              photo_data: p.data, photo_type: p.type, description: l.description || p.nom,
            }),
          }));
        }
      }
      const totalPhotos = valides.reduce((s, l) => s + l.photos.length, 0);
      if (photosInserts.length > 0) await Promise.all(photosInserts);

      toast(`✓ ${totalHeures} h × ${empsActifs.length} employé(s)${totalPhotos > 0 ? ` + ${totalPhotos} photo(s)` : ""} (${formatCAD(totalCout)})`, "success");
      setLignes([{ projet_id: projets[0]?.id || 0, heures: "", description: "", photos: [], heure_debut: "07:00", heure_fin: "15:00", dejeuner_retire: true }]);
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
            <p className="text-[10px] text-slate-600">Configurer les infos complètes dans l'onglet <a href="/employes" className="font-bold underline">Employés</a></p>
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
              const heuresCalc = heuresEffectives(l);
              return (
                <div key={i} className="border-2 border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Projet</label>
                      <select value={l.projet_id} onChange={(e) => modifier(i, { projet_id: +e.target.value })} className="w-full px-2 py-3 border rounded-lg text-sm bg-white">
                        {projets.map((p) => <option key={p.id} value={p.id}>{p.nom}{p.client_nom ? ` (${p.client_nom})` : ""}</option>)}
                      </select>
                    </div>
                    {lignes.length > 1 && (
                      <button onClick={() => supprimerLigne(i)} className="w-12 h-12 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-base flex-shrink-0">✕</button>
                    )}
                  </div>

                  {/* Heures d'entrée/sortie + dîner */}
                  <div className="bg-white border rounded-lg p-2 space-y-2">
                    <div className="grid grid-cols-3 gap-2 items-end">
                      <div>
                        <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Entrée</label>
                        <input type="time" value={l.heure_debut} onChange={(e) => modifier(i, { heure_debut: e.target.value, heures: "" })} className="w-full px-2 py-2 border rounded text-sm" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Sortie</label>
                        <input type="time" value={l.heure_fin} onChange={(e) => modifier(i, { heure_fin: e.target.value, heures: "" })} className="w-full px-2 py-2 border rounded text-sm" />
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500">Total</div>
                        <div className="text-lg font-bold text-emerald-700">{heuresCalc.toFixed(2)} h</div>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={l.dejeuner_retire} onChange={(e) => modifier(i, { dejeuner_retire: e.target.checked, heures: "" })} className="w-4 h-4" />
                      <span>🥪 Retirer dîner (30 min)</span>
                    </label>
                    <details className="text-[10px]">
                      <summary className="text-slate-500 cursor-pointer">Saisie manuelle des heures</summary>
                      <div className="mt-1">
                        <input type="number" inputMode="decimal" step={0.25} placeholder="ex: 7.5" value={l.heures} onChange={(e) => modifier(i, { heures: e.target.value })} className="w-full px-2 py-2 border rounded text-sm text-right font-bold" />
                        <p className="text-[10px] text-slate-500 mt-0.5">Si rempli, écrase le calcul début/fin.</p>
                      </div>
                    </details>
                  </div>
                  <input type="text" value={l.description} onChange={(e) => modifier(i, { description: e.target.value })} placeholder="Description (optionnel)" className="w-full px-3 py-2 border rounded text-xs bg-white" />

                  {/* 📸 Photos du jour pour CE projet */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-semibold text-slate-600">📸 Photos du jour ({l.photos.length})</label>
                      <div className="flex gap-1">
                        <label className="cursor-pointer text-[10px] bg-blue-100 hover:bg-blue-200 text-blue-800 px-2 py-1 rounded font-semibold">
                          📷 Photo
                          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && ajouterPhoto(i, e.target.files[0])} />
                        </label>
                        <label className="cursor-pointer text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-800 px-2 py-1 rounded font-semibold">
                          📁 Galerie
                          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []); files.forEach((f) => ajouterPhoto(i, f)); }} />
                        </label>
                      </div>
                    </div>
                    {l.photos.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {l.photos.map((p, pi) => (
                          <div key={pi} className="relative w-14 h-14">
                            <img src={p.data} alt={p.nom} className="w-14 h-14 object-cover rounded border" />
                            <button onClick={() => retirerPhoto(i, pi)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-xs font-bold flex items-center justify-center shadow">✕</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {proj && heuresCalc > 0 && empsActifs.length > 0 && (
                    <div className="text-xs text-slate-600 flex justify-between">
                      <span>Reste budget: {formatCAD((proj.budget_estime || 0) - proj.cout_total)}</span>
                      <span className="font-bold text-emerald-700">+ {formatCAD(heuresCalc * coutEmployes)}</span>
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

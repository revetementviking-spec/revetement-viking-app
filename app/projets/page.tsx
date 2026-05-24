"use client";

import { useEffect, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import FAB from "@/components/FAB";

const STATUTS: Record<string, { label: string; couleur: string }> = {
  actif: { label: "Actif", couleur: "bg-emerald-100 text-emerald-900" },
  en_pause: { label: "En pause", couleur: "bg-amber-100 text-amber-900" },
  complete: { label: "Complété", couleur: "bg-blue-100 text-blue-900" },
  annule: { label: "Annulé", couleur: "bg-red-100 text-red-900" },
};

export default function ProjetsPage() {
  const [projets, setProjets] = useState<any[]>([]);
  const [filtre, setFiltre] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [creerOuvert, setCreerOuvert] = useState(false);
  const [nouveau, setNouveau] = useState({ nom: "", client_nom: "", adresse_chantier: "", budget_estime: "", description: "" });
  const { toast } = useToast();

  const charger = async () => {
    setLoading(true);
    const url = filtre ? `/api/projets?statut=${filtre}` : "/api/projets";
    const r = await fetch(url);
    setProjets(await r.json());
    setLoading(false);
  };

  useEffect(() => { charger(); }, [filtre]);

  const creer = async () => {
    if (!nouveau.nom.trim()) { toast("Nom du projet requis", "warning"); return; }
    const r = await fetch("/api/projets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...nouveau,
        budget_estime: nouveau.budget_estime ? +nouveau.budget_estime : null,
        date_debut: new Date().toISOString().slice(0, 10),
      }),
    });
    const d = await r.json();
    if (d.ok) {
      toast("Projet créé", "success");
      setCreerOuvert(false);
      setNouveau({ nom: "", client_nom: "", adresse_chantier: "", budget_estime: "", description: "" });
      charger();
    }
  };

  const stats = {
    actifs: projets.filter((p) => p.statut === 'actif').length,
    budget_total: projets.filter((p) => p.statut === 'actif').reduce((s, p) => s + (p.budget_estime || 0), 0),
    cout_total: projets.filter((p) => p.statut === 'actif').reduce((s, p) => s + (p.cout_total || 0), 0),
    facture_total: projets.filter((p) => p.statut === 'actif').reduce((s, p) => s + (p.total_facture || 0), 0),
    paye_total: projets.filter((p) => p.statut === 'actif').reduce((s, p) => s + (p.total_paye || 0), 0),
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation
        titre="🏗️ Projets"
        soustitre={`${projets.length} projet(s)${filtre ? ` · ${STATUTS[filtre]?.label}` : ""}`}
        actions={
          <button onClick={() => setCreerOuvert(true)} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold text-left">
            ➕ Nouveau projet
          </button>
        }
      />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* KPIs projets actifs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KPI label="Projets actifs" value={stats.actifs} />
          <KPI label="Budget total" value={formatCAD(stats.budget_total)} />
          <KPI label="Coût engagé" value={formatCAD(stats.cout_total)} couleur="text-amber-700" />
          <KPI label="Facturé" value={formatCAD(stats.facture_total)} couleur="text-blue-700" />
          <KPI label="Payé" value={formatCAD(stats.paye_total)} couleur="text-emerald-700" />
        </div>

        {/* Filtres */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFiltre("")} className={`px-3 py-1 rounded text-sm ${!filtre ? "bg-slate-900 text-white" : "bg-white border"}`}>Tous</button>
          {Object.entries(STATUTS).map(([k, v]) => (
            <button key={k} onClick={() => setFiltre(k)} className={`px-3 py-1 rounded text-sm ${filtre === k ? "bg-slate-900 text-white" : v.couleur}`}>{v.label}</button>
          ))}
        </div>

        {/* Liste projets */}
        {loading ? (
          <div className="bg-white rounded-lg shadow p-6 text-center text-slate-500">Chargement...</div>
        ) : projets.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">🏗️</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucun projet</h3>
            <p className="text-sm text-slate-500 mb-4">Convertis une soumission acceptée en projet, ou crée un projet manuellement.</p>
            <button onClick={() => setCreerOuvert(true)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Nouveau projet</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projets.map((p) => (
              <a key={p.id} href={`/projets/${p.id}`} className="bg-white rounded-lg shadow hover:shadow-lg transition p-4 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 truncate">{p.nom}</div>
                    <div className="text-xs text-slate-500 truncate">{p.client_nom || "Sans client"}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${STATUTS[p.statut]?.couleur || "bg-slate-200"}`}>{STATUTS[p.statut]?.label || p.statut}</span>
                </div>

                {p.adresse_chantier && <div className="text-xs text-slate-600">📍 {p.adresse_chantier}</div>}

                {/* Barre budget vs coût */}
                {p.budget_estime > 0 && (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span>Budget : <strong>{formatCAD(p.budget_estime)}</strong></span>
                      <span className={p.pct_budget_consomme > 90 ? "text-red-600 font-bold" : p.pct_budget_consomme > 75 ? "text-amber-600" : "text-slate-600"}>{p.pct_budget_consomme.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className={`h-full ${p.pct_budget_consomme > 100 ? "bg-red-500" : p.pct_budget_consomme > 90 ? "bg-amber-500" : p.pct_budget_consomme > 75 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, p.pct_budget_consomme)}%` }} />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1 text-xs pt-2 border-t">
                  <div><span className="text-slate-500">MO :</span> <strong>{p.total_heures.toFixed(1)} h</strong></div>
                  <div><span className="text-slate-500">Coût :</span> <strong>{formatCAD(p.cout_total)}</strong></div>
                  <div><span className="text-slate-500">Facturé :</span> <strong>{formatCAD(p.total_facture)}</strong></div>
                  <div><span className="text-slate-500">Payé :</span> <strong className="text-emerald-700">{formatCAD(p.total_paye)}</strong></div>
                </div>

                {p.marge !== undefined && p.budget_estime > 0 && (
                  <div className={`text-xs font-bold text-center py-1 rounded ${p.marge < 0 ? "bg-red-50 text-red-700" : p.marge_pct < 15 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                    Marge : {formatCAD(p.marge)} ({p.marge_pct.toFixed(0)}%)
                  </div>
                )}
              </a>
            ))}
          </div>
        )}
      </main>

      {/* Modal créer projet */}
      {creerOuvert && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setCreerOuvert(false)}>
          <div className="bg-white rounded-lg max-w-md w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Nouveau projet</h3>
            <Input label="Nom du projet *" value={nouveau.nom} onChange={(v) => setNouveau({ ...nouveau, nom: v })} />
            <Input label="Client" value={nouveau.client_nom} onChange={(v) => setNouveau({ ...nouveau, client_nom: v })} placeholder="(crée automatiquement si nouveau)" />
            <Input label="Adresse chantier" value={nouveau.adresse_chantier} onChange={(v) => setNouveau({ ...nouveau, adresse_chantier: v })} />
            <Input label="Budget estimé $" value={nouveau.budget_estime} onChange={(v) => setNouveau({ ...nouveau, budget_estime: v })} type="number" />
            <Input label="Description" value={nouveau.description} onChange={(v) => setNouveau({ ...nouveau, description: v })} />
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setCreerOuvert(false)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={creer} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold">Créer</button>
            </div>
          </div>
        </div>
      )}
      <FAB onSuccess={charger} />
    </div>
  );
}

function KPI({ label, value, couleur }: { label: string; value: any; couleur?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-3">
      <div className="text-[10px] text-slate-500 uppercase font-semibold">{label}</div>
      <div className={`text-lg font-bold mt-1 ${couleur || "text-slate-900"}`}>{value}</div>
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

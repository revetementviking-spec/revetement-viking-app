"use client";

import { useEffect, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import ModalHeuresJour from "@/components/ModalHeuresJour";
import ModalDepense from "@/components/ModalDepense";
import FAB from "@/components/FAB";

const STATUT_LABELS: Record<string, { label: string; couleur: string }> = {
  brouillon: { label: "Brouillon", couleur: "bg-slate-200 text-slate-800" },
  envoyee: { label: "Envoyée", couleur: "bg-blue-200 text-blue-900" },
  acceptee: { label: "Acceptée", couleur: "bg-emerald-200 text-emerald-900" },
  refusee: { label: "Refusée", couleur: "bg-red-200 text-red-900" },
  facturee: { label: "Facturée", couleur: "bg-purple-200 text-purple-900" },
};

export default function Dashboard() {
  const [stats, setStats] = useState<any>(null);
  const [rendements, setRendements] = useState<any>(null);
  const [projetsActifs, setProjetsActifs] = useState<any[]>([]);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [modalHeures, setModalHeures] = useState(false);
  const [modalDepense, setModalDepense] = useState(false);
  const { toast } = useToast();

  const charger = async () => {
    const [s, r, p] = await Promise.all([
      fetch("/api/soumissions?stats=1").then((r) => r.json()),
      fetch("/api/rendements").then((r) => r.json()),
      fetch("/api/projets?statut=actif").then((r) => r.json()),
    ]);
    setStats(s);
    setRendements(r);
    setProjetsActifs(p);
  };

  useEffect(() => { charger(); }, []);

  const chargerDemo = async () => {
    setLoadingDemo(true);
    try {
      const r = await fetch("/api/demo", { method: "POST" });
      const d = await r.json();
      toast(`✨ ${d.soumissions} soumissions + ${d.bibliotheque} jobs de référence chargées`, "success");
      await charger();
    } finally { setLoadingDemo(false); }
  };

  const resetDemo = async () => {
    if (!confirm("Effacer TOUTES les soumissions et la bibliothèque ?")) return;
    await fetch("/api/demo?action=reset", { method: "POST" });
    toast("Données effacées", "info");
    await charger();
  };

  if (!stats) return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📊 Tableau de bord" />
      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-4"><div className="skeleton h-3 w-2/3 mb-2" /><div className="skeleton h-7 w-1/2" /></div>
          <div className="bg-white rounded-lg shadow p-4"><div className="skeleton h-3 w-2/3 mb-2" /><div className="skeleton h-7 w-1/2" /></div>
          <div className="bg-white rounded-lg shadow p-4"><div className="skeleton h-3 w-2/3 mb-2" /><div className="skeleton h-7 w-1/2" /></div>
          <div className="bg-white rounded-lg shadow p-4"><div className="skeleton h-3 w-2/3 mb-2" /><div className="skeleton h-7 w-1/2" /></div>
        </div>
        <div className="bg-white rounded-lg shadow p-5"><div className="skeleton h-4 w-1/4 mb-3" /><div className="skeleton h-3 w-full" /></div>
      </main>
    </div>
  );

  const aucuneDonnee = stats.total_soumissions === 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📊 Tableau de bord" soustitre="Pipeline et performance" />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4 md:space-y-6">

        {/* ⚡ ACTIONS RAPIDES — toujours visible en haut */}
        <section className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-lg p-4 md:p-5">
          <h2 className="text-sm font-bold text-emerald-900 uppercase mb-3">⚡ Actions rapides</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            <button onClick={() => setModalHeures(true)} className="bg-white hover:bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">⏱️</div>
              <div className="font-bold text-emerald-900 text-sm md:text-base">Saisir mes heures</div>
              <div className="text-[10px] md:text-xs text-slate-600">Journée + projets</div>
            </button>
            <button onClick={() => setModalDepense(true)} className="bg-white hover:bg-orange-50 border-2 border-orange-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">💸</div>
              <div className="font-bold text-orange-900 text-sm md:text-base">Ajouter dépense</div>
              <div className="text-[10px] md:text-xs text-slate-600">Imputée à un projet</div>
            </button>
            <a href="/" className="bg-white hover:bg-blue-50 border-2 border-blue-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">📄</div>
              <div className="font-bold text-blue-900 text-sm md:text-base">Nouvelle soumission</div>
              <div className="text-[10px] md:text-xs text-slate-600">Hover + IA</div>
            </a>
            <a href="/projets" className="bg-white hover:bg-purple-50 border-2 border-purple-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">🏗️</div>
              <div className="font-bold text-purple-900 text-sm md:text-base">Mes projets</div>
              <div className="text-[10px] md:text-xs text-slate-600">{projetsActifs.length} actif(s)</div>
            </a>
          </div>
        </section>

        {/* 🏗️ PROJETS ACTIFS — résumé compact */}
        {projetsActifs.length > 0 && (
          <section className="bg-white rounded-lg shadow p-4 md:p-5">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-semibold text-slate-900">🏗️ Projets actifs ({projetsActifs.length})</h2>
              <a href="/projets" className="text-xs text-emerald-600 hover:underline font-semibold">Voir tous →</a>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {projetsActifs.slice(0, 6).map((p) => (
                <a key={p.id} href={`/projets/${p.id}`} className="border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 rounded p-2 transition">
                  <div className="flex justify-between items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">{p.nom}</div>
                      <div className="text-xs text-slate-500 truncate">{p.client_nom || "—"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-700">{p.total_heures.toFixed(0)} h</div>
                      <div className={`text-xs font-bold ${p.marge < 0 ? "text-red-600" : "text-emerald-600"}`}>{p.budget_estime > 0 ? `${p.marge_pct.toFixed(0)}%` : "—"}</div>
                    </div>
                  </div>
                  {p.budget_estime > 0 && (
                    <div className="mt-1.5 h-1 bg-slate-200 rounded overflow-hidden">
                      <div className={`h-full ${p.pct_budget_consomme > 100 ? "bg-red-500" : p.pct_budget_consomme > 90 ? "bg-amber-500" : p.pct_budget_consomme > 75 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, p.pct_budget_consomme)}%` }} />
                    </div>
                  )}
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Bandeau démo si vide */}
        {aucuneDonnee && (
          <div className="bg-gradient-to-r from-violet-50 to-fuchsia-50 border-2 border-violet-300 rounded-lg p-5 text-center">
            <h2 className="text-xl font-bold text-violet-900 mb-1">👋 Bienvenue dans Revêtement Viking</h2>
            <p className="text-sm text-violet-700 mb-3">Aucune soumission encore. Charge un jeu de démo pour voir l'app vivante, ou démarre une nouvelle soumission.</p>
            <div className="flex gap-2 justify-center flex-wrap">
              <button onClick={chargerDemo} disabled={loadingDemo} className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-semibold disabled:opacity-50">
                {loadingDemo ? "⏳ Chargement..." : "✨ Charger les données démo"}
              </button>
              <a href="/" className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Nouvelle soumission</a>
            </div>
          </div>
        )}

        {/* KPIs principaux */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPI label="Soumissions ce mois" value={stats.mois_courant} />
          <KPI label="Total ce mois" value={formatCAD(stats.total_mois_courant)} />
          <KPI label="Pipeline (envoyées)" value={formatCAD(stats.pipeline)} sub="en attente" couleur="text-blue-600" />
          <KPI label="Revenus acceptés" value={formatCAD(stats.revenus_acceptes)} couleur="text-emerald-600" />
        </div>

        {/* Conversion */}
        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="font-semibold mb-2">Taux de conversion</h2>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold text-emerald-600">
              {(stats.taux_conversion * 100).toFixed(0)}%
            </div>
            <div className="flex-1 text-sm text-slate-600">
              Acceptées vs envoyées (excluant brouillons).
              <div className="mt-2 h-3 bg-slate-200 rounded overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${stats.taux_conversion * 100}%` }} />
              </div>
            </div>
          </div>
        </section>

        {/* Par statut */}
        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="font-semibold mb-3">Pipeline par statut</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {Object.entries(STATUT_LABELS).map(([k, v]) => (
              <a key={k} href={`/soumissions?statut=${k}`} className={`${v.couleur} rounded p-3 hover:opacity-80 transition`}>
                <div className="text-xs uppercase font-bold opacity-75">{v.label}</div>
                <div className="text-2xl font-bold">{stats.compte_par_statut[k] || 0}</div>
                <div className="text-xs">{formatCAD(stats.total_par_statut[k] || 0)}</div>
              </a>
            ))}
          </div>
        </section>

        {/* Apprentissage rendements */}
        {rendements && Object.keys(rendements).length > 0 && (
          <section className="bg-white rounded-lg shadow p-5">
            <h2 className="font-semibold mb-3">📈 Apprentissage rendements (réel vs estimé)</h2>
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left">
                <tr>
                  <th className="p-2">Catégorie</th>
                  <th className="p-2 text-right">Jobs</th>
                  <th className="p-2 text-right">Qté totale</th>
                  <th className="p-2 text-right">H. estimées</th>
                  <th className="p-2 text-right">H. réelles</th>
                  <th className="p-2 text-right">Écart</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(rendements).map(([cat, r]: any) => {
                  const ecart = ((r.ratio - 1) * 100).toFixed(0);
                  const couleur = r.ratio > 1.1 ? "text-red-600" : r.ratio < 0.9 ? "text-amber-600" : "text-emerald-600";
                  return (
                    <tr key={cat} className="border-t">
                      <td className="p-2 font-medium">{cat}</td>
                      <td className="p-2 text-right">{r.n}</td>
                      <td className="p-2 text-right">{r.qty.toFixed(0)}</td>
                      <td className="p-2 text-right">{r.h_est.toFixed(1)} h</td>
                      <td className="p-2 text-right">{r.h_reel.toFixed(1)} h</td>
                      <td className={`p-2 text-right font-bold ${couleur}`}>{ecart > "0" ? "+" : ""}{ecart}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 mt-2">
              Écart positif = tu prends plus de temps qu'estimé → tes rendements doivent baisser.
              Écart négatif = tu vas plus vite → tu peux estimer plus serré.
            </p>
          </section>
        )}

        {!aucuneDonnee && (
          <div className="text-right">
            <button onClick={resetDemo} className="text-xs text-slate-400 hover:text-red-600">🗑 Effacer toutes les données (démo)</button>
          </div>
        )}
      </main>

      <ModalHeuresJour ouvert={modalHeures} onClose={() => setModalHeures(false)} onSuccess={charger} />
      <ModalDepense ouvert={modalDepense} onClose={() => setModalDepense(false)} onSuccess={charger} />
      <FAB onSuccess={charger} />
    </div>
  );
}

function KPI({ label, value, sub, couleur }: { label: string; value: any; sub?: string; couleur?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="text-xs text-slate-500 uppercase">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${couleur || ""}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

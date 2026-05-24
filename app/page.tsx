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

export default function Home() {
  const [stats, setStats] = useState<any>(null);
  const [projetsActifs, setProjetsActifs] = useState<any[]>([]);
  const [heuresSemaine, setHeuresSemaine] = useState<any[]>([]);
  const [relances, setRelances] = useState<any[]>([]);
  const [tourOuvert, setTourOuvert] = useState(false);
  const [modalHeures, setModalHeures] = useState(false);
  const [modalDepense, setModalDepense] = useState(false);
  const { toast } = useToast();

  const charger = async () => {
    const [s, p, h, r] = await Promise.all([
      fetch("/api/soumissions?stats=1").then((r) => r.json()),
      fetch("/api/projets?statut=actif").then((r) => r.json()),
      fetch("/api/heures-sommaire?jours=7").then((r) => r.json()).catch(() => []),
      fetch("/api/relances").then((r) => r.json()).catch(() => []),
    ]);
    setStats(s);
    setProjetsActifs(p);
    setHeuresSemaine(h);
    setRelances(r);
  };

  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("vk-tour-vu")) {
      setTimeout(() => setTourOuvert(true), 800);
    }
  }, []);
  const fermerTour = () => { setTourOuvert(false); localStorage.setItem("vk-tour-vu", "1"); };

  useEffect(() => { charger(); }, []);

  if (!stats) return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="Revêtement Viking" soustitre="Tableau de bord" />
      <main className="max-w-7xl mx-auto p-4 md:p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map((i) => (
            <div key={i} className="bg-white rounded-lg shadow p-4">
              <div className="skeleton h-3 w-2/3 mb-2" /><div className="skeleton h-7 w-1/2" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="Revêtement Viking" soustitre="Tableau de bord · RBQ 5811-4299-01" />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4 md:space-y-6">

        {/* ⚡ ACTIONS RAPIDES */}
        <section className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-lg p-4 md:p-5">
          <h2 className="text-sm font-bold text-emerald-900 uppercase mb-3">⚡ Actions rapides</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            <button onClick={() => setModalHeures(true)} className="bg-white hover:bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">⏱️</div>
              <div className="font-bold text-emerald-900 text-sm md:text-base">Saisir mes heures</div>
              <div className="text-[10px] md:text-xs text-slate-600">Multi-employés</div>
            </button>
            <button onClick={() => setModalDepense(true)} className="bg-white hover:bg-orange-50 border-2 border-orange-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">💸</div>
              <div className="font-bold text-orange-900 text-sm md:text-base">Ajouter dépense</div>
              <div className="text-[10px] md:text-xs text-slate-600">Imputée à un projet</div>
            </button>
            <a href="/soumissions/nouveau" className="bg-white hover:bg-blue-50 border-2 border-blue-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-3">
            <a href="/clients" className="text-center bg-white/70 hover:bg-white border border-slate-200 rounded p-2 text-xs font-semibold text-slate-700">👥 CRM</a>
            <a href="/contrats" className="text-center bg-white/70 hover:bg-white border border-slate-200 rounded p-2 text-xs font-semibold text-slate-700">📝 Contrats</a>
            <a href="/finances" className="text-center bg-white/70 hover:bg-white border border-slate-200 rounded p-2 text-xs font-semibold text-slate-700">💰 Finances</a>
            <a href="/finances/paye" className="text-center bg-white/70 hover:bg-white border border-slate-200 rounded p-2 text-xs font-semibold text-slate-700">💵 Paie</a>
            <a href="/soumissions" className="text-center bg-white/70 hover:bg-white border border-slate-200 rounded p-2 text-xs font-semibold text-slate-700">📋 Soumissions</a>
          </div>
        </section>

        {/* PROJETS ACTIFS */}
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

        {/* RELANCES — soumissions envoyées > 7 jours sans réponse */}
        {relances.length > 0 && (
          <section className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4 md:p-5">
            <h2 className="font-bold text-amber-900 mb-2">⏰ À relancer ({relances.length})</h2>
            <p className="text-xs text-amber-800 mb-3">Soumissions envoyées depuis plus de 7 jours sans réponse.</p>
            <div className="space-y-1">
              {relances.slice(0, 5).map((s) => {
                const jours = Math.floor((Date.now() - new Date(s.date_envoi).getTime()) / 86400000);
                return (
                  <a key={s.numero} href={`/soumissions/${s.numero}`} className="flex justify-between items-center bg-white hover:bg-amber-100 rounded px-3 py-2 transition border border-amber-200">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-sm truncate">{s.numero} · {s.client_nom}</div>
                      <div className="text-xs text-amber-700">{jours} jours sans réponse</div>
                    </div>
                    <div className="text-sm font-bold text-slate-700">{formatCAD(s.total || 0)}</div>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {/* HEURES PAR EMPLOYÉ — 7 derniers jours */}
        {heuresSemaine.length > 0 && (
          <section className="bg-white rounded-lg shadow p-4 md:p-5">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-semibold text-slate-900">👷 Heures par employé · 7 derniers jours</h2>
              <a href="/heures" className="text-xs text-emerald-700 hover:underline font-semibold">✏️ Voir / modifier →</a>
            </div>
            <div className="space-y-2">
              {heuresSemaine.map((e, i) => {
                const maxH = Math.max(...heuresSemaine.map((x) => x.total_heures));
                const pct = maxH > 0 ? (e.total_heures / maxH) * 100 : 0;
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-32 md:w-40 text-sm font-semibold truncate">{e.employe}</div>
                    <div className="flex-1 h-7 bg-slate-100 rounded relative overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${pct}%` }} />
                      <div className="absolute inset-0 flex items-center justify-between px-2 text-xs font-semibold text-slate-900">
                        <span>{e.total_heures.toFixed(1)} h · {e.n_jours} j</span>
                        <span>{formatCAD(e.cout_total)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <KPI label="Soumissions mois" value={stats.mois_courant} />
          <KPI label="Total mois" value={formatCAD(stats.total_mois_courant)} />
          <KPI label="Pipeline" value={formatCAD(stats.pipeline)} couleur="text-blue-600" />
          <KPI label="Acceptées" value={formatCAD(stats.revenus_acceptes)} couleur="text-emerald-600" />
        </div>

        {/* Statuts */}
        <section className="bg-white rounded-lg shadow p-4 md:p-5">
          <h2 className="font-semibold mb-3">Pipeline par statut</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3">
            {Object.entries(STATUT_LABELS).map(([k, v]) => (
              <a key={k} href={`/soumissions?statut=${k}`} className={`${v.couleur} rounded p-3 hover:opacity-80 transition`}>
                <div className="text-xs uppercase font-bold opacity-75">{v.label}</div>
                <div className="text-2xl font-bold">{stats.compte_par_statut?.[k] || 0}</div>
                <div className="text-xs">{formatCAD(stats.total_par_statut?.[k] || 0)}</div>
              </a>
            ))}
          </div>
        </section>
      </main>

      <ModalHeuresJour ouvert={modalHeures} onClose={() => setModalHeures(false)} onSuccess={charger} />
      <ModalDepense ouvert={modalDepense} onClose={() => setModalDepense(false)} onSuccess={charger} />
      <FAB onSuccess={charger} />

      {/* Tour guidé première visite */}
      {tourOuvert && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-4" onClick={fermerTour}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3 animate-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <img src="/logo-viking.svg" alt="Viking" className="h-20 w-20 mx-auto drakkar-animate" />
              <h2 className="text-xl font-bold mt-2">Bienvenue dans Revêtement Viking</h2>
            </div>
            <ul className="text-sm space-y-2 text-slate-700">
              <li><strong>⚡ Actions rapides</strong> — saisis heures, dépenses, soumissions en haut de cette page.</li>
              <li><strong>🏗️ Projets</strong> — chaque projet affiche budget, coût, marge en temps réel.</li>
              <li><strong>👷 Heures multi-employés</strong> — coche plusieurs employés, mêmes heures pour tous.</li>
              <li><strong>💰 Finances</strong> — vue annuelle avec graphique mensuel.</li>
              <li><strong>📈 Rapports</strong> — export CSV pour ta comptable.</li>
              <li><strong>🔍 Recherche</strong> — clients, projets, soumissions instantanés en haut.</li>
            </ul>
            <button onClick={fermerTour} className="w-full mt-3 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold">C'est parti !</button>
          </div>
        </div>
      )}
    </div>
  );
}

function KPI({ label, value, sub, couleur }: { label: string; value: any; sub?: string; couleur?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-3 md:p-4">
      <div className="text-[10px] md:text-xs text-slate-500 uppercase font-semibold">{label}</div>
      <div className={`text-xl md:text-2xl font-bold mt-1 ${couleur || "text-slate-900"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import ModalHeuresJour from "@/components/ModalHeuresJour";
import ModalDepense from "@/components/ModalDepense";
import ModalPhotos from "@/components/ModalPhotos";
import FAB from "@/components/FAB";
import Meteo from "@/components/Meteo";

const STATUT_LABELS: Record<string, { label: string; couleur: string }> = {
  brouillon: { label: "Brouillon", couleur: "bg-slate-200 text-slate-800" },
  envoyee: { label: "Envoyée", couleur: "bg-blue-200 text-blue-900" },
  acceptee: { label: "Acceptée", couleur: "bg-emerald-200 text-emerald-900" },
  refusee: { label: "Refusée", couleur: "bg-red-200 text-red-900" },
  facturee: { label: "Facturée", couleur: "bg-purple-200 text-purple-900" },
};

function Salutation() {
  const h = new Date().getHours();
  const salut = h < 5 ? "🌙 Bonne nuit" : h < 12 ? "☀️ Bonjour" : h < 17 ? "👋 Bon après-midi" : h < 21 ? "🌆 Bonsoir" : "🌙 Bonne soirée";
  const date = new Date().toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="flex items-baseline justify-between gap-3 flex-wrap">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{salut}, Gabriel</h1>
      <p className="text-sm text-slate-500 capitalize">{date}</p>
    </div>
  );
}

export default function Home() {
  const [stats, setStats] = useState<any>({});
  const [projetsActifs, setProjetsActifs] = useState<any[]>([]);
  const [heuresSemaine, setHeuresSemaine] = useState<any[]>([]);
  const [relances, setRelances] = useState<any[]>([]);
  const [annuel, setAnnuel] = useState<{ ca: number; depenses: number; mo: number } | null>(null);
  const [tableauBord, setTableauBord] = useState<any>(null);
  const [mesTaches, setMesTaches] = useState<any[]>([]);
  const [monUser, setMonUser] = useState<string>("");
  const [modalHeures, setModalHeures] = useState(false);
  const [modalDepense, setModalDepense] = useState(false);
  const [modalPhotos, setModalPhotos] = useState(false);
  const { toast } = useToast();

  const charger = async () => {
    // Streaming progressif : chaque section apparaît dès que son fetch arrive,
    // au lieu d'attendre que tous les 4 soient terminés.
    // Streaming progressif : chaque fetch met à jour son state indépendamment
    fetch("/api/soumissions?stats=1").then((r) => r.json()).then(setStats).catch(() => {});
    fetch("/api/projets?statut=actif").then((r) => r.json()).then(setProjetsActifs).catch(() => {});
    fetch("/api/heures-sommaire?jours=7").then((r) => r.json()).then(setHeuresSemaine).catch(() => {});
    fetch("/api/relances").then((r) => r.json()).then(setRelances).catch(() => {});
    fetch("/api/dashboard").then((r) => r.json()).then(setTableauBord).catch(() => {});
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      const u = d?.user || "";
      setMonUser(u);
      if (u) fetch(`/api/mes-taches?user=${u}`).then((r) => r.json()).then((arr) => setMesTaches(Array.isArray(arr) ? arr : [])).catch(() => {});
    }).catch(() => {});
    // Totaux de l'année : chiffre d'affaires + dépenses (tous projets, pas juste actifs)
    fetch(`/api/finances?annee=${new Date().getFullYear()}`).then((r) => r.json()).then((d) => {
      const t = (d.mois || []).reduce((s: any, m: any) => ({
        ca: s.ca + (m.revenu || 0), depenses: s.depenses + (m.depenses || 0), mo: s.mo + (m.mo || 0),
      }), { ca: 0, depenses: 0, mo: 0 });
      setAnnuel(t);
    }).catch(() => {});
  };


  useEffect(() => { charger(); }, []);

  // On NE bloque plus le rendu — chaque section affiche son propre skeleton si data pas prête.
  // First Paint sub-100ms même sur 4G lent.

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="Revêtement Viking" soustitre="Tableau de bord · RBQ 5811-4299-01" />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4 md:space-y-6">

        {/* 👋 SALUTATION DU JOUR */}
        <Salutation />

        {/* 🌤️ MÉTÉO 7 JOURS */}
        <Meteo />

        {/* 📊 TOTAUX DE L'ANNÉE (tous projets) */}
        <section className="grid grid-cols-3 gap-2 md:gap-3">
          <div className="bg-white rounded-lg shadow p-3 md:p-4 border-l-4 border-emerald-500">
            <div className="text-[10px] md:text-xs text-slate-500 uppercase font-semibold">Chiffre d'affaires {new Date().getFullYear()}</div>
            <div className="text-lg md:text-2xl font-bold text-emerald-700 mt-1">{annuel ? formatCAD(annuel.ca) : "…"}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-3 md:p-4 border-l-4 border-orange-500">
            <div className="text-[10px] md:text-xs text-slate-500 uppercase font-semibold">Dépenses {new Date().getFullYear()}</div>
            <div className="text-lg md:text-2xl font-bold text-orange-700 mt-1">{annuel ? formatCAD(annuel.depenses) : "…"}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-3 md:p-4 border-l-4 border-blue-500">
            <div className="text-[10px] md:text-xs text-slate-500 uppercase font-semibold">Marge nette {new Date().getFullYear()}</div>
            <div className={`text-lg md:text-2xl font-bold mt-1 ${annuel && (annuel.ca - annuel.depenses - annuel.mo) < 0 ? "text-red-600" : "text-blue-700"}`}>{annuel ? formatCAD(annuel.ca - annuel.depenses - annuel.mo) : "…"}</div>
          </div>
        </section>

        {/* ⚡ ACTIONS RAPIDES */}
        <section className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-lg p-4 md:p-5">
          <h2 className="text-sm font-bold text-emerald-900 uppercase mb-3">⚡ Actions rapides</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3">
            <button onClick={() => setModalHeures(true)} className="bg-white hover:bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">⏱️</div>
              <div className="font-bold text-emerald-900 text-sm md:text-base">Saisir heures</div>
              <div className="text-[10px] md:text-xs text-slate-600">Multi-employés</div>
            </button>
            <button onClick={() => setModalDepense(true)} className="bg-white hover:bg-orange-50 border-2 border-orange-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">💸</div>
              <div className="font-bold text-orange-900 text-sm md:text-base">Ajouter dépense</div>
              <div className="text-[10px] md:text-xs text-slate-600">Reçu / facture</div>
            </button>
            <button onClick={() => setModalPhotos(true)} className="bg-white hover:bg-sky-50 border-2 border-sky-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">📸</div>
              <div className="font-bold text-sky-900 text-sm md:text-base">Photos / Vidéo</div>
              <div className="text-[10px] md:text-xs text-slate-600">Classer dans projet</div>
            </button>
            <a href="/soumissions/nouveau" className="bg-white hover:bg-blue-50 border-2 border-blue-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">📄</div>
              <div className="font-bold text-blue-900 text-sm md:text-base">Soumission</div>
              <div className="text-[10px] md:text-xs text-slate-600">Hover + IA</div>
            </a>
            <a href="/projets" className="bg-white hover:bg-purple-50 border-2 border-purple-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">🏗️</div>
              <div className="font-bold text-purple-900 text-sm md:text-base">Mes projets</div>
              <div className="text-[10px] md:text-xs text-slate-600">{projetsActifs.length} actif(s)</div>
            </a>
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
          <KPI label="Soumissions mois" value={stats.mois_courant ?? "—"} />
          <KPI label="Total mois" value={formatCAD(stats.total_mois_courant || 0)} />
          <KPI label="Pipeline" value={formatCAD(stats.pipeline || 0)} couleur="text-blue-600" />
          <KPI label="Acceptées" value={formatCAD(stats.revenus_acceptes || 0)} couleur="text-emerald-600" />
        </div>

        {/* === MES TÂCHES === */}
        {monUser && mesTaches.length > 0 && (
          <section className="bg-white border-l-4 border-emerald-500 rounded-lg shadow p-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-bold text-slate-900">📌 Mes tâches ({monUser})</h2>
              <span className="text-xs text-slate-500">{mesTaches.length} à faire</span>
            </div>
            <ul className="space-y-1.5">
              {mesTaches.slice(0, 8).map((t) => {
                const auj = new Date().toISOString().slice(0, 10);
                const retard = t.date_echeance && t.date_echeance < auj;
                return (
                  <li key={t.id} className={`flex items-center gap-2 p-2 rounded ${retard ? "bg-red-50 border border-red-200" : "bg-slate-50"}`}>
                    <input type="checkbox" onChange={async () => {
                      await fetch("/api/client-taches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, complete: true }) });
                      setMesTaches((arr) => arr.filter((x) => x.id !== t.id));
                    }} className="w-4 h-4" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{t.titre}</div>
                      {t.client_nom && <a href={`/clients/${t.client_id}`} className="text-[11px] text-blue-600 hover:underline">👤 {t.client_nom}</a>}
                    </div>
                    {t.date_echeance && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${retard ? "bg-red-200 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                        {retard ? "⚠️ retard" : "📅"} {t.date_echeance}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {mesTaches.length > 8 && <p className="text-xs text-slate-500 mt-2">+ {mesTaches.length - 8} autre(s)…</p>}
          </section>
        )}

        {/* === SANTÉ BUSINESS — Tableau de bord enrichi === */}
        {tableauBord && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <a href="/finances" className="bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-200 rounded-lg p-3 hover:shadow-md transition">
              <div className="text-[10px] uppercase font-bold text-emerald-700">💰 Revenu du mois</div>
              <div className="text-xl md:text-2xl font-bold text-emerald-900 mt-1">{formatCAD(tableauBord.revenu_mois)}</div>
            </a>
            <a href="/projets" className="bg-gradient-to-br from-blue-50 to-blue-100 border border-blue-200 rounded-lg p-3 hover:shadow-md transition">
              <div className="text-[10px] uppercase font-bold text-blue-700">📊 Marge moyenne</div>
              <div className="text-xl md:text-2xl font-bold text-blue-900 mt-1">{tableauBord.marge_moyenne_pct?.toFixed(1)} %</div>
              <div className="text-[10px] text-blue-600">{formatCAD(tableauBord.marge_moyenne_montant || 0)}</div>
            </a>
            <a href="/finances" className="bg-gradient-to-br from-red-50 to-red-100 border border-red-200 rounded-lg p-3 hover:shadow-md transition">
              <div className="text-[10px] uppercase font-bold text-red-700">⚠️ Factures impayées</div>
              <div className="text-xl md:text-2xl font-bold text-red-900 mt-1">{formatCAD(tableauBord.factures_impayees_montant)}</div>
              <div className="text-[10px] text-red-600">{tableauBord.factures_impayees_nb} facture(s)</div>
            </a>
            <a href="/finances/paye" className="bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-200 rounded-lg p-3 hover:shadow-md transition">
              <div className="text-[10px] uppercase font-bold text-amber-700">🏦 Banque d'heures</div>
              <div className="text-xl md:text-2xl font-bold text-amber-900 mt-1">{(tableauBord.banque_heures || 0).toFixed(1)} h</div>
              <div className="text-[10px] text-amber-600">à utiliser plus tard</div>
            </a>
            {tableauBord.projets_en_retard > 0 && (
              <a href="/projets?statut=actif" className="col-span-2 md:col-span-2 bg-gradient-to-r from-orange-50 to-red-50 border border-orange-300 rounded-lg p-3 hover:shadow-md transition">
                <div className="text-[10px] uppercase font-bold text-orange-700">🔥 Projets en retard</div>
                <div className="text-xl font-bold text-orange-900 mt-1">{tableauBord.projets_en_retard} chantier(s) à finir</div>
                <div className="text-xs text-orange-700">Date de fin prévue dépassée</div>
              </a>
            )}
            {tableauBord.soumissions_a_relancer > 0 && (
              <a href="/soumissions?statut=envoyee" className="col-span-2 md:col-span-2 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-300 rounded-lg p-3 hover:shadow-md transition">
                <div className="text-[10px] uppercase font-bold text-purple-700">📞 À relancer</div>
                <div className="text-xl font-bold text-purple-900 mt-1">{tableauBord.soumissions_a_relancer} soumission(s) sans réponse</div>
                <div className="text-xs text-purple-700">Envoyées il y a plus de 7 jours</div>
              </a>
            )}
          </section>
        )}

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
      <ModalPhotos ouvert={modalPhotos} onClose={() => setModalPhotos(false)} onSuccess={charger} />
      <FAB onSuccess={charger} />

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

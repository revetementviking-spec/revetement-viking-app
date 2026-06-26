"use client";

import { useEffect, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import ModalHeuresJour from "@/components/ModalHeuresJour";
import ModalDepense from "@/components/ModalDepense";
import ModalPhotos from "@/components/ModalPhotos";
import ModalExtra from "@/components/ModalExtra";
import FAB from "@/components/FAB";
import Meteo from "@/components/Meteo";
import { fetchInstantane } from "@/lib/cacheClient";

/** Lundi de la semaine courante (date locale, format YYYY-MM-DD). Le dashboard
 *  regarde les heures PAR SEMAINE (lundi → aujourd'hui), pas une fenêtre glissante. */
function lundiSemaineISO(): string {
  const d = new Date();
  const jour = d.getDay(); // 0 = dimanche
  d.setDate(d.getDate() + (jour === 0 ? -6 : 1 - jour));
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), j = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${j}`;
}

const STATUT_LABELS: Record<string, { label: string; couleur: string }> = {
  brouillon: { label: "Brouillon", couleur: "bg-slate-200 text-slate-800" },
  envoyee: { label: "Envoyée", couleur: "bg-blue-200 text-blue-900" },
  acceptee: { label: "Acceptée", couleur: "bg-emerald-200 text-emerald-900" },
  refusee: { label: "Refusée", couleur: "bg-red-200 text-red-900" },
  facturee: { label: "Facturée", couleur: "bg-purple-200 text-purple-900" },
};

function Salutation({ nom }: { nom?: string }) {
  const h = new Date().getHours();
  const salut = h < 5 ? "🌙 Bonne nuit" : h < 12 ? "☀️ Bonjour" : h < 17 ? "👋 Bon après-midi" : h < 21 ? "🌆 Bonsoir" : "🌙 Bonne soirée";
  const date = new Date().toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="flex items-baseline justify-between gap-3 flex-wrap">
      <h1 className="text-2xl md:text-3xl font-bold text-slate-900">{salut}{nom ? `, ${nom}` : ""}</h1>
      <p className="text-sm text-slate-500 capitalize">{date}</p>
    </div>
  );
}

export default function Home() {
  const [stats, setStats] = useState<any>({});
  const [projetsActifs, setProjetsActifs] = useState<any[]>([]);
  const [heuresSemaine, setHeuresSemaine] = useState<any[]>([]);
  const [relances, setRelances] = useState<any[]>([]);
  const [annuel, setAnnuel] = useState<{ ca: number; ca_at?: number; depenses: number; dep_at?: number; mo: number } | null>(null);
  const [tableauBord, setTableauBord] = useState<any>(null);
  const [mesTaches, setMesTaches] = useState<any[]>([]);
  const [tachesAFaire, setTachesAFaire] = useState<any[]>([]);
  const [monUser, setMonUser] = useState<string>("");
  const [modalHeures, setModalHeures] = useState(false);
  const [modalDepense, setModalDepense] = useState(false);
  const [modalPhotos, setModalPhotos] = useState(false);
  const [modalExtra, setModalExtra] = useState(false);
  const [extras, setExtras] = useState<any[]>([]);
  const [aFacturer, setAFacturer] = useState<any[]>([]);
  const [detailFin, setDetailFin] = useState<null | "ca" | "depenses" | "marge">(null);
  const [moDetail, setMoDetail] = useState<{ employe: string; total_heures: number; cout_total: number; n_jours: number }[] | null>(null);
  const [moBusy, setMoBusy] = useState(false);
  const [caDetail, setCaDetail] = useState<{ nom: string; date: string; revenu_at: number }[] | null>(null);
  const [caBusy, setCaBusy] = useState(false);
  const { toast } = useToast();

  const fermerDetail = () => { setDetailFin(null); setMoDetail(null); setCaDetail(null); };
  const chargerMO = async () => {
    if (moDetail) { setMoDetail(null); return; } // re-clic = replier
    setMoBusy(true);
    try {
      const an = new Date().getFullYear();
      const d = await fetch(`/api/heures-sommaire?depuis=${an}-01-01`).then((r) => r.json());
      setMoDetail(Array.isArray(d) ? d : []);
    } catch { setMoDetail([]); } finally { setMoBusy(false); }
  };
  const chargerCA = async () => {
    if (caDetail) { setCaDetail(null); return; }
    setCaBusy(true);
    try {
      const an = new Date().getFullYear();
      const tous = await fetch("/api/projets?statut=complete").then((r) => r.json());
      const liste = (Array.isArray(tous) ? tous : [])
        .map((p: any) => {
          const dc = p.date_fin_reelle || p.date_fin_prevue || p.date_debut || p.date_creation || "";
          const valeur = (p.prix_contrat || p.budget_estime || 0);
          return { nom: p.nom || "Projet", date: String(dc).slice(0, 10), revenu_at: valeur / 1.14975, an: String(dc).slice(0, 4) };
        })
        .filter((p: any) => p.an === String(an) && p.revenu_at > 0)
        .sort((a: any, b: any) => b.date.localeCompare(a.date));
      setCaDetail(liste);
    } catch { setCaDetail([]); } finally { setCaBusy(false); }
  };

  const charger = async () => {
    // Affichage INSTANTANÉ : chaque section montre ses dernières données connues
    // (cache local) tout de suite, puis se rafraîchit en arrière-plan. Plus de
    // spinner d'attente sur cold start / réseau lent.
    fetchInstantane("/api/soumissions?stats=1", setStats, { cle: "dash:stats" });
    fetchInstantane("/api/projets?statut=actif", (d: any) => setProjetsActifs(Array.isArray(d) ? d : []), { cle: "dash:projetsActifs" });
    fetchInstantane(`/api/heures-sommaire?depuis=${lundiSemaineISO()}`, (d: any) => setHeuresSemaine(Array.isArray(d) ? d : []), { cle: "dash:heuresSemaine" });
    fetchInstantane("/api/relances", (d: any) => setRelances(Array.isArray(d) ? d : []), { cle: "dash:relances" });
    fetchInstantane("/api/dashboard", setTableauBord, { cle: "dash:tableauBord" });
    fetchInstantane("/api/extras?statut=a_charger", (d: any) => setExtras(Array.isArray(d) ? d : []), { cle: "dash:extras" });
    fetchInstantane("/api/projets?a_facturer=1", (d: any) => setAFacturer(Array.isArray(d) ? d : []), { cle: "dash:aFacturer" });
    fetchInstantane("/api/taches?statut=a_faire", (d: any) => setTachesAFaire(Array.isArray(d) ? d : []), { cle: "dash:tachesAFaire" });
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      const u = d?.user || "";
      setMonUser(u);
      if (u) fetchInstantane(`/api/mes-taches?user=${u}`, (arr: any) => setMesTaches(Array.isArray(arr) ? arr : []), { cle: `dash:taches:${u}` });
    }).catch(() => {});
    // Totaux de l'année : chiffre d'affaires + dépenses (tous projets, pas juste actifs)
    fetchInstantane(`/api/finances?annee=${new Date().getFullYear()}`, setAnnuel, {
      cle: "dash:annuel",
      transform: (d: any) => (d.mois || []).reduce((s: any, m: any) => ({
        ca: s.ca + (m.revenu || 0), ca_at: s.ca_at + (m.revenu_avant_taxes || 0),
        depenses: s.depenses + (m.depenses || 0), dep_at: s.dep_at + (m.depenses_avant_taxes || 0),
        mo: s.mo + (m.mo || 0),
      }), { ca: 0, ca_at: 0, depenses: 0, dep_at: 0, mo: 0 }),
    });
  };


  useEffect(() => { charger(); }, []);

  // On NE bloque plus le rendu — chaque section affiche son propre skeleton si data pas prête.
  // First Paint sub-100ms même sur 4G lent.

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="Revêtement Viking" soustitre="Tableau de bord · RBQ 5811-4299-01" />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4 md:space-y-6">

        {/* 👋 SALUTATION DU JOUR */}
        <Salutation nom={monUser} />

        {/* 🌤️ MÉTÉO 7 JOURS */}
        <Meteo />

        {/* 📊 TOTAUX DE L'ANNÉE (tous projets) */}
        <section className="grid grid-cols-3 gap-2 md:gap-3">
          <button onClick={() => annuel && setDetailFin("ca")} className="bg-white rounded-lg shadow p-3 md:p-4 border-l-4 border-emerald-500 text-left hover:shadow-md transition relative">
            <div className="text-[10px] md:text-xs text-slate-500 uppercase font-semibold">Chiffre d'affaires {new Date().getFullYear()} <span className="normal-case text-slate-400">(av. taxes)</span></div>
            <div className="text-lg md:text-2xl font-bold text-emerald-700 mt-1">{annuel ? formatCAD(annuel.ca_at ?? annuel.ca) : "…"}</div>
            <span className="absolute top-1.5 right-2 text-slate-300 text-xs">ⓘ</span>
          </button>
          <button onClick={() => annuel && setDetailFin("depenses")} className="bg-white rounded-lg shadow p-3 md:p-4 border-l-4 border-orange-500 text-left hover:shadow-md transition relative">
            <div className="text-[10px] md:text-xs text-slate-500 uppercase font-semibold">Dépenses {new Date().getFullYear()} <span className="normal-case text-slate-400">(av. taxes, incl. M.O.)</span></div>
            <div className="text-lg md:text-2xl font-bold text-orange-700 mt-1">{annuel ? formatCAD((annuel.dep_at ?? annuel.depenses) + annuel.mo) : "…"}</div>
            <span className="absolute top-1.5 right-2 text-slate-300 text-xs">ⓘ</span>
          </button>
          <button onClick={() => annuel && setDetailFin("marge")} className="bg-white rounded-lg shadow p-3 md:p-4 border-l-4 border-blue-500 text-left hover:shadow-md transition relative">
            <div className="text-[10px] md:text-xs text-slate-500 uppercase font-semibold">Marge nette {new Date().getFullYear()} <span className="normal-case text-slate-400">(av. taxes)</span></div>
            <div className={`text-lg md:text-2xl font-bold mt-1 ${annuel && ((annuel.ca_at ?? annuel.ca) - (annuel.dep_at ?? annuel.depenses) - annuel.mo) < 0 ? "text-red-600" : "text-blue-700"}`}>{annuel ? formatCAD((annuel.ca_at ?? annuel.ca) - (annuel.dep_at ?? annuel.depenses) - annuel.mo) : "…"}</div>
            <span className="absolute top-1.5 right-2 text-slate-300 text-xs">ⓘ</span>
          </button>
        </section>

        {/* 🧾 PROJETS À FACTURER — rappel persistant (projets complétés non facturés) */}
        {aFacturer.length > 0 && (
          <section className="bg-purple-50 border-2 border-purple-400 rounded-lg p-4 md:p-5">
            <h2 className="font-bold text-purple-900 mb-2">🧾 Projets à facturer ({aFacturer.length})</h2>
            <p className="text-xs text-purple-800 mb-3">Projets marqués <strong>complétés</strong> mais pas encore facturés. Marque « facturé » une fois la facture faite (ex. QuickBooks).</p>
            <div className="space-y-1.5">
              {aFacturer.slice(0, 6).map((p) => {
                const valeur = p.prix_contrat || p.budget_estime || 0;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-2 bg-white rounded px-3 py-2 border border-purple-200">
                    <a href={`/projets/${p.id}`} className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900 truncate">{p.nom}</div>
                      <div className="text-[11px] text-slate-500 truncate">{p.client_nom || "—"}{p.date_fin_reelle ? ` · complété ${p.date_fin_reelle}` : ""}{valeur ? ` · ${formatCAD(valeur)}` : ""}</div>
                    </a>
                    <button
                      onClick={async () => {
                        await fetch("/api/projets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, facturee: 1 }) });
                        toast("✓ Projet marqué facturé", "success");
                        setAFacturer((arr) => arr.filter((x) => x.id !== p.id));
                      }}
                      className="flex-shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold whitespace-nowrap"
                    >✓ Facturé</button>
                  </div>
                );
              })}
            </div>
            {aFacturer.length > 6 && <p className="text-xs text-purple-700 mt-2">+ {aFacturer.length - 6} autre(s)…</p>}
          </section>
        )}

        {/* 💲 EXTRAS À FACTURER — alerte persistante */}
        {extras.length > 0 && (
          <section className="bg-amber-50 border-2 border-amber-400 rounded-lg p-4 md:p-5">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-bold text-amber-900">💲 Extras à facturer ({extras.length}{extras.reduce((s, e) => s + (e.montant || 0), 0) > 0 ? ` · ${formatCAD(extras.reduce((s, e) => s + (e.montant || 0), 0))}` : ""})</h2>
              <a href="/extras" className="text-xs text-amber-800 hover:underline font-semibold">Voir tous →</a>
            </div>
            <p className="text-xs text-amber-800 mb-3">Travaux / matériaux supplémentaires à charger au client (ex. dans QuickBooks). Marque « facturé » une fois fait.</p>
            <div className="space-y-1.5">
              {extras.slice(0, 5).map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 bg-white rounded px-3 py-2 border border-amber-200">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {e.nature === "heures" ? "⏱️" : e.nature === "materiaux" ? "📦" : "💰"} {e.description}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {e.projet_nom || "Sans projet"} · {e.date}{e.saisi_par ? ` · ${e.saisi_par}` : ""}
                      {e.montant ? ` · ${formatCAD(e.montant)}` : e.heures ? ` · ${e.heures} h` : ""}
                      {e.a_photo ? " · 📎" : ""}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      await fetch("/api/extras", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, statut: "charge" }) });
                      toast("✓ Extra marqué facturé", "success");
                      setExtras((arr) => arr.filter((x) => x.id !== e.id));
                    }}
                    className="flex-shrink-0 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold whitespace-nowrap"
                  >
                    ✓ Facturé
                  </button>
                </div>
              ))}
            </div>
            {extras.length > 5 && <p className="text-xs text-amber-700 mt-2">+ {extras.length - 5} autre(s) — <a href="/extras" className="underline">voir tous</a></p>}
          </section>
        )}

        {/* ⚡ ACTIONS RAPIDES */}
        <section className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-300 rounded-lg p-4 md:p-5">
          <h2 className="text-sm font-bold text-emerald-900 uppercase mb-3">⚡ Actions rapides</h2>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 md:gap-3">
            <button onClick={() => setModalHeures(true)} className="bg-white hover:bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">⏱️</div>
              <div className="font-bold text-emerald-900 text-sm md:text-base">Saisir heures</div>
              <div className="text-[10px] md:text-xs text-slate-600">Multi-employés</div>
            </button>
            <button onClick={() => setModalExtra(true)} className="bg-white hover:bg-amber-50 border-2 border-amber-300 rounded-lg p-3 md:p-4 text-left transition shadow-sm hover:shadow">
              <div className="text-2xl md:text-3xl mb-1">💲</div>
              <div className="font-bold text-amber-900 text-sm md:text-base">Extra à facturer</div>
              <div className="text-[10px] md:text-xs text-slate-600">Travaux / matériaux</div>
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
              <h2 className="font-semibold text-slate-900">👷 Heures par employé · cette semaine</h2>
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

        {/* === TÂCHES À FAIRE (module Tâches) === */}
        {tachesAFaire.length > 0 && (
          <section className="bg-white border-l-4 border-emerald-500 rounded-lg shadow p-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-bold text-slate-900"><a href="/taches" className="hover:underline">✅ Tâches à faire</a></h2>
              <a href="/taches" className="text-xs text-emerald-700 font-semibold hover:underline">{tachesAFaire.length} · voir tout →</a>
            </div>
            <ul className="space-y-1.5">
              {tachesAFaire.slice(0, 8).map((t) => {
                const auj = new Date().toISOString().slice(0, 10);
                const retard = t.date_due && t.date_due < auj;
                return (
                  <li key={t.id} className={`flex items-center gap-2 p-2 rounded ${retard ? "bg-red-50 border border-red-200" : "bg-slate-50"}`}>
                    <input type="checkbox" onChange={async () => {
                      await fetch("/api/taches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, statut: "complete" }) });
                      setTachesAFaire((arr) => arr.filter((x) => x.id !== t.id));
                    }} className="w-4 h-4" title="Marquer faite" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{t.titre}{t.recurrence ? " 🔁" : ""}</div>
                      <div className="flex gap-2 text-[11px]">
                        {t.assigne_a && <span className={t.assigne_a === "Francis" ? "text-blue-600" : "text-purple-600"}>👤 {t.assigne_a}</span>}
                        {t.projet_nom && <a href={`/projets/${t.projet_id}`} className="text-slate-500 hover:underline truncate">🏗️ {t.projet_nom}</a>}
                      </div>
                    </div>
                    {t.date_due && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold whitespace-nowrap ${retard ? "bg-red-200 text-red-800" : "bg-amber-100 text-amber-800"}`}>
                        {retard ? "⚠️ retard" : "📅"} {t.date_due}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {tachesAFaire.length > 8 && <p className="text-xs text-slate-500 mt-2">+ {tachesAFaire.length - 8} autre(s)…</p>}
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

      {/* Détail du calcul d'un chiffre (CA / Dépenses / Marge) */}
      {detailFin && annuel && (() => {
        const an = new Date().getFullYear();
        const caAt = annuel.ca_at ?? annuel.ca, caTi = annuel.ca;
        const depAt = annuel.dep_at ?? annuel.depenses, depTi = annuel.depenses;
        const mo = annuel.mo;
        const marge = caAt - depAt - mo;
        const titre = detailFin === "ca" ? `💰 Chiffre d'affaires ${an}` : detailFin === "depenses" ? `💸 Dépenses ${an}` : `📊 Marge nette ${an}`;
        return (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={fermerDetail}>
            <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-2.5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-start mb-1">
                <h3 className="text-lg font-bold">{titre}</h3>
                <button onClick={fermerDetail} className="text-2xl text-slate-400 hover:text-slate-700 leading-none">×</button>
              </div>
              {detailFin === "ca" && (<>
                <p className="text-xs text-slate-500">Valeur des projets marqués <strong>complétés</strong> en {an}. Les projets en cours ne comptent pas encore.</p>
                <Lc label="Valeur des projets complétés (taxes incl.)" value={formatCAD(caTi)} />
                <Lc label="− Taxes retirées (TPS 5 % + TVQ 9,975 %)" value={"− " + formatCAD(caTi - caAt)} couleur="text-slate-500" />
                <div className="border-t pt-2" />
                <Lc label="= Chiffre d'affaires (avant taxes)" value={formatCAD(caAt)} gras couleur="text-emerald-700" />
                <button onClick={chargerCA} className="w-full text-left text-[11px] text-emerald-700 hover:underline pl-1 font-semibold">
                  {caBusy ? "⏳ chargement…" : caDetail ? "▾ masquer les projets" : "🏗️ voir les projets qui composent le CA →"}
                </button>
                {caDetail && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded p-2 space-y-1">
                    {caDetail.length === 0 ? (
                      <div className="text-[11px] text-slate-500 italic">Aucun projet complété cette année.</div>
                    ) : (<>
                      {caDetail.map((p, i) => (
                        <div key={i} className="flex justify-between items-baseline text-[11px]">
                          <span className="text-slate-700 font-medium truncate mr-2">{p.nom}</span>
                          <span className="text-slate-600 whitespace-nowrap">{p.date} · <strong className="text-emerald-800">{formatCAD(p.revenu_at)}</strong></span>
                        </div>
                      ))}
                      <div className="flex justify-between text-[11px] font-bold border-t border-emerald-200 pt-1"><span>Total ({caDetail.length} projet{caDetail.length > 1 ? "s" : ""})</span><span className="text-emerald-800">{formatCAD(caDetail.reduce((s, p) => s + p.revenu_at, 0))}</span></div>
                      <div className="text-[10px] text-slate-400">Valeurs avant taxes. Le CA = valeur du contrat à la complétion du projet.</div>
                    </>)}
                  </div>
                )}
              </>)}
              {detailFin === "depenses" && (<>
                <p className="text-xs text-slate-500">Tous les coûts de {an} : dépenses (matériaux, fournisseurs) avant taxes + main-d'œuvre.</p>
                <Lc label="Dépenses (taxes incl.)" value={formatCAD(depTi)} />
                <Lc label="− Taxes (récupérables, CTI/RTI)" value={"− " + formatCAD(depTi - depAt)} couleur="text-slate-500" />
                <Lc label="= Dépenses (avant taxes)" value={formatCAD(depAt)} />
                <Lc label="+ Main-d'œuvre (salaires : heures × taux)" value={"+ " + formatCAD(mo)} couleur="text-amber-700" />
                <div className="border-t pt-2" />
                <Lc label="= Total dépenses (incl. M.O.)" value={formatCAD(depAt + mo)} gras couleur="text-orange-700" />
              </>)}
              {detailFin === "marge" && (<>
                <p className="text-xs text-slate-500">Profit réel = revenu avant taxes − toutes les dépenses (la main-d'œuvre est maintenant incluse dedans).</p>
                <Lc label="Chiffre d'affaires (avant taxes)" value={"+ " + formatCAD(caAt)} couleur="text-emerald-700" />
                <Lc label="− Dépenses (av. taxes, incl. M.O.)" value={"− " + formatCAD(depAt + mo)} couleur="text-orange-700" />
                <div className="text-[10px] text-slate-400 pl-1">dont matériaux/fournisseurs {formatCAD(depAt)} + main-d'œuvre {formatCAD(mo)}</div>
                <button onClick={chargerMO} className="w-full text-left text-[11px] text-amber-700 hover:underline pl-1 font-semibold">
                  {moBusy ? "⏳ chargement…" : moDetail ? "▾ masquer le détail main-d'œuvre" : "👷 voir la main-d'œuvre par employé →"}
                </button>
                {moDetail && (
                  <div className="bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
                    {moDetail.length === 0 ? (
                      <div className="text-[11px] text-slate-500 italic">Aucune heure saisie cette année.</div>
                    ) : (<>
                      {moDetail.map((e, i) => (
                        <div key={i} className="flex justify-between items-baseline text-[11px]">
                          <span className="text-slate-700 font-medium truncate mr-2">{e.employe}</span>
                          <span className="text-slate-600 whitespace-nowrap">{(e.total_heures || 0).toFixed(1)} h · <strong className="text-amber-800">{formatCAD(e.cout_total || 0)}</strong></span>
                        </div>
                      ))}
                      {(() => { const somme = moDetail.reduce((s, e) => s + (e.cout_total || 0), 0); const autres = mo - somme; return autres > 1 ? (
                        <div className="flex justify-between text-[10px] text-slate-400"><span>Autres (heures sans employé)</span><span>{formatCAD(autres)}</span></div>
                      ) : null; })()}
                      <div className="flex justify-between text-[11px] font-bold border-t border-amber-200 pt-1"><span>Total main-d'œuvre</span><span className="text-amber-800">{formatCAD(mo)}</span></div>
                    </>)}
                  </div>
                )}
                <div className="border-t pt-2" />
                <Lc label="= Marge nette (avant taxes)" value={formatCAD(marge)} gras couleur={marge >= 0 ? "text-blue-700" : "text-red-600"} />
                <p className="text-[11px] text-slate-600 bg-emerald-50 border border-emerald-200 rounded p-2 mt-1">✅ Maintenant le calcul est simple : <strong>CA − Dépenses = Marge nette</strong> (la M.O. est dans les dépenses).</p>
              </>)}
            </div>
          </div>
        );
      })()}

      <ModalHeuresJour ouvert={modalHeures} onClose={() => setModalHeures(false)} onSuccess={charger} onExtra={() => { setModalHeures(false); setModalExtra(true); }} />
      <ModalDepense ouvert={modalDepense} onClose={() => setModalDepense(false)} onSuccess={charger} />
      <ModalPhotos ouvert={modalPhotos} onClose={() => setModalPhotos(false)} onSuccess={charger} />
      <ModalExtra ouvert={modalExtra} onClose={() => setModalExtra(false)} onSuccess={charger} />
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

// Ligne d'un calcul détaillé (label à gauche, montant à droite).
function Lc({ label, value, gras, couleur }: { label: string; value: string; gras?: boolean; couleur?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className={`text-sm ${gras ? "font-bold text-slate-900" : "text-slate-600"}`}>{label}</span>
      <span className={`whitespace-nowrap ${gras ? "text-base font-bold" : "text-sm"} ${couleur || "text-slate-900"}`}>{value}</span>
    </div>
  );
}

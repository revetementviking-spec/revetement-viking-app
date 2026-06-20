"use client";

import { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";

/** Échéancier des projets — vues Semaine / Mois / Année.
 *  Un projet est « actif » de date_debut à sa fin (date_fin_prevue, sinon
 *  date_debut + duree_jours, sinon +30 j). */

const MOIS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const MOIS_LONG = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

const COULEURS: Record<string, string> = {
  actif: "bg-emerald-500",
  a_venir: "bg-amber-500",
  complete: "bg-blue-500",
  annule: "bg-red-500",
};

// === Helpers dates (heure locale, sans dérive de fuseau) ===
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ajouterJoursStr(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + Math.round(n));
  return ymd(dt);
}
// Fin des travaux (yyyy-mm-dd) : fin prévue, sinon début + durée, sinon +30 j.
function finStr(p: any): string | null {
  if (p.date_fin_prevue) return String(p.date_fin_prevue).slice(0, 10);
  if (!p.date_debut) return null;
  const jours = p.duree_jours && p.duree_jours > 0 ? p.duree_jours : 30;
  return ajouterJoursStr(String(p.date_debut).slice(0, 10), jours);
}
function debutStr(p: any): string | null {
  return p.date_debut ? String(p.date_debut).slice(0, 10) : null;
}
// Lundi de la semaine contenant d.
function lundiDe(d: Date): Date {
  const offset = (d.getDay() + 6) % 7; // 0 = lundi
  const l = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
  return l;
}

type Vue = "semaine" | "mois" | "annee";

export default function CalendrierProjets() {
  const [projets, setProjets] = useState<any[]>([]);
  const [vue, setVue] = useState<Vue>("mois");
  const [curseur, setCurseur] = useState<Date>(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); });

  useEffect(() => {
    fetch("/api/projets").then((r) => r.json()).then((d) => setProjets(Array.isArray(d) ? d : []));
  }, []);

  const aujourdhui = ymd(new Date());

  // Projets actifs un jour donné (yyyy-mm-dd).
  const projetsActifsLe = (jour: string) => projets.filter((p) => {
    const deb = debutStr(p), fin = finStr(p);
    return deb && fin && deb <= jour && jour <= fin;
  });

  // Navigation ←/→ selon la vue.
  const deplacer = (sens: number) => {
    const c = new Date(curseur);
    if (vue === "semaine") c.setDate(c.getDate() + 7 * sens);
    else if (vue === "mois") c.setMonth(c.getMonth() + sens);
    else c.setFullYear(c.getFullYear() + sens);
    setCurseur(c);
  };
  const aujourdhuiReset = () => { const n = new Date(); setCurseur(new Date(n.getFullYear(), n.getMonth(), n.getDate())); };

  // Libellé de la période courante.
  const titrePeriode = useMemo(() => {
    if (vue === "semaine") {
      const l = lundiDe(curseur);
      const d = new Date(l); d.setDate(l.getDate() + 6);
      return `Semaine du ${l.getDate()} ${MOIS[l.getMonth()]} au ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
    }
    if (vue === "mois") return `${MOIS_LONG[curseur.getMonth()]} ${curseur.getFullYear()}`;
    return `${curseur.getFullYear()}`;
  }, [vue, curseur]);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📅 Échéancier des projets" soustitre={titrePeriode} />
      <main className="max-w-7xl mx-auto p-3 md:p-4 space-y-3">

        {/* Barre de contrôle : vue + navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-white rounded-lg shadow p-1">
            {(["semaine", "mois", "annee"] as Vue[]).map((v) => (
              <button key={v} onClick={() => setVue(v)}
                className={`px-3 py-1.5 rounded text-sm font-semibold capitalize ${vue === v ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                {v === "annee" ? "Année" : v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={() => deplacer(-1)} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded font-bold" aria-label="Précédent">←</button>
            <button onClick={aujourdhuiReset} className="px-3 py-1.5 bg-emerald-100 text-emerald-900 hover:bg-emerald-200 rounded font-semibold text-sm">Aujourd'hui</button>
            <button onClick={() => deplacer(1)} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded font-bold" aria-label="Suivant">→</button>
          </div>
          <div className="flex gap-2 text-xs w-full md:w-auto">
            <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded">🟢 Actif</span>
            <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded">🟡 À venir</span>
            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">🔵 Complété</span>
          </div>
        </div>

        {vue === "semaine" && <VueSemaine curseur={curseur} projetsActifsLe={projetsActifsLe} aujourdhui={aujourdhui} />}
        {vue === "mois" && <VueMois curseur={curseur} projetsActifsLe={projetsActifsLe} aujourdhui={aujourdhui} />}
        {vue === "annee" && <VueAnnee annee={curseur.getFullYear()} projets={projets} />}

        <p className="text-xs text-slate-500">Cliquer un projet pour ouvrir son détail.</p>
      </main>
    </div>
  );
}

// Pastille projet réutilisée dans les vues semaine/mois.
function Puce({ p }: { p: any }) {
  return (
    <a href={`/projets/${p.id}`} title={`${p.nom} — ${debutStr(p)} → ${finStr(p) || "?"}${p.duree_jours ? ` (${p.duree_jours} j)` : ""}`}
      className={`block truncate text-[11px] text-white px-1.5 py-0.5 rounded ${COULEURS[p.statut] || "bg-slate-500"} hover:opacity-90`}>
      {p.nom}
    </a>
  );
}

// === VUE SEMAINE : 7 colonnes jour ===
function VueSemaine({ curseur, projetsActifsLe, aujourdhui }: { curseur: Date; projetsActifsLe: (j: string) => any[]; aujourdhui: string }) {
  const lundi = lundiDe(curseur);
  const jours = Array.from({ length: 7 }, (_, i) => { const d = new Date(lundi); d.setDate(lundi.getDate() + i); return d; });
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {jours.map((d, i) => {
        const js = ymd(d);
        const actifs = projetsActifsLe(js);
        const estAuj = js === aujourdhui;
        return (
          <div key={i} className={`bg-white rounded-lg shadow p-2 min-h-[120px] ${estAuj ? "ring-2 ring-emerald-500" : ""}`}>
            <div className={`text-xs font-bold mb-1 ${estAuj ? "text-emerald-700" : "text-slate-600"}`}>
              {JOURS[i]} {d.getDate()} {MOIS[d.getMonth()]}
            </div>
            <div className="space-y-1">
              {actifs.length === 0 ? <div className="text-[10px] text-slate-300 italic">—</div> : actifs.map((p) => <Puce key={p.id} p={p} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// === VUE MOIS : grille calendrier classique ===
function VueMois({ curseur, projetsActifsLe, aujourdhui }: { curseur: Date; projetsActifsLe: (j: string) => any[]; aujourdhui: string }) {
  const annee = curseur.getFullYear(), mois = curseur.getMonth();
  const premier = new Date(annee, mois, 1);
  const offset = (premier.getDay() + 6) % 7; // jours avant le 1er (lundi=0)
  const gridStart = new Date(annee, mois, 1 - offset);
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="grid grid-cols-7 border-b bg-slate-50 text-xs font-bold text-slate-600">
        {JOURS.map((j) => <div key={j} className="p-2 text-center border-r last:border-r-0">{j}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const js = ymd(d);
          const horsMois = d.getMonth() !== mois;
          const estAuj = js === aujourdhui;
          const actifs = projetsActifsLe(js);
          return (
            <div key={i} className={`border-r border-b last:border-r-0 p-1 min-h-[84px] md:min-h-[100px] align-top ${horsMois ? "bg-slate-50" : ""}`}>
              <div className={`text-[11px] font-bold mb-1 ${estAuj ? "bg-emerald-600 text-white rounded-full w-5 h-5 flex items-center justify-center" : horsMois ? "text-slate-300" : "text-slate-600"}`}>
                {d.getDate()}
              </div>
              <div className="space-y-0.5">
                {actifs.slice(0, 3).map((p) => <Puce key={p.id} p={p} />)}
                {actifs.length > 3 && <div className="text-[10px] text-slate-500 font-semibold pl-1">+ {actifs.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// === VUE ANNÉE : Gantt léger (une ligne par projet) ===
function VueAnnee({ annee, projets }: { annee: number; projets: any[] }) {
  const finMs = (p: any): number => {
    if (p.date_fin_prevue) return new Date(p.date_fin_prevue).getTime();
    if (!p.date_debut) return 0;
    const base = new Date(p.date_debut).getTime();
    const jours = p.duree_jours && p.duree_jours > 0 ? p.duree_jours : 30;
    return base + jours * 86400000;
  };
  const projetsAnnee = useMemo(() => {
    const dAn = new Date(annee, 0, 1).getTime();
    const fAn = new Date(annee, 11, 31).getTime();
    return projets.filter((p) => {
      const d1 = p.date_debut ? new Date(p.date_debut).getTime() : 0;
      const d2 = finMs(p);
      if (!d1) return false;
      return d2 >= dAn && d1 <= fAn;
    }).sort((a, b) => (a.date_debut || "").localeCompare(b.date_debut || ""));
  }, [projets, annee]);

  const positionBarre = (p: any) => {
    const dAn = new Date(annee, 0, 1).getTime();
    const fAn = new Date(annee, 11, 31, 23, 59).getTime();
    const totalAn = fAn - dAn;
    const d1 = Math.max(dAn, new Date(p.date_debut).getTime());
    const d2 = Math.min(fAn, finMs(p));
    const left = ((d1 - dAn) / totalAn) * 100;
    const width = Math.max(1, ((d2 - d1) / totalAn) * 100);
    return { left: `${left}%`, width: `${width}%` };
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="grid grid-cols-12 border-b bg-slate-50 text-xs font-bold text-slate-600">
        {MOIS.map((m, i) => <div key={i} className="p-2 text-center border-r last:border-r-0">{m}</div>)}
      </div>
      {projetsAnnee.length === 0 ? (
        <div className="p-12 text-center text-slate-400">Aucun projet en {annee} avec des dates renseignées.</div>
      ) : (
        <div className="divide-y">
          {projetsAnnee.map((p) => (
            <a key={p.id} href={`/projets/${p.id}`} className="grid grid-cols-12 relative hover:bg-emerald-50 transition" style={{ minHeight: 44 }}>
              {MOIS.map((_, i) => <div key={i} className="border-r last:border-r-0" />)}
              <div className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-800 pointer-events-none z-10 bg-white/80 px-2 py-0.5 rounded truncate max-w-[40%]">
                {p.nom}
              </div>
              <div
                className={`absolute top-1/2 -translate-y-1/2 h-5 rounded ${COULEURS[p.statut] || "bg-slate-500"} shadow opacity-80 hover:opacity-100`}
                style={positionBarre(p)}
                title={`${p.nom} — ${p.date_debut} → ${p.date_fin_prevue || "?"}${p.duree_jours ? ` (${p.duree_jours} j prévus)` : ""}`}
              />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

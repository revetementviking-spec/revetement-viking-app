"use client";

import { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";

/** Vue Gantt léger des projets : chaque ligne = un projet,
 *  barre de couleur de date_debut → date_fin_prevue. */

const MOIS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];

const COULEURS: Record<string, string> = {
  actif: "bg-emerald-500",
  a_venir: "bg-amber-500",
  complete: "bg-blue-500",
  annule: "bg-red-500",
};

export default function CalendrierProjets() {
  const [projets, setProjets] = useState<any[]>([]);
  const [annee, setAnnee] = useState(new Date().getFullYear());

  useEffect(() => {
    fetch("/api/projets").then((r) => r.json()).then((d) => setProjets(Array.isArray(d) ? d : []));
  }, []);

  // Fin des travaux : date de fin prévue si saisie, sinon début + durée prévue, sinon +30 j.
  const finMs = (p: any): number => {
    if (p.date_fin_prevue) return new Date(p.date_fin_prevue).getTime();
    if (!p.date_debut) return 0;
    const base = new Date(p.date_debut).getTime();
    const jours = p.duree_jours && p.duree_jours > 0 ? p.duree_jours : 30;
    return base + jours * 86400000;
  };

  // Filtre projets qui touchent l'année courante
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
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📅 Calendrier des projets" soustitre={`${projetsAnnee.length} projet(s) en ${annee}`} />
      <main className="max-w-7xl mx-auto p-3 md:p-4 space-y-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setAnnee(annee - 1)} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded font-bold">← {annee - 1}</button>
          <span className="px-4 py-1.5 bg-emerald-100 text-emerald-900 rounded font-bold">{annee}</span>
          <button onClick={() => setAnnee(annee + 1)} className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded font-bold">{annee + 1} →</button>
          <div className="ml-auto flex gap-2 text-xs">
            <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded">🟢 Actif</span>
            <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded">🟡 À venir</span>
            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">🔵 Complété</span>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden">
          {/* En-tête des mois */}
          <div className="grid grid-cols-12 border-b bg-slate-50 text-xs font-bold text-slate-600">
            {MOIS.map((m, i) => <div key={i} className="p-2 text-center border-r last:border-r-0">{m}</div>)}
          </div>

          {projetsAnnee.length === 0 ? (
            <div className="p-12 text-center text-slate-400">Aucun projet en {annee} avec des dates de début/fin renseignées.</div>
          ) : (
            <div className="divide-y">
              {projetsAnnee.map((p) => (
                <a key={p.id} href={`/projets/${p.id}`} className="grid grid-cols-12 relative hover:bg-emerald-50 transition" style={{ minHeight: 44 }}>
                  {/* Fond colonnes mois */}
                  {MOIS.map((_, i) => <div key={i} className="border-r last:border-r-0" />)}
                  {/* Étiquette projet à gauche */}
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-800 pointer-events-none z-10 bg-white/80 px-2 py-0.5 rounded truncate max-w-[40%]">
                    {p.nom}
                  </div>
                  {/* Barre Gantt */}
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

        <p className="text-xs text-slate-500">Cliquer un projet pour ouvrir le détail.</p>
      </main>
    </div>
  );
}

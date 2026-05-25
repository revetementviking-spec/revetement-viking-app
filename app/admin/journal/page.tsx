"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { exporterCSV } from "@/lib/csv";

const ICONES: Record<string, string> = {
  "soumission.creee": "📄", "soumission.modifiee": "✏️", "soumission.statut_change": "🔄",
  "soumission.envoyee": "📧", "soumission.acceptee": "✅", "soumission.refusee": "❌",
  "soumission.facturee": "💰", "soumission.supprimee": "🗑️",
  "client.cree": "👤", "client.modifie": "✏️", "client.supprime": "🗑️",
  "projet.cree": "🏗️", "projet.statut_change": "🔄", "projet.supprime": "🗑️",
  "contrat.cree": "📝", "contrat.signe": "🖋️",
  "heures.ajoutees": "⏱️", "depense.ajoutee": "💸", "paye.marquee_payee": "💵",
  "backup.execute": "💾", "drive.connecte": "🔗", "drive.deconnecte": "🔌",
  "auth.login_ok": "🔓", "auth.login_echec": "🚫",
};

export default function PageJournal() {
  const [activites, setActivites] = useState<any[]>([]);
  const [filtreType, setFiltreType] = useState("");
  const [loading, setLoading] = useState(true);

  const charger = () => {
    setLoading(true);
    const url = filtreType ? `/api/journal?type=${filtreType}` : "/api/journal";
    fetch(url).then((r) => r.json()).then(setActivites).finally(() => setLoading(false));
  };

  useEffect(charger, [filtreType]);

  const typesUnique = Array.from(new Set(activites.map((a) => a.type))).sort();

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📜 Journal d'activité" soustitre="Traçabilité complète · audit trail" />
      <main className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">

        {/* Filtres */}
        <section className="bg-white rounded-lg shadow p-4 flex flex-wrap gap-2 items-center">
          <span className="text-sm font-semibold text-slate-700">Filtrer par type :</span>
          <select value={filtreType} onChange={(e) => setFiltreType(e.target.value)} className="px-3 py-1.5 border rounded text-sm">
            <option value="">Tous</option>
            {typesUnique.map((t) => <option key={t} value={t}>{ICONES[t] || "•"} {t}</option>)}
          </select>
          <button
            onClick={() => {
              const rows = activites.map((a) => ({
                date: a.date, type: a.type, ref: `${a.ref_type || ""}/${a.ref_id || ""}`,
                description: a.description || "", ip: a.ip || "",
              }));
              exporterCSV(`journal-${new Date().toISOString().slice(0, 10)}`, rows);
            }}
            className="ml-auto px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded text-xs font-semibold"
          >📊 Exporter CSV</button>
          <button onClick={charger} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold">🔄 Rafraîchir</button>
        </section>

        {loading && <div className="text-center text-slate-500 py-8">Chargement...</div>}

        {!loading && activites.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center text-slate-500">
            <div className="text-5xl mb-3">📭</div>
            Aucune activité {filtreType ? `de type "${filtreType}"` : ""} pour l'instant.
          </div>
        )}

        {!loading && activites.length > 0 && (
          <section className="bg-white rounded-lg shadow overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-xs uppercase text-slate-600">
                <tr>
                  <th className="p-2 text-left">Quand</th>
                  <th className="p-2 text-left">Type</th>
                  <th className="p-2 text-left">Référence</th>
                  <th className="p-2 text-left">Description</th>
                  <th className="p-2 text-left hidden md:table-cell">IP</th>
                </tr>
              </thead>
              <tbody>
                {activites.map((a) => (
                  <tr key={a.id} className="border-t hover:bg-slate-50">
                    <td className="p-2 text-xs text-slate-600 whitespace-nowrap">{new Date(a.date).toLocaleString("fr-CA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="p-2 whitespace-nowrap">
                      <span className="mr-1">{ICONES[a.type] || "•"}</span>
                      <code className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">{a.type}</code>
                    </td>
                    <td className="p-2 text-xs text-slate-700 whitespace-nowrap">
                      {a.ref_type && <code className="bg-blue-50 text-blue-900 px-1.5 py-0.5 rounded">{a.ref_type}/{a.ref_id}</code>}
                    </td>
                    <td className="p-2 text-slate-800">{a.description || "—"}</td>
                    <td className="p-2 text-xs text-slate-400 font-mono hidden md:table-cell">{a.ip || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <p className="text-xs text-slate-500 text-center">
          Conservation : 200 dernières entrées. Pour audit complet, exporter régulièrement en CSV.
        </p>
      </main>
    </div>
  );
}

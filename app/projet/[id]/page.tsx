"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

/** Page publique d'un projet pour le client.
 * URL : /projet/[id]?t=TOKEN
 * Vue épurée : pas de coûts, marges, ou infos internes. */
export default function ProjetPublic() {
  const params = useParams();
  const search = useSearchParams();
  const id = +(params?.id as string);
  const token = search?.get("t") || "";
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !token) { setErr("Lien invalide"); return; }
    fetch(`/api/projet-public?id=${id}&token=${token}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setErr(d.error); else setData(d); })
      .catch(() => setErr("Erreur de chargement"));
  }, [id, token]);

  if (err) return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
      <div className="text-center"><h1 className="text-2xl font-bold mb-2">⛔ Accès refusé</h1><p className="text-slate-300">{err}</p></div>
    </div>
  );
  if (!data) return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><p className="text-slate-500">Chargement...</p></div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-emerald-50">
      <header className="bg-slate-900 text-white p-6 shadow-lg">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="w-12 h-9 flex items-center justify-center" data-no-invert>
            <svg viewBox="0 0 400 280" className="w-full h-full">
              <path d="M40 180 L360 180 L340 240 L60 240 Z" stroke="white" strokeWidth={6} fill="none" />
              <path d="M200 40 L200 180" stroke="white" strokeWidth={6} />
              <path d="M205 70 L300 100 L300 175 L205 175 Z" fill="white" />
            </svg>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider opacity-70">Revêtement Viking</div>
            <div className="font-bold text-lg">Votre projet</div>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-10 space-y-6">
          <div>
            <span className={`inline-block text-xs px-3 py-1 rounded-full font-bold ${data.statut === "actif" ? "bg-emerald-100 text-emerald-800" : data.statut === "complete" ? "bg-blue-100 text-blue-800" : "bg-slate-200 text-slate-700"}`}>
              {data.statut === "actif" ? "🔨 En cours" : data.statut === "complete" ? "✅ Terminé" : data.statut === "a_venir" ? "📅 À venir" : data.statut}
            </span>
            <h1 className="text-3xl md:text-4xl font-bold mt-3 text-slate-900">{data.nom}</h1>
            {data.client_nom && <p className="text-slate-600 mt-1">Pour {data.client_nom}</p>}
          </div>

          {data.adresse_chantier && (
            <div className="bg-slate-50 rounded-lg p-4">
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">📍 Adresse du chantier</div>
              <div className="font-semibold text-slate-900">{data.adresse_chantier}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {data.date_debut && (
              <div className="bg-emerald-50 rounded-lg p-4">
                <div className="text-xs uppercase tracking-wider text-emerald-700 mb-1">📅 Démarrage</div>
                <div className="font-semibold text-emerald-900">{new Date(data.date_debut).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" })}</div>
              </div>
            )}
            {data.date_fin_prevue && (
              <div className="bg-amber-50 rounded-lg p-4">
                <div className="text-xs uppercase tracking-wider text-amber-700 mb-1">🎯 Fin prévue</div>
                <div className="font-semibold text-amber-900">{new Date(data.date_fin_prevue).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" })}</div>
              </div>
            )}
          </div>

          {data.description && (
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">📝 Description</div>
              <p className="text-slate-700 whitespace-pre-wrap">{data.description}</p>
            </div>
          )}

          <div className="border-t pt-4 text-center">
            <p className="text-sm text-slate-600">Une question ? Contactez-nous :</p>
            <p className="text-emerald-700 font-bold mt-1">📞 Revêtement Viking Inc.</p>
            <p className="text-xs text-slate-400 mt-1">RBQ 5811-4299-01</p>
          </div>
        </div>
      </main>
      <footer className="text-center py-6 text-xs text-slate-400">
        Merci de nous faire confiance pour votre projet 🛠️
      </footer>
    </div>
  );
}

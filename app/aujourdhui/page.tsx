"use client";

import { useEffect, useState, lazy, Suspense } from "react";
import Navigation from "@/components/Navigation";
import MeteoProjet from "@/components/MeteoProjet";

const ModalHeuresJour = lazy(() => import("@/components/ModalHeuresJour"));
const ModalPhotos = lazy(() => import("@/components/ModalPhotos"));
const ModalDepense = lazy(() => import("@/components/ModalDepense"));

type ModalType = "heures" | "photos" | "depense" | null;

export default function AujourdhuiPage() {
  const [projets, setProjets] = useState<any[]>([]);
  const [taches, setTaches] = useState<any[]>([]);
  const [modal, setModal] = useState<ModalType>(null);
  const [projetSel, setProjetSel] = useState<number>(0);

  const charger = () => {
    fetch("/api/projets?statut=actif").then((r) => r.json()).then((d) => setProjets(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/taches?statut=a_faire").then((r) => r.json()).then((d) => setTaches(Array.isArray(d) ? d : [])).catch(() => {});
  };
  useEffect(() => { charger(); }, []);

  const ouvrir = (type: ModalType, projet_id: number) => { setProjetSel(projet_id); setModal(type); };
  const auj = new Date();
  const dateLabel = auj.toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long" });
  const tachesJour = taches.filter((t) => !t.date_due || t.date_due <= auj.toISOString().slice(0, 10));

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="☀️ Ma journée" soustitre={dateLabel} />
      <main className="max-w-3xl mx-auto p-3 md:p-4 space-y-4">

        {/* Tâches du jour */}
        {tachesJour.length > 0 && (
          <section className="bg-white rounded-lg shadow p-4">
            <h2 className="font-bold text-slate-900 mb-2">✅ À faire aujourd'hui ({tachesJour.length})</h2>
            <div className="space-y-1.5">
              {tachesJour.slice(0, 6).map((t) => (
                <div key={t.id} className="flex items-center gap-2 text-sm">
                  <button
                    onClick={async () => { await fetch("/api/taches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, statut: "complete" }) }); charger(); }}
                    className="w-6 h-6 rounded-full border-2 border-slate-300 hover:bg-emerald-500 hover:border-emerald-500 hover:text-white text-xs flex-shrink-0"
                    title="Marquer faite"
                  >✓</button>
                  <span className="flex-1">{t.titre}</span>
                  {t.assigne_a && <span className="text-[10px] text-slate-500">{t.assigne_a}</span>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Chantiers actifs */}
        <h2 className="font-bold text-slate-900">🏗️ Chantiers actifs ({projets.length})</h2>
        {projets.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-slate-400 text-sm">Aucun chantier actif. <a href="/projets" className="text-emerald-700 underline">Voir les projets</a></div>
        ) : projets.map((p) => (
          <section key={p.id} className="bg-white rounded-lg shadow overflow-hidden">
            <div className="p-4">
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                  <a href={`/projets/${p.id}`} className="font-bold text-slate-900 hover:underline">{p.nom}</a>
                  <div className="text-xs text-slate-500">{p.client_nom || "—"}</div>
                </div>
                {p.date_fin_prevue && <span className="text-[10px] text-slate-500 whitespace-nowrap">🏁 {p.date_fin_prevue}</span>}
              </div>
              {p.adresse_chantier && (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(p.adresse_chantier)}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
                  📍 {p.adresse_chantier} — Itinéraire →
                </a>
              )}
              {p.adresse_chantier && <div className="mt-2"><MeteoProjet adresse={p.adresse_chantier} /></div>}
            </div>
            <div className="grid grid-cols-3 divide-x border-t">
              <button onClick={() => ouvrir("heures", p.id)} className="py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100">⏱️ Heures</button>
              <button onClick={() => ouvrir("photos", p.id)} className="py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100">📸 Photo</button>
              <button onClick={() => ouvrir("depense", p.id)} className="py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100">💸 Dépense</button>
            </div>
          </section>
        ))}
      </main>

      <Suspense fallback={null}>
        {modal === "heures" && <ModalHeuresJour ouvert onClose={() => setModal(null)} onSuccess={charger} />}
        {modal === "photos" && <ModalPhotos ouvert onClose={() => setModal(null)} onSuccess={charger} projetIdInitial={projetSel} />}
        {modal === "depense" && <ModalDepense ouvert onClose={() => setModal(null)} onSuccess={charger} projetIdInitial={projetSel} />}
      </Suspense>
    </div>
  );
}

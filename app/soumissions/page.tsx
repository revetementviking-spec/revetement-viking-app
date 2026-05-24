"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";

const STATUTS: Record<string, { label: string; couleur: string }> = {
  brouillon: { label: "Brouillon", couleur: "bg-slate-200 text-slate-800" },
  envoyee: { label: "Envoyée", couleur: "bg-blue-200 text-blue-900" },
  acceptee: { label: "Acceptée", couleur: "bg-emerald-200 text-emerald-900" },
  refusee: { label: "Refusée", couleur: "bg-red-200 text-red-900" },
  facturee: { label: "Facturée", couleur: "bg-purple-200 text-purple-900" },
};

export default function SoumissionsPageWrapper() {
  return <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500">Chargement...</div>}><SoumissionsPage /></Suspense>;
}

function SoumissionsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const statutFiltre = params.get("statut");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const convertirEnProjet = async (numero: string) => {
    if (!confirm("Convertir cette soumission en projet ?\n\nLe client sera créé automatiquement et le budget pré-rempli.")) return;
    const r = await fetch("/api/projets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromSoumission: numero }),
    });
    const d = await r.json();
    if (d.ok) {
      toast(`Projet créé`, "success");
      router.push(`/projets/${d.id}`);
    } else {
      toast("Erreur : " + (d.error || "inconnue"), "error");
    }
  };

  const charger = async () => {
    setLoading(true);
    const url = statutFiltre ? `/api/soumissions?statut=${statutFiltre}` : "/api/soumissions";
    const r = await fetch(url);
    setData(await r.json());
    setLoading(false);
  };

  useEffect(() => { charger(); }, [statutFiltre]);

  const changerStatut = async (numero: string, statut: string) => {
    await fetch("/api/soumissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero, statut }),
    });
    charger();
  };

  const supprimer = async (numero: string) => {
    if (!confirm(`Supprimer ${numero} ?`)) return;
    await fetch(`/api/soumissions?numero=${numero}`, { method: "DELETE" });
    charger();
  };

  const enregistrerHeuresReelles = async (numero: string) => {
    const h = prompt("Heures réelles totales travaillées :");
    if (!h) return;
    await fetch("/api/soumissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ numero, heuresReelles: +h }),
    });
    charger();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📋 Mes soumissions" soustitre={statutFiltre ? `Filtre : ${statutFiltre}` : "Toutes les soumissions"} />

      <main className="max-w-7xl mx-auto p-6">
        <div className="flex gap-2 mb-4 flex-wrap">
          <a href="/soumissions" className={`px-3 py-1 rounded text-sm ${!statutFiltre ? "bg-slate-900 text-white" : "bg-white border"}`}>Toutes</a>
          {Object.entries(STATUTS).map(([k, v]) => (
            <a key={k} href={`/soumissions?statut=${k}`} className={`px-3 py-1 rounded text-sm ${statutFiltre === k ? "bg-slate-900 text-white" : v.couleur}`}>{v.label}</a>
          ))}
        </div>

        {loading ? (
          <div className="bg-white rounded-lg shadow p-6 text-center text-slate-500">Chargement...</div>
        ) : data.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">📋</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucune soumission {statutFiltre ? `avec ce statut` : "encore"}</h3>
            <p className="text-sm text-slate-500 mb-4">{statutFiltre ? "Essaie un autre filtre ou crée une nouvelle soumission." : "Commence par créer ta première soumission."}</p>
            <a href="/" className="inline-block px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Nouvelle soumission</a>
          </div>
        ) : (
          <>
            {/* Tableau DESKTOP */}
            <div className="hidden md:block bg-white rounded-lg shadow overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left">
                  <tr>
                    <th className="p-3">N°</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">Client / Projet</th>
                    <th className="p-3 text-right">Total</th>
                    <th className="p-3">Statut</th>
                    <th className="p-3">H. est. / réel.</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((s) => (
                    <tr key={s.id} className="border-t hover:bg-slate-50">
                      <td className="p-3 font-mono text-xs">{s.numero}</td>
                      <td className="p-3 text-xs">{new Date(s.date_creation).toLocaleDateString("fr-CA")}</td>
                      <td className="p-3">
                        <div className="font-medium">{s.client_nom}</div>
                        <div className="text-xs text-slate-500">{s.projet}</div>
                      </td>
                      <td className="p-3 text-right font-semibold">{formatCAD(s.total || 0)}</td>
                      <td className="p-3">
                        <select value={s.statut} onChange={(e) => changerStatut(s.numero, e.target.value)} className={`text-xs px-2 py-1 rounded border ${STATUTS[s.statut]?.couleur}`}>
                          {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                      </td>
                      <td className="p-3 text-xs">
                        {(s.heures_estimees || 0).toFixed(1)} h{s.heures_reelles && ` / ${s.heures_reelles.toFixed(1)} h`}
                        {s.statut === "facturee" && !s.heures_reelles && (
                          <button onClick={() => enregistrerHeuresReelles(s.numero)} className="ml-2 text-blue-600 underline">Saisir</button>
                        )}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap">
                        {(s.statut === "acceptee" || s.statut === "facturee") && (
                          <button onClick={() => convertirEnProjet(s.numero)} className="text-blue-600 hover:bg-blue-50 px-2 py-1 rounded text-xs mr-1" title="Créer un projet à partir de cette soumission">🏗️ Projet</button>
                        )}
                        <a href={`/?modifier=${s.numero}`} className="text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded text-xs mr-1">Modifier</a>
                        <button onClick={() => supprimer(s.numero)} className="text-red-600 hover:bg-red-50 px-2 py-1 rounded text-xs">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards MOBILE */}
            <div className="md:hidden space-y-3">
              {data.map((s) => (
                <div key={s.id} className="bg-white rounded-lg shadow p-4 space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-base text-slate-900 truncate">{s.client_nom}</div>
                      <div className="text-xs text-slate-500 truncate">{s.projet}</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-1">{s.numero} · {new Date(s.date_creation).toLocaleDateString("fr-CA")}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-emerald-700 whitespace-nowrap">{formatCAD(s.total || 0)}</div>
                      <div className="text-[10px] text-slate-500">{(s.heures_estimees || 0).toFixed(1)} h{s.heures_reelles ? ` / ${s.heures_reelles.toFixed(1)} h` : ""}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t">
                    <select value={s.statut} onChange={(e) => changerStatut(s.numero, e.target.value)} className={`text-xs px-2 py-1 rounded border ${STATUTS[s.statut]?.couleur} flex-1`}>
                      {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <a href={`/?modifier=${s.numero}`} className="px-3 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded text-xs font-semibold whitespace-nowrap">✏️ Modifier</a>
                    <button onClick={() => supprimer(s.numero)} className="px-2 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-xs">✕</button>
                  </div>
                  {s.statut === "facturee" && !s.heures_reelles && (
                    <button onClick={() => enregistrerHeuresReelles(s.numero)} className="w-full px-3 py-1 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded text-xs font-semibold">📊 Saisir les heures réelles</button>
                  )}
                  {(s.statut === "acceptee" || s.statut === "facturee") && (
                    <button onClick={() => convertirEnProjet(s.numero)} className="w-full px-3 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded text-xs font-semibold">🏗️ Créer un projet</button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

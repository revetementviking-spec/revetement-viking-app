"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import Pagination, { usePagination } from "@/components/Pagination";
import { ecrire, envoyer, lireListe, nombreSaisi } from "@/lib/envoi";
import ErreurChargement from "@/components/ErreurChargement";

const STATUTS: Record<string, { label: string; couleur: string }> = {
  brouillon: { label: "Brouillon", couleur: "bg-slate-200 text-slate-800" },
  envoyee: { label: "Envoyée", couleur: "bg-blue-200 text-blue-900" },
  acceptee: { label: "Acceptée", couleur: "bg-emerald-200 text-emerald-900" },
  refusee: { label: "Refusée", couleur: "bg-red-200 text-red-900" },
  facturee: { label: "Facturée", couleur: "bg-purple-200 text-purple-900" },
};

export default function SoumissionsPage() {
  // Borne Suspense : useSearchParams la réclame.
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-50"><Navigation titre="📋 Mes soumissions" /><div className="p-6 text-center text-slate-500">Chargement...</div></div>}>
      <SoumissionsListe />
    </Suspense>
  );
}

function SoumissionsListe() {
  const router = useRouter();
  // Filtre lu de façon SYNCHRONE (useSearchParams) : lu dans un effet, le premier
  // chargement partait sans filtre, puis un second avec — deux requêtes, et la liste
  // complète clignotait avant la liste filtrée.
  const sp = useSearchParams();
  const statutFiltre = sp.get("statut");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const { toast } = useToast();

  const copierLienClient = async (numero: string) => {
    try {
      const d = await fetch(`/api/lien-soumission?numero=${encodeURIComponent(numero)}`).then((r) => r.json());
      if (!d.url) { toast("Erreur génération lien", "error"); return; }
      await navigator.clipboard.writeText(d.url);
      toast("✓ Lien client copié — colle-le dans un courriel ou texto", "success");
    } catch {
      toast("Impossible de copier le lien", "error");
    }
  };

  const convertirEnProjet = async (numero: string) => {
    if (!confirm("Convertir cette soumission en projet ?\n\nLe client sera créé automatiquement et le budget pré-rempli.")) return;
    const res = await envoyer<any>("/api/projets", { corps: { fromSoumission: numero } });
    const d = res.ok ? res.data || {} : { error: res.erreur };
    if (res.ok) {
      toast(`Projet créé`, "success");
      router.push(`/projets/${d.id}`);
    } else {
      toast("Erreur : " + (d.error || "inconnue"), "error");
    }
  };

  const charger = async () => {
    setLoading(true);
    try {
      const url = statutFiltre ? `/api/soumissions?statut=${encodeURIComponent(statutFiltre)}` : "/api/soumissions";
      // Lecture avec filet : un 500 faisait planter le rendu sur `.slice` d'un objet
      // d'erreur ; un réseau coupé laissait « Chargement... » pour toujours.
      const r = await lireListe(url);
      if (!r.ok) { setErreur(r.erreur); return; }
      setErreur(null);
      setData(r.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { charger(); }, [statutFiltre]);

  // Pagination de l'affichage (la liste peut grandir avec le temps).
  const pg = usePagination(data.length, 50);
  const visibles = useMemo(() => data.slice(pg.debut, pg.fin), [data, pg.debut, pg.fin]);
  // Revenir à la 1re page quand on change de filtre de statut.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { pg.reset(); }, [statutFiltre]);

  const changerStatut = async (numero: string, statut: string) => {
    if (!(await ecrire("/api/soumissions", "PATCH", { numero, statut }, "Enregistrement"))) return;
    charger();
  };

  const supprimer = async (numero: string) => {
    if (!confirm(`Supprimer ${numero} ?`)) return;
    if (!(await ecrire(`/api/soumissions?numero=${numero}`, "DELETE", undefined, "Suppression"))) return;
    toast(`Soumission ${numero} supprimée`, "info");
    charger();
  };

  const dupliquer = async (numero: string) => {
    if (!confirm(`Dupliquer ${numero} comme nouvelle soumission ?`)) return;
    const res = await envoyer<{ numero?: string }>("/api/soumissions/dupliquer", { corps: { numero } });
    // `/` est le tableau de bord et n'a jamais lu `?modifier=` : le formulaire est à
    // /soumissions/nouveau. On atterrissait donc sur le dashboard après avoir dupliqué,
    // ce qui donnait l'impression d'un échec → re-clics → doublons.
    if (res.ok && res.data?.numero) { router.push(`/soumissions/nouveau?modifier=${res.data.numero}`); }
    else toast(`Duplication refusée : ${res.erreur || "réponse inattendue"}`, "error");
  };

  const enregistrerHeuresReelles = async (numero: string) => {
    const h = prompt("Heures réelles totales travaillées (ex. : 42,5) :");
    if (!h) return;
    // nombreSaisi et non `+h` : « 42,5 » donnait NaN, envoyé tel quel au serveur.
    const heures = nombreSaisi(h);
    if (!Number.isFinite(heures) || heures < 0) { toast("Nombre d'heures illisible (ex. : 42,5)", "warning"); return; }
    if (!(await ecrire("/api/soumissions", "PATCH", { numero, heuresReelles: heures }, "Enregistrement"))) return;
    charger();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📋 Mes soumissions" soustitre={statutFiltre ? `Filtre : ${statutFiltre}` : "Toutes les soumissions"} />

      <main className="max-w-7xl mx-auto p-6">
        <div className="flex gap-2 mb-4 flex-wrap">
          <a href="/soumissions" className={`px-3 py-2.5 rounded text-sm ${!statutFiltre ? "bg-slate-900 text-white" : "bg-white border"}`}>Toutes</a>
          {Object.entries(STATUTS).map(([k, v]) => (
            <a key={k} href={`/soumissions?statut=${k}`} className={`px-3 py-2.5 rounded text-sm ${statutFiltre === k ? "bg-slate-900 text-white" : v.couleur}`}>{v.label}</a>
          ))}
        </div>

        {erreur ? (
          <ErreurChargement erreur={erreur} onReessayer={charger} />
        ) : loading ? (
          <div className="bg-white rounded-lg shadow p-6 text-center text-slate-500">Chargement...</div>
        ) : data.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">📋</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucune soumission {statutFiltre ? `avec ce statut` : "encore"}</h3>
            <p className="text-sm text-slate-500 mb-4">{statutFiltre ? "Essaie un autre filtre ou crée une nouvelle soumission." : "Commence par créer ta première soumission."}</p>
            {/* `/` est le tableau de bord : le formulaire est à /soumissions/nouveau. */}
            <a href="/soumissions/nouveau" className="inline-block px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Nouvelle soumission</a>
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
                  {visibles.map((s) => (
                    <tr key={s.id} className="border-t hover:bg-slate-50">
                      <td className="p-3 font-mono text-xs">{s.numero}</td>
                      <td className="p-3 text-xs">{new Date(s.date_creation).toLocaleDateString("fr-CA")}</td>
                      <td className="p-3">
                        <div className="font-medium">{s.client_nom}</div>
                        <div className="text-xs text-slate-500">{s.projet}</div>
                      </td>
                      <td className="p-3 text-right font-semibold">{formatCAD(s.total || 0)}</td>
                      <td className="p-3">
                        <select value={s.statut} onChange={(e) => changerStatut(s.numero, e.target.value)} className={`text-xs px-2 min-h-10 rounded border ${STATUTS[s.statut]?.couleur}`}>
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
                        <button onClick={() => copierLienClient(s.numero)} className="text-indigo-600 hover:bg-indigo-50 px-2 py-1 rounded text-xs mr-1" title="Copier le lien de signature à envoyer au client">🔗 Lien client</button>
                        <a href={`/soumissions/nouveau?modifier=${s.numero}`} className="text-emerald-600 hover:bg-emerald-50 px-2 py-1 rounded text-xs mr-1">Modifier</a>
                        <button onClick={() => dupliquer(s.numero)} className="text-purple-600 hover:bg-purple-50 px-2 py-1 rounded text-xs mr-1" title="Utiliser comme template pour une nouvelle soumission">📋 Dupliquer</button>
                        <a href={`/soumissions/${s.numero}/materiaux`} className="text-amber-700 hover:bg-amber-50 px-2 py-1 rounded text-xs mr-1" title="Voir la liste de matériaux">📦 Matériaux</a>
                        <button onClick={() => supprimer(s.numero)} className="text-red-600 hover:bg-red-50 min-w-10 min-h-10 px-3 py-2 rounded text-sm" aria-label="Supprimer la soumission">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination total={data.length} page={pg.page} pageSize={pg.pageSize} onPage={pg.setPage} onPageSize={pg.setPageSize} label="soumissions" />
            </div>

            {/* Cards MOBILE */}
            <div className="md:hidden space-y-3">
              {visibles.map((s) => (
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
                    <select value={s.statut} onChange={(e) => changerStatut(s.numero, e.target.value)} className={`text-xs px-2 min-h-10 rounded border ${STATUTS[s.statut]?.couleur} flex-1`}>
                      {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                    <a href={`/soumissions/nouveau?modifier=${s.numero}`} className="inline-flex items-center min-h-10 px-3 py-2 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded text-sm font-semibold whitespace-nowrap">✏️ Modifier</a>
                    <button onClick={() => dupliquer(s.numero)} className="px-3 py-1 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded text-xs font-semibold whitespace-nowrap" title="Dupliquer comme template">📋</button>
                    <button onClick={() => supprimer(s.numero)} className="min-w-10 min-h-10 px-3 py-2 bg-red-100 text-red-700 hover:bg-red-200 rounded text-sm" aria-label="Supprimer la soumission">✕</button>
                  </div>
                  {s.statut === "facturee" && !s.heures_reelles && (
                    <button onClick={() => enregistrerHeuresReelles(s.numero)} className="w-full px-3 py-1 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded text-xs font-semibold">📊 Saisir les heures réelles</button>
                  )}
                  {(s.statut === "acceptee" || s.statut === "facturee") && (
                    <button onClick={() => convertirEnProjet(s.numero)} className="w-full px-3 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded text-xs font-semibold">🏗️ Créer un projet</button>
                  )}
                </div>
              ))}
              <div className="bg-white rounded-lg shadow">
                <Pagination total={data.length} page={pg.page} pageSize={pg.pageSize} onPage={pg.setPage} onPageSize={pg.setPageSize} label="soumissions" />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

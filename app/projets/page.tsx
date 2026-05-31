"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCAD } from "@/lib/calculateur";
import { prefetchProjet } from "@/lib/prefetchProjet";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import FAB from "@/components/FAB";

const STATUTS: Record<string, { label: string; couleur: string }> = {
  en_cours: { label: "En cours", couleur: "bg-emerald-100 text-emerald-900" },
  a_venir: { label: "À venir", couleur: "bg-violet-100 text-violet-900" },
  actif: { label: "Actif", couleur: "bg-cyan-100 text-cyan-900" },
  en_pause: { label: "En pause", couleur: "bg-amber-100 text-amber-900" },
  complete: { label: "Complété", couleur: "bg-blue-100 text-blue-900" },
  annule: { label: "Annulé", couleur: "bg-red-100 text-red-900" },
};

type TriMode = "recent" | "nom" | "marge_pct" | "budget" | "cout" | "marge_montant" | "date_debut";

export default function ProjetsPage() {
  const [projets, setProjets] = useState<any[]>([]);
  const [filtre, setFiltre] = useState<string>("");
  const [recherche, setRecherche] = useState("");
  const [tri, setTri] = useState<TriMode>("recent");
  const [triAsc, setTriAsc] = useState(false);
  const [loading, setLoading] = useState(true);
  const [creerOuvert, setCreerOuvert] = useState(false);
  const [nouveau, setNouveau] = useState({ nom: "", client_nom: "", adresse_chantier: "", prix_contrat: "", description: "", date_debut: new Date().toISOString().slice(0, 10), date_fin_prevue: "", statut: "a_venir", reno_assistance: false });
  const [facture, setFacture] = useState<{ data: string; type: string; nom: string } | null>(null);
  const [clientsExistants, setClientsExistants] = useState<any[]>([]);
  const [suggClient, setSuggClient] = useState(false);
  const { toast } = useToast();

  // Charge la liste des clients existants pour suggestion dans le modal Nouveau projet
  useEffect(() => {
    if (creerOuvert && clientsExistants.length === 0) {
      fetch("/api/clients", { cache: "no-store" }).then((r) => r.json()).then((d) => setClientsExistants(Array.isArray(d) ? d : []));
    }
  }, [creerOuvert]);

  const charger = async () => {
    setLoading(true);
    const url = filtre ? `/api/projets?statut=${filtre}` : "/api/projets";
    const r = await fetch(url, { cache: "no-store" });
    setProjets(await r.json());
    setLoading(false);
  };

  useEffect(() => { charger(); }, [filtre]);

  const creer = async () => {
    if (!nouveau.nom.trim()) { toast("Nom du projet requis", "warning"); return; }
    const prix = nouveau.prix_contrat ? +nouveau.prix_contrat : null;
    const r = await fetch("/api/projets", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...nouveau,
        // Le prix de contrat sert AUSSI de budget initial pour les calculs de marge
        budget_estime: prix,
        prix_contrat: prix,
        statut: nouveau.statut,
        reno_assistance: nouveau.reno_assistance ? 1 : 0,
        date_debut: nouveau.date_debut || new Date().toISOString().slice(0, 10),
      }),
    });
    const d = await r.json();
    if (d.ok) {
      // Si une facture a été jointe, la sauvegarder via PATCH
      if (facture && d.id) {
        await fetch("/api/projets", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: d.id, facture_finale_data: facture.data, facture_finale_type: facture.type }),
        });
      }
      toast("Projet créé", "success");
      setCreerOuvert(false);
      setNouveau({ nom: "", client_nom: "", adresse_chantier: "", prix_contrat: "", description: "", date_debut: new Date().toISOString().slice(0, 10), date_fin_prevue: "", statut: "a_venir", reno_assistance: false });
      setFacture(null);
      charger();
    }
  };

  const traiterFacture = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast("Fichier > 5 MB", "warning"); return; }
    const reader = new FileReader();
    reader.onload = () => setFacture({ data: reader.result as string, type: file.type, nom: file.name });
    reader.readAsDataURL(file);
  };

  const projetsAffiches = (() => {
    let list = [...projets];
    if (recherche.trim()) {
      const q = recherche.toLowerCase();
      list = list.filter((p) => [p.nom, p.client_nom, p.adresse_chantier, p.description].filter(Boolean).some((x: string) => x.toLowerCase().includes(q)));
    }
    const cmp: Record<TriMode, (a: any, b: any) => number> = {
      recent: (a, b) => (b.date_creation || "").localeCompare(a.date_creation || ""),
      nom: (a, b) => (a.nom || "").localeCompare(b.nom || ""),
      marge_pct: (a, b) => (b.marge_pct || 0) - (a.marge_pct || 0),
      marge_montant: (a, b) => (b.marge || 0) - (a.marge || 0),
      budget: (a, b) => (b.budget_estime || 0) - (a.budget_estime || 0),
      cout: (a, b) => (b.cout_total || 0) - (a.cout_total || 0),
      // Date de début ASC : les projets sans date_debut tombent en fin
      date_debut: (a, b) => {
        const da = a.date_debut || "9999-12-31";
        const db = b.date_debut || "9999-12-31";
        return da.localeCompare(db);
      },
    };
    // Filtre vide ("Tous") + tri par défaut → on bascule auto sur date_debut ASC
    const triEffectif: TriMode = (!filtre && tri === "recent") ? "date_debut" : tri;
    list.sort(cmp[triEffectif]);
    if (triAsc && triEffectif !== "date_debut") list.reverse();
    return list;
  })();

  // Considère "en_cours" et "actif" comme des projets en activité
  const estActif = (p: any) => p.statut === 'actif' || p.statut === 'en_cours';
  const stats = {
    actifs: projets.filter(estActif).length,
    budget_total: projets.filter(estActif).reduce((s, p) => s + (p.budget_estime || 0), 0),
    cout_total: projets.filter(estActif).reduce((s, p) => s + (p.cout_total || 0), 0),
    facture_total: projets.filter(estActif).reduce((s, p) => s + (p.total_facture || 0), 0),
    paye_total: projets.filter(estActif).reduce((s, p) => s + (p.total_paye || 0), 0),
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation
        titre="🏗️ Projets"
        soustitre={`${projets.length} projet(s)${filtre ? ` · ${STATUTS[filtre]?.label}` : ""}`}
      />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* Bouton Nouveau projet + Carte */}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCreerOuvert(true)} className="flex-1 md:flex-none px-4 py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white rounded-lg font-bold shadow">
            ➕ Nouveau projet
          </button>
          <a href="/projets/carte" className="px-4 py-3 bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white rounded-lg font-bold shadow">
            🗺️ Carte
          </a>
          <a href="/projets/calendrier" className="px-4 py-3 bg-purple-600 hover:bg-purple-500 active:scale-[0.99] text-white rounded-lg font-bold shadow">
            📅 Calendrier
          </a>
        </div>

        {/* KPIs projets actifs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KPI label="Projets actifs" value={stats.actifs} />
          <KPI label="Budget total" value={formatCAD(stats.budget_total)} />
          <KPI label="Coût engagé" value={formatCAD(stats.cout_total)} couleur="text-amber-700" />
          <KPI label="Facturé" value={formatCAD(stats.facture_total)} couleur="text-blue-700" />
          <KPI label="Payé" value={formatCAD(stats.paye_total)} couleur="text-emerald-700" />
        </div>

        {/* Recherche + tri + filtres */}
        <div className="bg-white rounded-lg shadow p-3 space-y-2">
          <div className="flex gap-2 flex-wrap items-center">
            <input
              type="search"
              placeholder="🔍 Rechercher (nom, client, adresse, description)..."
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              className="flex-1 min-w-48 px-3 py-2 border rounded text-sm"
            />
            <select value={tri} onChange={(e) => setTri(e.target.value as TriMode)} className="px-3 py-2 border rounded text-sm bg-white">
              <option value="recent">Plus récent</option>
              <option value="date_debut">Date de début</option>
              <option value="nom">Nom (A→Z)</option>
              <option value="marge_pct">Marge %</option>
              <option value="marge_montant">Marge $</option>
              <option value="budget">Budget</option>
              <option value="cout">Coût</option>
            </select>
            <button onClick={() => setTriAsc(!triAsc)} title={triAsc ? "Croissant" : "Décroissant"} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm">
              {triAsc ? "↑" : "↓"}
            </button>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setFiltre("")} className={`px-3 py-1 rounded text-sm ${!filtre ? "bg-slate-900 text-white" : "bg-white border"}`}>Tous</button>
            {Object.entries(STATUTS).map(([k, v]) => (
              <button key={k} onClick={() => setFiltre(k)} className={`px-3 py-1 rounded text-sm ${filtre === k ? "bg-slate-900 text-white" : v.couleur}`}>{v.label}</button>
            ))}
            <span className="ml-auto text-xs text-slate-500 self-center">{projetsAffiches.length} sur {projets.length}</span>
          </div>
        </div>

        {/* Liste projets */}
        {loading ? (
          <div className="bg-white rounded-lg shadow p-6 text-center text-slate-500">Chargement...</div>
        ) : projetsAffiches.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">🏗️</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucun projet</h3>
            <p className="text-sm text-slate-500 mb-4">Convertis une soumission acceptée en projet, ou crée un projet manuellement.</p>
            <button onClick={() => setCreerOuvert(true)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Nouveau projet</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projetsAffiches.map((p) => (
              <Link key={p.id} href={`/projets/${p.id}`} prefetch onMouseEnter={() => prefetchProjet(p.id)} onTouchStart={() => prefetchProjet(p.id)} className="group relative bg-white rounded-lg shadow hover:shadow-lg transition p-4 space-y-2">
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!confirm(`Supprimer définitivement « ${p.nom} » ?\n\n⚠️ Irréversible.`)) return;
                    const r = await fetch(`/api/projets?id=${p.id}`, { method: "DELETE" });
                    if (r.ok) { toast(`Projet supprimé`, "success"); charger(); }
                    else toast("Erreur suppression", "error");
                  }}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition bg-red-100 hover:bg-red-200 text-red-700 rounded-full w-7 h-7 flex items-center justify-center text-sm z-10"
                  title="Supprimer ce projet"
                  aria-label="Supprimer"
                >🗑</button>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {p.numero && <span className="text-[10px] font-mono text-indigo-600 font-bold">{p.numero}</span>}
                      {p.reno_assistance ? <span className="text-[9px] bg-amber-100 text-amber-900 px-1.5 py-0.5 rounded-full font-bold border border-amber-300">🛠️ Reno assistance</span> : null}
                    </div>
                    <div className="font-bold text-slate-900 truncate">{p.nom}</div>
                    <div className="text-xs text-slate-500 truncate">{p.client_nom || "Sans client"}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${STATUTS[p.statut]?.couleur || "bg-slate-200"}`}>{STATUTS[p.statut]?.label || p.statut}</span>
                </div>

                {p.adresse_chantier && <div className="text-xs text-slate-600">📍 {p.adresse_chantier}</div>}

                {/* Barre budget vs coût */}
                {p.budget_estime > 0 && (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span>Budget : <strong>{formatCAD(p.budget_estime)}</strong></span>
                      <span className={p.pct_budget_consomme > 90 ? "text-red-600 font-bold" : p.pct_budget_consomme > 75 ? "text-amber-600" : "text-slate-600"}>{p.pct_budget_consomme.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className={`h-full ${p.pct_budget_consomme > 100 ? "bg-red-500" : p.pct_budget_consomme > 90 ? "bg-amber-500" : p.pct_budget_consomme > 75 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, p.pct_budget_consomme)}%` }} />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1 text-xs pt-2 border-t">
                  <div><span className="text-slate-500">MO :</span> <strong>{p.total_heures.toFixed(1)} h</strong></div>
                  <div><span className="text-slate-500">Coût direct :</span> <strong>{formatCAD(p.cout_total)}</strong></div>
                  <div><span className="text-slate-500">Facturé :</span> <strong>{formatCAD(p.total_facture)}</strong></div>
                  <div><span className="text-slate-500">Payé :</span> <strong className="text-emerald-700">{formatCAD(p.total_paye)}</strong></div>
                </div>

                {p.marge !== undefined && p.budget_estime > 0 && (() => {
                  const revenu = p.revenu || p.budget_estime || 0;
                  const fraisFixes = Math.round(revenu * 0.15);
                  const profitNet = revenu - p.cout_total - fraisFixes;
                  const pctNet = revenu > 0 ? (profitNet / revenu) * 100 : 0;
                  return (
                    <div className={`text-xs font-bold text-center py-1 rounded ${profitNet < 0 ? "bg-red-50 text-red-700" : pctNet < 15 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`} title="Profit net = Revenu − Coût direct − 15% frais fixes structurels">
                      Profit net : {formatCAD(profitNet)} ({pctNet.toFixed(0)}%) <span className="font-normal opacity-70">après 15% fixes</span>
                    </div>
                  );
                })()}
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* Modal créer projet */}
      {creerOuvert && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setCreerOuvert(false)}>
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Nouveau projet</h3>
            <Input label="Nom du projet *" value={nouveau.nom} onChange={(v) => setNouveau({ ...nouveau, nom: v })} />
            <div className="relative">
              <Input label="Client" value={nouveau.client_nom} onChange={(v) => { setNouveau({ ...nouveau, client_nom: v }); setSuggClient(true); }} placeholder="Tapez pour rechercher ou créer..." />
              {suggClient && nouveau.client_nom.trim().length > 0 && (() => {
                const q = nouveau.client_nom.toLowerCase().trim();
                const matches = clientsExistants.filter((c: any) => (c.nom || "").toLowerCase().includes(q) || (c.courriel || "").toLowerCase().includes(q) || (c.telephone || "").includes(q)).slice(0, 6);
                if (matches.length === 0) return null;
                return (
                  <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {matches.map((c: any) => (
                      <button key={c.id} type="button" onClick={() => {
                        setNouveau({ ...nouveau, client_nom: c.nom, adresse_chantier: nouveau.adresse_chantier || c.adresse || "" });
                        setSuggClient(false);
                        toast(`Client existant sélectionné : ${c.nom}`, "success");
                      }} className="w-full text-left px-3 py-2 hover:bg-emerald-50 border-b border-slate-100 last:border-0">
                        <div className="font-semibold text-sm text-slate-900">{c.nom}</div>
                        <div className="text-[11px] text-slate-500 flex gap-3 flex-wrap">
                          {c.telephone && <span>📞 {c.telephone}</span>}
                          {c.courriel && <span className="truncate">✉️ {c.courriel}</span>}
                          {c.adresse && <span className="truncate">📍 {c.adresse}</span>}
                        </div>
                      </button>
                    ))}
                    <div className="px-3 py-1.5 text-[10px] text-slate-400 border-t bg-slate-50">💡 Cliquer un client existant pour pré-remplir, ou continuer pour créer un nouveau</div>
                  </div>
                );
              })()}
            </div>
            <Input label="Adresse chantier" value={nouveau.adresse_chantier} onChange={(v) => setNouveau({ ...nouveau, adresse_chantier: v })} />
            <Input label="💰 Prix total du contrat $ *" value={nouveau.prix_contrat} onChange={(v) => setNouveau({ ...nouveau, prix_contrat: v })} type="number" placeholder="Ex: 45000" />
            <p className="text-[10px] text-slate-500 -mt-2">Ce prix devient la référence pour calculer la marge et la rentabilité du projet.</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">📅 Date de début</label>
                <input type="date" value={nouveau.date_debut} onChange={(e) => setNouveau({ ...nouveau, date_debut: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">🎯 Date de fin prévue</label>
                <input type="date" value={nouveau.date_fin_prevue} onChange={(e) => setNouveau({ ...nouveau, date_fin_prevue: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Statut</label>
              <select value={nouveau.statut} onChange={(e) => setNouveau({ ...nouveau, statut: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                {Object.entries(STATUTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <Input label="Description" value={nouveau.description} onChange={(v) => setNouveau({ ...nouveau, description: v })} />

            <label className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded p-2 cursor-pointer">
              <input type="checkbox" checked={nouveau.reno_assistance} onChange={(e) => setNouveau({ ...nouveau, reno_assistance: e.target.checked })} className="w-4 h-4" />
              <span className="text-sm font-semibold text-amber-900">🛠️ Reno assistance</span>
              <span className="text-[10px] text-amber-700">— dossier subvention/aide rénovation</span>
            </label>

            {/* Facture finale optionnelle dès la création */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">📎 Facture (optionnel)</label>
              {facture ? (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded p-2">
                  {facture.type.startsWith("image/") ? (
                    <img src={facture.data} alt="Facture" className="w-12 h-12 object-cover rounded" />
                  ) : (
                    <div className="w-12 h-12 bg-slate-200 rounded flex items-center justify-center text-2xl">📄</div>
                  )}
                  <div className="flex-1 min-w-0 text-xs">
                    <div className="font-semibold truncate">{facture.nom}</div>
                    <div className="text-slate-500">{(facture.data.length * 0.75 / 1024).toFixed(0)} ko</div>
                  </div>
                  <button onClick={() => setFacture(null)} className="text-red-600 hover:bg-red-100 px-2 py-1 rounded text-sm">✕</button>
                </div>
              ) : (
                <label className="cursor-pointer block bg-white border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 rounded p-3 text-center transition text-sm font-semibold text-slate-700">
                  📎 Joindre PDF ou photo de la facture
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && traiterFacture(e.target.files[0])} />
                </label>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2 sticky bottom-0 bg-white">
              <button onClick={() => setCreerOuvert(false)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={creer} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold">Créer</button>
            </div>
          </div>
        </div>
      )}
      <FAB onSuccess={charger} />
    </div>
  );
}

function KPI({ label, value, couleur }: { label: string; value: any; couleur?: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-3">
      <div className="text-[10px] text-slate-500 uppercase font-semibold">{label}</div>
      <div className={`text-lg font-bold mt-1 ${couleur || "text-slate-900"}`}>{value}</div>
    </div>
  );
}

function Input({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 border rounded text-sm" />
    </div>
  );
}

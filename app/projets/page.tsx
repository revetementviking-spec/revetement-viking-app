"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCAD } from "@/lib/calculateur";
import { prefetchProjet } from "@/lib/prefetchProjet";
import { prechargerDiffere } from "@/lib/prefetchClient";
import { estProjetActif } from "@/lib/statuts-projet";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import FAB from "@/components/FAB";
import { aujourdhuiMontreal } from "@/lib/date";
import { ecrire, envoyer, nombreSaisi, lireListe } from "@/lib/envoi";
import { fichierTropLourd } from "@/lib/limites-fichiers";
import { useVerrou } from "@/lib/verrou";
import ErreurChargement from "@/components/ErreurChargement";
import Modale from "@/components/Modale";
import Pagination, { usePagination } from "@/components/Pagination";

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
  const [nouveau, setNouveau] = useState({ nom: "", client_nom: "", client_telephone: "", client_courriel: "", client_adresse: "", adresse_chantier: "", prix_contrat: "", description: "", date_debut: aujourdhuiMontreal(), date_fin_prevue: "", statut: "a_venir", reno_assistance: false });
  const [facture, setFacture] = useState<{ data: string; type: string; nom: string } | null>(null);
  const [clientsExistants, setClientsExistants] = useState<any[]>([]);
  const [suggClient, setSuggClient] = useState(false);
  const { toast } = useToast();

  // Charge la liste des clients existants pour suggestion dans le modal Nouveau projet
  useEffect(() => {
    if (creerOuvert && clientsExistants.length === 0) {
      lireListe("/api/clients").then((r) => { if (r.ok) setClientsExistants(r.data); });
    }
  }, [creerOuvert]);

  const [erreur, setErreur] = useState<string | null>(null);
  const charger = async () => {
    setLoading(true);
    try {
      const url = filtre ? `/api/projets?statut=${filtre}` : "/api/projets";
      // Lecture avec filet : un 500 faisait planter le rendu sur `.filter` d'un objet
      // d'erreur ; un réseau coupé laissait « Chargement... » pour toujours.
      const r = await lireListe(url);
      if (!r.ok) { setErreur(r.erreur); return; }
      setErreur(null);
      setProjets(r.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { charger(); }, [filtre]);

  // Verrou par ref (lib/verrou.ts) : deux clics du même instant créaient deux projets
  // (et deux fiches client).
  const verrouCreer = useVerrou();
  const creer = () => verrouCreer.executer(async () => {
    if (!nouveau.nom.trim()) { toast("Nom du projet requis", "warning"); return; }
    // Virgule décimale : `+"48 000,50"` donnait NaN, refusé par le serveur sans dire pourquoi.
    const prix = nouveau.prix_contrat ? nombreSaisi(nouveau.prix_contrat) : null;
    if (prix !== null && (!Number.isFinite(prix) || prix < 0)) { toast("Prix du contrat invalide (ex. : 48 000,50)", "warning"); return; }
    const res = await envoyer<any>("/api/projets", {
      corps: {
        ...nouveau,
        // Le prix de contrat sert AUSSI de budget initial pour les calculs de marge
        budget_estime: prix,
        prix_contrat: prix,
        statut: nouveau.statut,
        reno_assistance: nouveau.reno_assistance ? 1 : 0,
        date_debut: nouveau.date_debut || aujourdhuiMontreal(),
      },
    });
    // Échec silencieux avant : un refus du serveur (courriel invalide, statut inconnu)
    // ne produisait AUCUN message — la fenêtre restait ouverte et on recliquait.
    if (!res.ok) { toast(`Projet NON créé : ${res.erreur}`, "error"); return; }
    const d = res.data || {};
    {
      // Si une facture a été jointe, la sauvegarder via PATCH
      if (facture && d.id) {
        if (!(await ecrire("/api/projets", "PATCH", { id: d.id, facture_finale_data: facture.data, facture_finale_type: facture.type }, "Enregistrement"))) return;
      }
      // Créer une fiche client au passage est un effet de bord : on le dit.
      toast(d.client_cree ? `Projet créé · fiche client « ${nouveau.client_nom.trim()} » ajoutée au CRM` : "Projet créé", "success");
      setCreerOuvert(false);
      setNouveau({ nom: "", client_nom: "", client_telephone: "", client_courriel: "", client_adresse: "", adresse_chantier: "", prix_contrat: "", description: "", date_debut: aujourdhuiMontreal(), date_fin_prevue: "", statut: "a_venir", reno_assistance: false });
      setFacture(null);
      charger();
    }
  });

  const traiterFacture = async (file: File) => {
    const tropLourd = fichierTropLourd(file);
    if (tropLourd) { toast(tropLourd, "warning"); return; }
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
  // Pagination de l'AFFICHAGE (50 cartes par page) ; les KPIs restent sur tout le jeu.
  const pg = usePagination(projetsAffiches.length, 50);
  const projetsVisibles = projetsAffiches.slice(pg.debut, pg.fin);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { pg.reset(); }, [recherche, filtre, tri, triAsc]);

  // Considère "en_cours" et "actif" comme des projets en activité
  const estActif = (p: any) => estProjetActif(p.statut);
  // Valeur du contrat : même précédence que le calcul de marge (lib/calculs.ts).
  // Avant, l'affichage ne regardait que budget_estime → un projet saisi avec seulement
  // un prix de contrat affichait « 0 $ » et son bloc de marge disparaissait.
  const valeurContrat = (p: any) => p.prix_contrat || p.budget_estime || 0;
  const stats = {
    actifs: projets.filter(estActif).length,
    budget_total: projets.filter(estActif).reduce((s, p) => s + valeurContrat(p), 0),
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
            <button onClick={() => setTriAsc(!triAsc)} title={triAsc ? "Croissant" : "Décroissant"} className="min-w-10 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded text-sm">
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
        {erreur ? (
          <ErreurChargement erreur={erreur} onReessayer={charger} />
        ) : loading ? (
          <div className="bg-white rounded-lg shadow p-6 text-center text-slate-500">Chargement...</div>
        ) : projetsAffiches.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">🏗️</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucun projet</h3>
            <p className="text-sm text-slate-500 mb-4">Convertis une soumission acceptée en projet, ou crée un projet manuellement.</p>
            <button onClick={() => setCreerOuvert(true)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Nouveau projet</button>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projetsVisibles.map((p) => (
              <Link key={p.id} href={`/projets/${p.id}`} prefetch onMouseEnter={() => prefetchProjet(p.id)} onTouchStart={() => prechargerDiffere(() => prefetchProjet(p.id))} className="group relative bg-white rounded-lg shadow hover:shadow-lg transition p-4 space-y-2">
                <button
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!confirm(`Supprimer définitivement « ${p.nom} » ?\n\n⚠️ Irréversible.`)) return;
                    // La raison du refus s'affiche (ecrire), pas un « Erreur suppression » muet.
                    if (!(await ecrire(`/api/projets?id=${p.id}`, "DELETE", undefined, "Suppression du projet"))) return;
                    toast(`Projet « ${p.nom} » supprimé`, "success"); charger();
                  }}
                  className="min-w-10 min-h-10 flex items-center justify-center absolute top-2 right-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition bg-red-100 hover:bg-red-200 text-red-700 rounded-full w-10 h-10 flex items-center justify-center text-sm z-10"
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
                {valeurContrat(p) > 0 && (
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span>Budget : <strong>{formatCAD(valeurContrat(p))}</strong></span>
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

                {p.marge !== undefined && valeurContrat(p) > 0 && (() => {
                  // Rentabilité AVANT TAXES : les taxes perçues ne sont pas un revenu.
                  // `cout_total` est déjà avant taxes ; on doit donc comparer au revenu
                  // avant taxes (sinon le profit net est surestimé d'environ 13 %).
                  const revenu = p.revenu_avant_taxes ?? ((p.revenu || valeurContrat(p)) / 1.14975);
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
          <div className="bg-white rounded-lg shadow">
            <Pagination total={projetsAffiches.length} page={pg.page} pageSize={pg.pageSize} onPage={pg.setPage} onPageSize={pg.setPageSize} label="projets" />
          </div>
          </>
        )}
      </main>

      {/* Modal créer projet */}
      {creerOuvert && (
        <Modale onClose={() => setCreerOuvert(false)} titre="Nouveau projet" className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
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

            {/* Nouveau client : les coordonnées se saisissent ICI, pas plus tard dans le
                CRM. Avant, seul le nom partait au serveur et la fiche naissait vide —
                impossible d'envoyer un contrat ou une relance depuis le projet sans
                retourner la compléter. Le bloc n'apparaît que si le nom saisi ne
                correspond à aucune fiche existante. */}
            {(() => {
              const saisi = nouveau.client_nom.trim().toLowerCase();
              if (!saisi) return null;
              const existe = clientsExistants.some((c: any) => (c.nom || "").trim().toLowerCase() === saisi);
              if (existe) {
                return (
                  <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2 -mt-1">
                    ✓ Client existant — le projet sera rattaché à sa fiche.
                  </p>
                );
              }
              return (
                <div className="border-2 border-amber-200 bg-amber-50 rounded-lg p-3 space-y-2 -mt-1">
                  <div className="text-xs font-bold text-amber-900">
                    ✨ Nouveau client « {nouveau.client_nom.trim()} » — sa fiche sera créée avec le projet
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input label="Téléphone" value={nouveau.client_telephone} onChange={(v) => setNouveau({ ...nouveau, client_telephone: v })} placeholder="450-555-1234" />
                    <Input label="Courriel" value={nouveau.client_courriel} onChange={(v) => setNouveau({ ...nouveau, client_courriel: v })} placeholder="client@exemple.com" />
                  </div>
                  <Input label="Adresse du client" value={nouveau.client_adresse} onChange={(v) => setNouveau({ ...nouveau, client_adresse: v })} placeholder="Laisser vide = même que l'adresse du chantier" />
                  <p className="text-[10px] text-amber-800">Facultatif, mais sans courriel ni téléphone tu ne pourras ni relancer ce client ni lui envoyer un contrat depuis l'app.</p>
                </div>
              );
            })()}

            <Input label="Adresse chantier" value={nouveau.adresse_chantier} onChange={(v) => setNouveau({ ...nouveau, adresse_chantier: v })} />
            {/* type="text" + inputMode : un champ number refuse « 45 000,50 » (virgule du clavier québécois). */}
            <Input label="💰 Prix total du contrat $ *" value={nouveau.prix_contrat} onChange={(v) => setNouveau({ ...nouveau, prix_contrat: v })} inputMode="decimal" placeholder="Ex. : 45 000,50" />
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
              <button onClick={creer} disabled={verrouCreer.occupe} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-sm font-semibold">{verrouCreer.occupe ? "…" : "Créer"}</button>
            </div>
          </div>
        </Modale>
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

function Input({ label, value, onChange, placeholder, type = "text", inputMode }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; inputMode?: "decimal" | "numeric" | "text" }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 border rounded text-sm" />
    </div>
  );
}

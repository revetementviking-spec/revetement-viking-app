"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import FAB from "@/components/FAB";
import dynamic from "next/dynamic";
import AdresseAutocomplete from "@/components/AdresseAutocomplete";

// Chargé à la demande : le kanban tire @dnd-kit (capteurs, glisser-déposer), inutile
// tant qu'on reste sur la vue « Clients ». Sans SSR : le glisser-déposer n'a de sens
// que dans le navigateur.
const PipelineCRM = dynamic(() => import("@/components/PipelineCRM"), {
  ssr: false,
  loading: () => <div className="bg-white rounded-lg shadow p-6 text-center text-slate-500">Chargement du pipeline...</div>,
});
import { exporterCSV } from "@/lib/csv";
import { envoyer, ecrire, lireListe } from "@/lib/envoi";
import { aujourdhuiMontreal } from "@/lib/date";
import { useVerrou } from "@/lib/verrou";
import ErreurChargement from "@/components/ErreurChargement";
import Modale from "@/components/Modale";
import Pagination, { usePagination } from "@/components/Pagination";

const STATUTS_CRM: Record<string, { label: string; couleur: string }> = {
  prospect: { label: "Prospect", couleur: "bg-amber-100 text-amber-900" },
  actif: { label: "Clients", couleur: "bg-emerald-100 text-emerald-900" },
  inactif: { label: "Inactif", couleur: "bg-slate-200 text-slate-700" },
  perdu: { label: "Perdu", couleur: "bg-red-100 text-red-900" },
};

const SOURCES = ["Référence", "Réno Assistance", "Site web", "Facebook", "Google", "Autre"];

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [projets, setProjets] = useState<any[]>([]);
  const [taches, setTaches] = useState<any[]>([]);
  const [creerOuvert, setCreerOuvert] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState("");
  const [recherche, setRecherche] = useState("");
  const [vue, setVue] = useState<"clients" | "pipeline">("clients");
  const [modeAffichage, setModeAffichage] = useState<"liste" | "tableau">("liste");
  const [triCol, setTriCol] = useState<"nom" | "statut" | "telephone" | "adresse" | "source" | "projets" | "paye">("nom");
  const [triAsc, setTriAsc] = useState(true);
  const [nouveau, setNouveau] = useState({ nom: "", courriel: "", telephone: "", adresse: "", notes: "", statut: "prospect", source: "", tags: "" });
  // Création d'une tâche de suivi rattachée à un client existant (ex: soumission séparée pour un 2e projet).
  const [tacheOuverte, setTacheOuverte] = useState(false);
  const [tacheForm, setTacheForm] = useState<{ client_id: number | null; titre: string; assignee: string; date_echeance: string }>({ client_id: null, titre: "", assignee: "", date_echeance: "" });
  const [tacheRecherche, setTacheRecherche] = useState("");
  const { toast } = useToast();
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = async () => {
    setChargement(true);
    try {
      // Lectures avec filet : un 500 sur /api/clients faisait planter le rendu sur
      // `undefined.filter` ; un réseau coupé laissait la page vide sans explication.
      const [c, p, t] = await Promise.all([
        lireListe("/api/clients"),
        lireListe("/api/projets"),
        lireListe("/api/taches?statut=a_faire"),
      ]);
      if (!c.ok) { setErreur(c.erreur); return; }
      setErreur(null);
      setClients(c.data);
      // Projets et tâches enrichissent les cartes ; leur échec ne bloque pas la liste.
      if (p.ok) setProjets(p.data);
      if (t.ok) setTaches(t.data);
    } finally { setChargement(false); }
  };

  useEffect(() => { charger(); }, []);

  // Verrous par ref (lib/verrou.ts) : deux clics du même instant créaient deux fiches.
  const verrouCreer = useVerrou();
  const creer = () => verrouCreer.executer(async () => {
    if (!nouveau.nom.trim()) { toast("Nom requis", "warning"); return; }
    // Réponse vérifiée : en cas d'échec, RIEN ne se passait — pas de message, la fenêtre
    // restait ouverte, et l'utilisateur recliquait. Depuis que le serveur refuse un
    // courriel malformé ou un statut inconnu, ce silence rendait le refus invisible.
    const r = await envoyer("/api/clients", { corps: { ...nouveau, pipeline_stage: "info_1" } });
    if (!r.ok) { toast(`Client NON créé : ${r.erreur}`, "error"); return; }
    toast("Client créé", "success");
    setCreerOuvert(false);
    setNouveau({ nom: "", courriel: "", telephone: "", adresse: "", notes: "", statut: "prospect", source: "", tags: "" });
    charger();
  });

  const supprimer = async (id: number) => {
    if (!confirm("Supprimer ce client ?")) return;
    // Capture une copie pour pouvoir annuler (re-créer côté serveur si Undo)
    const sauvegarde = clients.find((c) => c.id === id);
    // Le serveur refuse (409) si des contrats SIGNÉS sont rattachés : il faut montrer
    // sa raison, pas un « Erreur suppression » qui n'explique rien. envoyer() lit le
    // message même si la réponse n'est pas du JSON (page 401/413 de la plateforme).
    const r = await envoyer(`/api/clients?id=${id}`, { methode: "DELETE" });
    if (!r.ok) { toast(`Suppression refusée : ${r.erreur}`, "error"); return; }
    toast("Client supprimé", "success", {
      action: sauvegarde ? {
        label: "Annuler",
        onClick: async () => {
          try {
            if (!(await ecrire("/api/clients", "POST", sauvegarde, "Enregistrement"))) return;
            toast("Client restauré", "success");
            charger();
          } catch { toast("Restauration échouée", "error"); }
        }
      } : undefined
    });
    charger();
  };

  const verrouTache = useVerrou();
  const creerTache = () => verrouTache.executer(async () => {
    if (!tacheForm.client_id) { toast("Choisis un client", "warning"); return; }
    if (!tacheForm.titre.trim()) { toast("Décris la tâche", "warning"); return; }
    // `r.ok` vérifié (via ecrire) : `(await r.json()).ok` plantait sur un 401/413 non-JSON
    // et cachait la raison d'un refus.
    if (!(await ecrire("/api/client-taches", "POST", { client_id: tacheForm.client_id, titre: tacheForm.titre.trim(), assignee: tacheForm.assignee || null, date_echeance: tacheForm.date_echeance || null }, "Création de la tâche"))) return;
    toast("✓ Tâche créée", "success");
    setTacheOuverte(false);
    setTacheForm({ client_id: null, titre: "", assignee: "", date_echeance: "" });
    setTacheRecherche("");
    charger();
  });

  const projetsParClient = (client_id: number) => projets.filter((p) => p.client_id === client_id);

  const clientsFiltres = useMemo(() => clients.filter((c) => {
    if (filtreStatut && (c.statut || "prospect") !== filtreStatut) return false;
    if (recherche) {
      const q = recherche.toLowerCase();
      return [c.nom, c.courriel, c.telephone, c.adresse, c.tags].filter(Boolean).some((x) => x.toLowerCase().includes(q));
    }
    return true;
  }), [clients, filtreStatut, recherche]);

  // Pagination de l'AFFICHAGE (50 par page) : les compteurs et l'export CSV restent sur
  // le jeu filtré complet. Retour à la page 1 quand un filtre change.
  const pg = usePagination(clientsFiltres.length, 50);
  const clientsVisibles = useMemo(() => clientsFiltres.slice(pg.debut, pg.fin), [clientsFiltres, pg.debut, pg.fin]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { pg.reset(); }, [filtreStatut, recherche, modeAffichage]);

  const compteParStatut = useMemo(() => {
    const c: Record<string, number> = {};
    for (const cl of clients) c[cl.statut || "prospect"] = (c[cl.statut || "prospect"] || 0) + 1;
    return c;
  }, [clients]);

  const tachesEnRetard = taches.filter((t) => t.date_due && t.date_due < aujourdhuiMontreal());

  // Grouper projets par statut
  const projetsParStatut = projets.reduce((acc: any, p: any) => {
    const s = p.statut || "actif";
    if (!acc[s]) acc[s] = [];
    acc[s].push(p);
    return acc;
  }, {});
  const STATUTS_PROJET: Record<string, { label: string; couleur: string; icone: string }> = {
    actif: { label: "Actifs", couleur: "bg-emerald-100 text-emerald-900 border-emerald-300", icone: "🚧" },
    en_pause: { label: "En pause", couleur: "bg-amber-100 text-amber-900 border-amber-300", icone: "⏸️" },
    complete: { label: "Complétés", couleur: "bg-blue-100 text-blue-900 border-blue-300", icone: "✅" },
    annule: { label: "Annulés", couleur: "bg-red-100 text-red-900 border-red-300", icone: "❌" },
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation
        titre="👥 CRM"
        soustitre={`${clients.length} contact(s) · ${projets.length} projet(s) · ${taches.length} tâche(s)`}
      />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* Onglets vue (Clients / Projets) + bouton créer */}
        <div className="flex justify-between items-center flex-wrap gap-2">
          <div className="flex gap-1 bg-white rounded-lg shadow p-1 flex-wrap">
            <button onClick={() => setVue("clients")} className={`px-4 py-2 rounded text-sm font-semibold ${vue === "clients" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>👥 Clients ({clients.length})</button>
            <button onClick={() => setVue("pipeline")} className={`px-4 py-2 rounded text-sm font-semibold ${vue === "pipeline" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>📊 Pipeline</button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setTacheOuverte(true)} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-lg text-sm font-bold shadow">
              📌 Nouvelle tâche
            </button>
            {vue === "clients" && (
              <button onClick={() => setCreerOuvert(true)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold shadow">
                ➕ Nouveau client
              </button>
            )}
          </div>
        </div>

        {/* VUE PIPELINE CRM */}
        {vue === "pipeline" && <PipelineCRM clients={clients} onUpdate={charger} />}

        {/* VUE CLIENTS — version actuelle */}
        {vue === "clients" && <>
        {/* KPIs CRM */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Object.entries(STATUTS_CRM).map(([k, v]) => (
            <button key={k} onClick={() => setFiltreStatut(filtreStatut === k ? "" : k)} className={`${v.couleur} rounded-lg p-3 text-left transition hover:opacity-80 ${filtreStatut === k ? "ring-2 ring-slate-900" : ""}`}>
              <div className="text-xs uppercase font-semibold opacity-75">{v.label}</div>
              <div className="text-2xl font-bold">{compteParStatut[k] || 0}</div>
            </button>
          ))}
          <div className={`rounded-lg p-3 ${tachesEnRetard.length > 0 ? "bg-red-100 text-red-900" : "bg-blue-100 text-blue-900"}`}>
            <div className="text-xs uppercase font-semibold opacity-75">Tâches en retard</div>
            <div className="text-2xl font-bold">{tachesEnRetard.length}</div>
          </div>
        </div>

        {/* Tâches en cours */}
        {taches.length > 0 && (
          <section className="bg-white rounded-lg shadow p-4 md:p-5">
            <div className="flex justify-between items-center mb-3">
              <h2 className="font-semibold">📌 Tâches ouvertes ({taches.length})</h2>
            </div>
            <div className="space-y-1">
              {taches.slice(0, 8).map((t) => {
                const client = clients.find((c) => c.id === t.client_id);
                const enRetard = t.date_due && t.date_due < aujourdhuiMontreal();
                return (
                  <div key={t.id} className={`flex items-center gap-2 p-2 rounded ${enRetard ? "bg-red-50 border border-red-200" : "bg-slate-50"}`}>
                    <button
                      onClick={async () => { if (!(await ecrire("/api/taches", "PATCH", { id: t.id, statut: "complete" }, "Enregistrement"))) return; toast("Tâche fermée ✓", "success"); charger(); }}
                      className="w-10 h-10 rounded border-2 border-slate-400 hover:bg-emerald-500 hover:border-emerald-500 hover:text-white font-bold text-sm flex items-center justify-center transition flex-shrink-0"
                      title="Marquer comme faite"
                    >✓</button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{t.titre}</div>
                      {client && <a href={`/clients/${t.client_id}`} className="text-xs text-blue-600 hover:underline">{client.nom}</a>}
                    </div>
                    {t.date_due && <span className={`text-xs ${enRetard ? "text-red-700 font-bold" : "text-slate-600"} whitespace-nowrap`}>{enRetard ? "⚠️ " : ""}{t.date_due}</span>}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Recherche + toggle Liste/Tableau */}
        <div className="flex gap-2 flex-wrap items-center">
          <input type="search" placeholder="🔍 Rechercher (nom, courriel, téléphone, tag)..." value={recherche} onChange={(e) => setRecherche(e.target.value)} className="flex-1 min-w-48 px-3 py-2 border rounded text-sm" />
          <div className="flex gap-1 bg-white border rounded-lg p-1">
            <button onClick={() => setModeAffichage("liste")} className={`px-3 py-1.5 rounded text-xs font-semibold ${modeAffichage === "liste" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>📋 Liste</button>
            <button onClick={() => setModeAffichage("tableau")} className={`px-3 py-1.5 rounded text-xs font-semibold ${modeAffichage === "tableau" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>📊 Tableau</button>
          </div>
          {filtreStatut && <button onClick={() => setFiltreStatut("")} className="px-3 py-2 bg-slate-200 hover:bg-slate-300 rounded text-xs font-semibold">✕ Filtre {STATUTS_CRM[filtreStatut].label}</button>}
          <button
            onClick={() => {
              const rows = clientsFiltres.map((c) => ({
                nom: c.nom, telephone: c.telephone || "", courriel: c.courriel || "",
                adresse: c.adresse || "", statut: c.statut || "", source: c.source || "",
                tags: c.tags || "", notes: (c.notes || "").replace(/\n/g, " "),
              }));
              exporterCSV(`clients-${aujourdhuiMontreal()}`, rows);
              toast(`✓ ${rows.length} contact(s) exporté(s)`, "success");
            }}
            className="px-3 py-2 bg-slate-700 hover:bg-slate-800 text-white rounded text-xs font-semibold"
            title="Exporter en CSV (compatible Excel / Numbers)"
          >📊 Exporter CSV</button>
        </div>

        {erreur ? (
          <ErreurChargement erreur={erreur} onReessayer={charger} />
        ) : chargement && clients.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-6 text-center text-slate-500">Chargement...</div>
        ) : clientsFiltres.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">👥</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucun contact</h3>
            <button onClick={() => setCreerOuvert(true)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Premier client</button>
          </div>
        ) : modeAffichage === "tableau" ? (
          (() => {
            const trier = (col: any) => { if (triCol === col) setTriAsc(!triAsc); else { setTriCol(col); setTriAsc(true); } };
            const mult = triAsc ? 1 : -1;
            const cmp = (a: any, b: any) => {
              const va = (() => { switch (triCol) {
                case "nom": return (a.nom || "").toLowerCase();
                case "statut": return a.statut || "";
                case "telephone": return a.telephone || "";
                case "adresse": return (a.adresse || "").toLowerCase();
                case "source": return a.source || "";
                case "projets": return projetsParClient(a.id).length;
                case "paye": return projetsParClient(a.id).reduce((s, p) => s + (p.total_paye || 0), 0);
              }})();
              const vb = (() => { switch (triCol) {
                case "nom": return (b.nom || "").toLowerCase();
                case "statut": return b.statut || "";
                case "telephone": return b.telephone || "";
                case "adresse": return (b.adresse || "").toLowerCase();
                case "source": return b.source || "";
                case "projets": return projetsParClient(b.id).length;
                case "paye": return projetsParClient(b.id).reduce((s, p) => s + (p.total_paye || 0), 0);
              }})();
              if (typeof va === "number" && typeof vb === "number") return mult * (va - vb);
              return mult * String(va).localeCompare(String(vb));
            };
            // Tri sur le jeu filtré complet, puis fenêtre de la page courante.
            const listeTriee = [...clientsFiltres].sort(cmp).slice(pg.debut, pg.fin);
            const Th = ({ k, label, align }: { k: any; label: string; align?: "right" }) => (
              <th onClick={() => trier(k)} className={`p-2 cursor-pointer select-none hover:bg-slate-200 ${align === "right" ? "text-right" : "text-left"}`}>
                {label} {triCol === k && <span className="text-emerald-600">{triAsc ? "▲" : "▼"}</span>}
              </th>
            );
            return (
              <section className="bg-white rounded-lg shadow overflow-x-auto">
                <table className="w-full text-sm min-w-max">
                  <thead className="bg-slate-100 text-xs uppercase">
                    <tr>
                      <Th k="nom" label="Nom" />
                      <Th k="statut" label="Statut" />
                      <Th k="telephone" label="Téléphone" />
                      <th className="p-2 text-left">Courriel</th>
                      <Th k="adresse" label="Adresse" />
                      <Th k="source" label="Source" />
                      <th className="p-2 text-left">Tags</th>
                      <Th k="projets" label="Projets" align="right" />
                      <Th k="paye" label="Encaissé" align="right" />
                      <th className="p-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listeTriee.map((c) => {
                      const pc = projetsParClient(c.id);
                      const totalPaye = pc.reduce((s, p) => s + (p.total_paye || 0), 0);
                      const statutInfo = STATUTS_CRM[c.statut || "prospect"];
                      return (
                        <tr key={c.id} className="border-t hover:bg-slate-50">
                          <td className="p-2 font-semibold"><a href={`/clients/${c.id}`} className="text-slate-900 hover:underline">{c.nom}</a></td>
                          <td className="p-2"><span className={`text-[10px] px-2 py-0.5 rounded ${statutInfo.couleur}`}>{statutInfo.label}</span></td>
                          <td className="p-2 whitespace-nowrap">{c.telephone ? <a href={`tel:${c.telephone}`} className="text-blue-600 hover:underline">{c.telephone}</a> : <span className="text-slate-300">—</span>}</td>
                          <td className="p-2 max-w-[200px] truncate">{c.courriel ? <a href={`mailto:${c.courriel}`} className="text-blue-600 hover:underline">{c.courriel}</a> : <span className="text-slate-300">—</span>}</td>
                          <td className="p-2 max-w-[220px] truncate text-slate-600">{c.adresse || "—"}</td>
                          <td className="p-2 text-xs text-slate-500">{c.source || "—"}</td>
                          <td className="p-2"><div className="flex flex-wrap gap-1">{c.tags ? c.tags.split(",").slice(0, 3).map((t: string, i: number) => <span key={i} className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{t.trim()}</span>) : <span className="text-slate-300">—</span>}</div></td>
                          <td className="p-2 text-right font-bold">{pc.length}</td>
                          <td className="p-2 text-right font-bold text-emerald-700 whitespace-nowrap">{formatCAD(totalPaye)}</td>
                          <td className="p-2 text-right whitespace-nowrap">
                            <a href={`/clients/${c.id}`} className="text-xs text-emerald-700 hover:underline">✏️ Ouvrir</a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Pagination total={clientsFiltres.length} page={pg.page} pageSize={pg.pageSize} onPage={pg.setPage} onPageSize={pg.setPageSize} label="contacts" />
              </section>
            );
          })()
        ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {clientsVisibles.map((c) => {
              const pc = projetsParClient(c.id);
              const tachesClient = taches.filter((t) => t.client_id === c.id);
              const totalPaye = pc.reduce((s, p) => s + (p.total_paye || 0), 0);
              const statutInfo = STATUTS_CRM[c.statut || "prospect"];
              return (
                <a key={c.id} href={`/clients/${c.id}`} className="bg-white rounded-lg shadow hover:shadow-lg transition p-4 space-y-2 block">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-900 truncate">{c.nom}</div>
                      {c.adresse && <div className="text-xs text-slate-500 truncate">📍 {c.adresse}</div>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${statutInfo.couleur}`}>{statutInfo.label}</span>
                  </div>
                  <div className="text-xs space-y-0.5">
                    {c.telephone && <div onClick={(e) => e.stopPropagation()}>📞 <a href={`tel:${c.telephone}`} className="inline-flex items-center min-h-10 text-blue-600 hover:underline">{c.telephone}</a></div>}
                    {c.courriel && <div onClick={(e) => e.stopPropagation()}>✉️ <a href={`mailto:${c.courriel}`} className="inline-flex items-center min-h-10 text-blue-600 hover:underline truncate">{c.courriel}</a></div>}
                  </div>
                  {c.tags && <div className="flex gap-1 flex-wrap">{c.tags.split(",").map((t: string, i: number) => <span key={i} className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{t.trim()}</span>)}</div>}
                  <div className="pt-2 border-t text-xs flex justify-between">
                    <span>{pc.length} projet(s)</span>
                    <span className="text-emerald-700 font-bold">{formatCAD(totalPaye)}</span>
                  </div>
                  {tachesClient.length > 0 && <div className="text-[10px] text-amber-700">📌 {tachesClient.length} tâche(s) ouverte(s)</div>}
                </a>
              );
            })}
          </div>
          <div className="bg-white rounded-lg shadow">
            <Pagination total={clientsFiltres.length} page={pg.page} pageSize={pg.pageSize} onPage={pg.setPage} onPageSize={pg.setPageSize} label="contacts" />
          </div>
          </>
        )}
        </>}
      </main>

      {creerOuvert && (
        <Modale onClose={() => setCreerOuvert(false)} titre="Nouveau client" className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Nouveau client</h3>
            <In label="Nom *" v={nouveau.nom} o={(v) => setNouveau({ ...nouveau, nom: v })} />
            <div className="grid grid-cols-2 gap-2">
              <In label="Téléphone" v={nouveau.telephone} o={(v) => setNouveau({ ...nouveau, telephone: v })} />
              <In label="Courriel" v={nouveau.courriel} o={(v) => setNouveau({ ...nouveau, courriel: v })} />
            </div>
            <AdresseAutocomplete label="Adresse" value={nouveau.adresse} onChange={(v) => setNouveau({ ...nouveau, adresse: v })} placeholder="Commence à taper l'adresse…" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Statut</label>
                <select value={nouveau.statut} onChange={(e) => setNouveau({ ...nouveau, statut: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  {Object.entries(STATUTS_CRM).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Source</label>
                <select value={nouveau.source} onChange={(e) => setNouveau({ ...nouveau, source: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  <option value="">—</option>
                  {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <In label="Tags (séparés par virgule)" v={nouveau.tags} o={(v) => setNouveau({ ...nouveau, tags: v })} />
            <In label="Notes" v={nouveau.notes} o={(v) => setNouveau({ ...nouveau, notes: v })} />
            <div className="flex gap-2 justify-end pt-2 sticky bottom-0 bg-white">
              <button onClick={() => setCreerOuvert(false)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={creer} disabled={verrouCreer.occupe} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-sm font-bold">{verrouCreer.occupe ? "…" : "Créer"}</button>
            </div>
          </div>
        </Modale>
      )}

      {tacheOuverte && (() => {
        const clientSel = clients.find((c) => c.id === tacheForm.client_id);
        const liste = (tacheRecherche
          ? clients.filter((c) => [c.nom, c.adresse, c.courriel, c.telephone].filter(Boolean).some((x: string) => x.toLowerCase().includes(tacheRecherche.toLowerCase())))
          : clients
        ).slice(0, 30);
        return (
          <Modale onClose={() => setTacheOuverte(false)} titre="Nouvelle tâche de suivi" className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
            <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold">📌 Nouvelle tâche de suivi</h3>
              <p className="text-xs text-slate-500">Rattache un suivi à un client existant — utile pour une 2ᵉ soumission / un autre projet du même client.</p>

              {/* Sélecteur de client (inclut les anciens clients) */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Client *</label>
                {clientSel ? (
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border rounded bg-emerald-50">
                    <span className="font-semibold text-sm truncate">{clientSel.nom}</span>
                    <button onClick={() => { setTacheForm((f) => ({ ...f, client_id: null })); setTacheRecherche(""); }} className="text-xs text-slate-500 hover:text-red-600">changer</button>
                  </div>
                ) : (
                  <>
                    <input type="search" autoFocus placeholder="🔍 Chercher un client (nom, adresse…)" value={tacheRecherche} onChange={(e) => setTacheRecherche(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" />
                    <div className="mt-1 max-h-40 overflow-y-auto border rounded divide-y">
                      {liste.length === 0 ? <div className="p-2 text-xs text-slate-400 italic">Aucun client</div> : liste.map((c) => (
                        <button key={c.id} onClick={() => setTacheForm((f) => ({ ...f, client_id: c.id }))} className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-sm">
                          <div className="font-medium truncate">{c.nom}</div>
                          {c.adresse && <div className="text-[11px] text-slate-500 truncate">{c.adresse}</div>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <In label="Tâche *" v={tacheForm.titre} o={(v) => setTacheForm((f) => ({ ...f, titre: v }))} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Assignée à</label>
                  <select value={tacheForm.assignee} onChange={(e) => setTacheForm((f) => ({ ...f, assignee: e.target.value }))} className="w-full px-3 py-2 border rounded text-sm bg-white">
                    <option value="">—</option>
                    <option value="Francis">Francis</option>
                    <option value="Gabriel">Gabriel</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Échéance</label>
                  <input type="date" value={tacheForm.date_echeance} onChange={(e) => setTacheForm((f) => ({ ...f, date_echeance: e.target.value }))} className="w-full px-3 py-2 border rounded text-sm" />
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => setTacheOuverte(false)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
                <button onClick={creerTache} disabled={verrouTache.occupe || !tacheForm.client_id || !tacheForm.titre.trim()} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded text-sm font-bold disabled:opacity-50">{verrouTache.occupe ? "…" : "Créer la tâche"}</button>
              </div>
            </div>
          </Modale>
        );
      })()}

      <FAB onSuccess={charger} />
    </div>
  );
}

function In({ label, v, o }: { label: string; v: string; o: (v: string) => void }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="text" value={v} onChange={(e) => o(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}

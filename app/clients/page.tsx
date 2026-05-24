"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import FAB from "@/components/FAB";

const STATUTS_CRM: Record<string, { label: string; couleur: string }> = {
  prospect: { label: "Prospect", couleur: "bg-amber-100 text-amber-900" },
  actif: { label: "Client actif", couleur: "bg-emerald-100 text-emerald-900" },
  inactif: { label: "Inactif", couleur: "bg-slate-200 text-slate-700" },
  perdu: { label: "Perdu", couleur: "bg-red-100 text-red-900" },
};

const SOURCES = ["Référence", "Site web", "Facebook", "Google", "Bouche-à-oreille", "Salon/Foire", "Autre"];

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [projets, setProjets] = useState<any[]>([]);
  const [taches, setTaches] = useState<any[]>([]);
  const [creerOuvert, setCreerOuvert] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState("");
  const [recherche, setRecherche] = useState("");
  const [nouveau, setNouveau] = useState({ nom: "", courriel: "", telephone: "", adresse: "", notes: "", statut: "prospect", source: "", tags: "" });
  const { toast } = useToast();

  const charger = async () => {
    const [c, p, t] = await Promise.all([
      fetch("/api/clients").then((r) => r.json()),
      fetch("/api/projets").then((r) => r.json()),
      fetch("/api/taches?statut=a_faire").then((r) => r.json()).catch(() => []),
    ]);
    setClients(c);
    setProjets(p);
    setTaches(t);
  };

  useEffect(() => { charger(); }, []);

  const creer = async () => {
    if (!nouveau.nom.trim()) { toast("Nom requis", "warning"); return; }
    const r = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(nouveau) });
    if ((await r.json()).ok) {
      toast("Client créé", "success");
      setCreerOuvert(false);
      setNouveau({ nom: "", courriel: "", telephone: "", adresse: "", notes: "", statut: "prospect", source: "", tags: "" });
      charger();
    }
  };

  const supprimer = async (id: number) => {
    if (!confirm("Supprimer ce client ?")) return;
    await fetch(`/api/clients?id=${id}`, { method: "DELETE" });
    charger();
  };

  const projetsParClient = (client_id: number) => projets.filter((p) => p.client_id === client_id);

  const clientsFiltres = useMemo(() => clients.filter((c) => {
    if (filtreStatut && (c.statut || "prospect") !== filtreStatut) return false;
    if (recherche) {
      const q = recherche.toLowerCase();
      return [c.nom, c.courriel, c.telephone, c.adresse, c.tags].filter(Boolean).some((x) => x.toLowerCase().includes(q));
    }
    return true;
  }), [clients, filtreStatut, recherche]);

  const compteParStatut = useMemo(() => {
    const c: Record<string, number> = {};
    for (const cl of clients) c[cl.statut || "prospect"] = (c[cl.statut || "prospect"] || 0) + 1;
    return c;
  }, [clients]);

  const tachesEnRetard = taches.filter((t) => t.date_due && t.date_due < new Date().toISOString().slice(0, 10));

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation
        titre="👥 CRM"
        soustitre={`${clients.length} contact(s) · ${taches.length} tâche(s) ouverte(s)`}
        actions={
          <button onClick={() => setCreerOuvert(true)} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold text-left">
            ➕ Nouveau client
          </button>
        }
      />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
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
            <h2 className="font-semibold mb-3">📌 Tâches ouvertes</h2>
            <div className="space-y-1">
              {taches.slice(0, 5).map((t) => {
                const client = clients.find((c) => c.id === t.client_id);
                const enRetard = t.date_due && t.date_due < new Date().toISOString().slice(0, 10);
                return (
                  <div key={t.id} className={`flex items-center gap-2 p-2 rounded ${enRetard ? "bg-red-50" : "bg-slate-50"}`}>
                    <button onClick={async () => { await fetch("/api/taches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, statut: "complete" }) }); charger(); }} className="w-5 h-5 rounded border-2 hover:bg-emerald-500 hover:border-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{t.titre}</div>
                      {client && <a href={`/clients/${t.client_id}`} className="text-xs text-blue-600 hover:underline">{client.nom}</a>}
                    </div>
                    {t.date_due && <span className={`text-xs ${enRetard ? "text-red-700 font-bold" : "text-slate-600"}`}>{t.date_due}</span>}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Recherche */}
        <div className="flex gap-2 flex-wrap">
          <input type="search" placeholder="🔍 Rechercher (nom, courriel, téléphone, tag)..." value={recherche} onChange={(e) => setRecherche(e.target.value)} className="flex-1 min-w-48 px-3 py-2 border rounded text-sm" />
          {filtreStatut && <button onClick={() => setFiltreStatut("")} className="px-3 py-2 bg-slate-200 hover:bg-slate-300 rounded text-xs font-semibold">✕ Filtre {STATUTS_CRM[filtreStatut].label}</button>}
        </div>

        {clientsFiltres.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">👥</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucun contact</h3>
            <button onClick={() => setCreerOuvert(true)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Premier client</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {clientsFiltres.map((c) => {
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
                    {c.telephone && <div onClick={(e) => e.stopPropagation()}>📞 <a href={`tel:${c.telephone}`} className="text-blue-600 hover:underline">{c.telephone}</a></div>}
                    {c.courriel && <div onClick={(e) => e.stopPropagation()}>✉️ <a href={`mailto:${c.courriel}`} className="text-blue-600 hover:underline truncate">{c.courriel}</a></div>}
                  </div>
                  {c.tags && <div className="flex gap-1 flex-wrap">{c.tags.split(",").map((t: string, i: number) => <span key={i} className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{t.trim()}</span>)}</div>}
                  <div className="pt-2 border-t text-xs flex justify-between">
                    <span>{pc.length} projet(s)</span>
                    <span className="text-emerald-700 font-bold">{formatCAD(totalPaye)}</span>
                  </div>
                  {tachesClient.length > 0 && <div className="text-[10px] text-amber-700">📌 {tachesClient.length} tâche(s) ouverte(s)</div>}
                  <div onClick={(e) => { e.preventDefault(); supprimer(c.id); }} className="text-[10px] text-red-600 text-right cursor-pointer hover:underline">Supprimer</div>
                </a>
              );
            })}
          </div>
        )}
      </main>

      {creerOuvert && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setCreerOuvert(false)}>
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Nouveau client</h3>
            <In label="Nom *" v={nouveau.nom} o={(v) => setNouveau({ ...nouveau, nom: v })} />
            <div className="grid grid-cols-2 gap-2">
              <In label="Téléphone" v={nouveau.telephone} o={(v) => setNouveau({ ...nouveau, telephone: v })} />
              <In label="Courriel" v={nouveau.courriel} o={(v) => setNouveau({ ...nouveau, courriel: v })} />
            </div>
            <In label="Adresse" v={nouveau.adresse} o={(v) => setNouveau({ ...nouveau, adresse: v })} />
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
              <button onClick={creer} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">Créer</button>
            </div>
          </div>
        </div>
      )}

      <FAB onSuccess={charger} />
    </div>
  );
}

function In({ label, v, o }: { label: string; v: string; o: (v: string) => void }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="text" value={v} onChange={(e) => o(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}

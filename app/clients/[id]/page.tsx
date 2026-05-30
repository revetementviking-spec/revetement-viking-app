"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import FAB from "@/components/FAB";

const TYPES_INTERACTION = [
  { v: "appel", l: "📞 Appel" },
  { v: "courriel", l: "✉️ Courriel" },
  { v: "rdv", l: "🤝 Rendez-vous" },
  { v: "visite", l: "🏠 Visite chantier" },
  { v: "sms", l: "💬 SMS" },
  { v: "note", l: "📝 Note" },
];

const STATUTS = ["prospect", "actif", "inactif", "perdu"];
const SOURCES = ["Référence", "Réno Assistance", "Site web", "Facebook", "Google", "Autre"];

export default function ClientDetail() {
  const params = useParams();
  const router = useRouter();
  const id = +(params.id as string);
  const { toast } = useToast();

  const [client, setClient] = useState<any>(null);
  const [edition, setEdition] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [interactions, setInteractions] = useState<any[]>([]);
  const [taches, setTaches] = useState<any[]>([]);
  const [projets, setProjets] = useState<any[]>([]);

  const today = new Date().toISOString().slice(0, 10);
  const [iForm, setIForm] = useState({ type: "appel", date: today, sujet: "", note: "", fait_par: "" });
  const [tForm, setTForm] = useState({ titre: "", description: "", date_due: "", priorite: 3, assigne_a: "" });

  const charger = async () => {
    const [c, i, t, p] = await Promise.all([
      fetch("/api/clients").then((r) => r.json()),
      fetch(`/api/interactions?client_id=${id}`).then((r) => r.json()),
      fetch(`/api/taches?client_id=${id}`).then((r) => r.json()),
      fetch("/api/projets").then((r) => r.json()),
    ]);
    const cl = c.find((x: any) => x.id === id);
    setClient(cl);
    if (cl) setEditForm(cl);
    setInteractions(i);
    setTaches(t);
    setProjets(p.filter((x: any) => x.client_id === id));
  };

  useEffect(() => { charger(); }, [id]);

  const enregistrerEdit = async () => {
    await fetch("/api/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...editForm }) });
    toast("Mis à jour", "success");
    setEdition(false);
    charger();
  };

  const changerStatutRapide = async () => {
    await fetch("/api/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, statut: "actif" }) });
    toast("✓ Client marqué actif", "success");
    charger();
  };

  const ajouterInteraction = async () => {
    if (!iForm.sujet && !iForm.note) { toast("Sujet ou note requis", "warning"); return; }
    await fetch("/api/interactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...iForm, client_id: id }) });
    toast("Interaction ajoutée", "success");
    setIForm({ type: "appel", date: today, sujet: "", note: "", fait_par: iForm.fait_par });
    charger();
  };

  const ajouterTache = async () => {
    if (!tForm.titre.trim()) { toast("Titre requis", "warning"); return; }
    await fetch("/api/taches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...tForm, client_id: id }) });
    toast("Tâche ajoutée", "success");
    setTForm({ titre: "", description: "", date_due: "", priorite: 3, assigne_a: "" });
    charger();
  };

  const toggleTache = async (t: any) => {
    const nouveau = t.statut === "complete" ? "a_faire" : "complete";
    await fetch("/api/taches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, statut: nouveau }) });
    charger();
  };

  const supprimerInter = async (iid: number) => {
    if (!confirm("Supprimer ?")) return;
    await fetch(`/api/interactions?id=${iid}`, { method: "DELETE" });
    charger();
  };

  if (!client) return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="Client" />
      <div className="p-12 text-center text-slate-500">Chargement...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre={`👤 ${client.nom}`} soustitre={client.statut || "prospect"} actions={
        <button
          onClick={async () => {
            if (!confirm(`Supprimer définitivement la fiche client « ${client.nom} » ?\n\n⚠️ Action irréversible. Les projets liés ne seront PAS supprimés.`)) return;
            const r = await fetch(`/api/clients?id=${client.id}`, { method: "DELETE" });
            if (r.ok) { toast("Fiche client supprimée", "success"); router.push("/clients"); }
            else toast("Erreur suppression", "error");
          }}
          className="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm font-bold"
          title="Supprimer la fiche client"
        >🗑 Supprimer</button>
      } />

      <main className="max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Colonne gauche: infos + édition */}
        <div className="space-y-4">
          <section className="bg-white rounded-lg shadow p-4 space-y-2">
            {edition ? (
              <>
                <h3 className="font-bold">Modifier</h3>
                <In label="Nom" v={editForm.nom || ""} o={(v) => setEditForm({ ...editForm, nom: v })} />
                <In label="Téléphone" v={editForm.telephone || ""} o={(v) => setEditForm({ ...editForm, telephone: v })} />
                <In label="Courriel" v={editForm.courriel || ""} o={(v) => setEditForm({ ...editForm, courriel: v })} />
                <In label="Adresse" v={editForm.adresse || ""} o={(v) => setEditForm({ ...editForm, adresse: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Statut</label>
                    <select value={editForm.statut || "prospect"} onChange={(e) => setEditForm({ ...editForm, statut: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                      {STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Source</label>
                    <select value={editForm.source || ""} onChange={(e) => setEditForm({ ...editForm, source: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                      <option value="">—</option>
                      {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <In label="Tags" v={editForm.tags || ""} o={(v) => setEditForm({ ...editForm, tags: v })} />
                <In label="Notes" v={editForm.notes || ""} o={(v) => setEditForm({ ...editForm, notes: v })} />
                <div className="flex gap-2">
                  <button onClick={() => setEdition(false)} className="flex-1 px-3 py-2 bg-slate-200 rounded text-sm">Annuler</button>
                  <button onClick={enregistrerEdit} className="flex-1 px-3 py-2 bg-emerald-600 text-white rounded text-sm font-bold">Sauver</button>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between items-start">
                  <h3 className="font-bold">Coordonnées</h3>
                  <button onClick={() => setEdition(true)} className="text-xs text-emerald-700 hover:underline">✏️ Modifier</button>
                </div>
                <div className="text-sm space-y-1">
                  <div>👤 <strong>{client.nom}</strong></div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded font-semibold ${client.statut === "actif" ? "bg-emerald-100 text-emerald-900" : client.statut === "prospect" ? "bg-amber-100 text-amber-900" : "bg-slate-200 text-slate-700"}`}>{client.statut || "prospect"}</span>
                    {client.statut !== "actif" && (
                      <button onClick={changerStatutRapide} className="text-xs text-emerald-700 hover:underline font-semibold">→ Marquer actif</button>
                    )}
                  </div>
                  {client.telephone && <div>📞 <a href={`tel:${client.telephone}`} className="text-blue-600">{client.telephone}</a></div>}
                  {client.courriel && <div>✉️ <a href={`mailto:${client.courriel}`} className="text-blue-600 break-all">{client.courriel}</a></div>}
                  {client.adresse && <div>📍 {client.adresse}</div>}
                  {client.source && <div className="text-xs text-slate-500">Source : {client.source}</div>}
                  {client.tags && <div className="flex gap-1 flex-wrap mt-2">{client.tags.split(",").map((t: string, i: number) => <span key={i} className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">{t.trim()}</span>)}</div>}
                  {client.notes && <div className="text-xs italic text-slate-600 mt-2 p-2 bg-slate-50 rounded">"{client.notes}"</div>}
                </div>
              </>
            )}
          </section>

          {/* Projets du client */}
          <section className="bg-white rounded-lg shadow p-4">
            <h3 className="font-bold mb-2">🏗️ Projets ({projets.length})</h3>
            {projets.length === 0 ? <p className="text-xs text-slate-500 italic">Aucun projet</p> : (
              <div className="space-y-1">
                {projets.map((p) => (
                  <a key={p.id} href={`/projets/${p.id}`} className="block px-2 py-2 bg-slate-50 hover:bg-emerald-50 rounded">
                    <div className="font-semibold text-sm truncate">{p.nom}</div>
                    <div className="text-xs text-slate-500 flex justify-between">
                      <span>{p.statut}</span>
                      <span className={p.marge < 0 ? "text-red-600 font-bold" : "text-emerald-700 font-bold"}>{p.budget_estime > 0 ? `${p.marge_pct.toFixed(0)}%` : "—"}</span>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </section>

          {/* Tâches */}
          <section className="bg-white rounded-lg shadow p-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold">📌 Tâches</h3>
              <span className="text-xs text-slate-500">{taches.filter((t) => t.statut !== "complete").length} ouverte(s) · {taches.filter((t) => t.statut === "complete").length} fermée(s)</span>
            </div>
            <div className="space-y-1 mb-3">
              {taches.length === 0 ? <p className="text-xs text-slate-500 italic">Aucune tâche</p> : taches.map((t) => (
                <div key={t.id} className={`flex items-start gap-2 p-2 rounded ${t.statut === "complete" ? "bg-emerald-50 opacity-70" : "bg-slate-50"}`}>
                  <button onClick={() => toggleTache(t)} className={`w-7 h-7 mt-0.5 rounded border-2 flex-shrink-0 font-bold text-sm flex items-center justify-center ${t.statut === "complete" ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-400 hover:border-emerald-500 hover:bg-emerald-50"}`} title={t.statut === "complete" ? "Réouvrir la tâche" : "Marquer comme faite"}>{t.statut === "complete" ? "✓" : ""}</button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${t.statut === "complete" ? "line-through text-slate-500" : "font-semibold"}`}>{t.titre}</div>
                    {t.date_due && <div className={`text-xs ${t.date_due < today && t.statut !== "complete" ? "text-red-700 font-bold" : "text-slate-500"}`}>📅 {t.date_due}{t.statut === "complete" && t.date_completion ? ` · fait ${t.date_completion}` : ""}</div>}
                  </div>
                  <button onClick={async () => { if (confirm("Supprimer cette tâche ?")) { await fetch(`/api/taches?id=${t.id}`, { method: "DELETE" }); charger(); } }} className="text-xs text-red-500 hover:bg-red-50 px-1 rounded opacity-50 hover:opacity-100" title="Supprimer">✕</button>
                </div>
              ))}
            </div>
            <div className="space-y-2 pt-2 border-t">
              <input type="text" placeholder="Nouvelle tâche..." value={tForm.titre} onChange={(e) => setTForm({ ...tForm, titre: e.target.value })} className="w-full px-2 py-2 border rounded text-sm" />
              <div className="flex gap-1">
                <input type="date" value={tForm.date_due} onChange={(e) => setTForm({ ...tForm, date_due: e.target.value })} className="flex-1 px-2 py-1.5 border rounded text-xs" />
                <button onClick={ajouterTache} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs font-bold">Ajouter</button>
              </div>
            </div>
          </section>
        </div>

        {/* Colonne droite : timeline interactions */}
        <div className="lg:col-span-2 space-y-4">
          <section className="bg-white rounded-lg shadow p-4">
            <h3 className="font-bold mb-3">➕ Nouvelle interaction</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
              {TYPES_INTERACTION.map((t) => (
                <button key={t.v} onClick={() => setIForm({ ...iForm, type: t.v })} className={`px-2 py-2 rounded text-xs font-semibold ${iForm.type === t.v ? "bg-emerald-600 text-white" : "bg-slate-100 hover:bg-slate-200"}`}>{t.l}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <input type="date" value={iForm.date} onChange={(e) => setIForm({ ...iForm, date: e.target.value })} className="px-3 py-2 border rounded text-sm" />
              <input type="text" placeholder="Fait par" value={iForm.fait_par} onChange={(e) => setIForm({ ...iForm, fait_par: e.target.value })} className="px-3 py-2 border rounded text-sm" />
            </div>
            <input type="text" placeholder="Sujet..." value={iForm.sujet} onChange={(e) => setIForm({ ...iForm, sujet: e.target.value })} className="w-full px-3 py-2 border rounded text-sm mb-2" />
            <textarea placeholder="Note / détails..." rows={3} value={iForm.note} onChange={(e) => setIForm({ ...iForm, note: e.target.value })} className="w-full px-3 py-2 border rounded text-sm mb-2" />
            <button onClick={ajouterInteraction} className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-sm">Enregistrer interaction</button>
          </section>

          <section className="bg-white rounded-lg shadow p-4">
            <h3 className="font-bold mb-3">📜 Historique ({interactions.length})</h3>
            {interactions.length === 0 ? <p className="text-sm text-slate-500 italic">Aucune interaction encore. Saisis ton premier appel ou rendez-vous.</p> : (
              <div className="space-y-3">
                {interactions.map((i) => {
                  const t = TYPES_INTERACTION.find((x) => x.v === i.type);
                  return (
                    <div key={i.id} className="border-l-4 border-emerald-500 pl-3 py-1">
                      <div className="flex justify-between items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-slate-500">{i.date} · {t?.l || i.type}{i.fait_par ? ` · ${i.fait_par}` : ""}</div>
                          {i.sujet && <div className="font-semibold text-sm">{i.sujet}</div>}
                          {i.note && <div className="text-sm text-slate-700 whitespace-pre-wrap">{i.note}</div>}
                        </div>
                        <button onClick={() => supprimerInter(i.id)} className="text-xs text-red-600 hover:underline">✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </main>
      <FAB />
    </div>
  );
}

function In({ label, v, o }: { label: string; v: string; o: (v: string) => void }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="text" value={v} onChange={(e) => o(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";

const PERSONNES = ["Francis", "Gabriel"];
const PRIORITES = [
  { v: 5, l: "🔥 Urgente", c: "bg-red-100 text-red-800" },
  { v: 4, l: "⬆️ Haute", c: "bg-orange-100 text-orange-800" },
  { v: 3, l: "Normale", c: "bg-slate-100 text-slate-600" },
  { v: 2, l: "⬇️ Basse", c: "bg-slate-100 text-slate-400" },
];
const RECURRENCES = [
  { v: "", l: "Aucune (une seule fois)" },
  { v: "quotidien", l: "🔁 Tous les jours" },
  { v: "hebdo", l: "🔁 Chaque semaine" },
  { v: "2sem", l: "🔁 Aux 2 semaines" },
  { v: "mensuel", l: "🔁 Chaque mois" },
];
const RECUR_COURT: Record<string, string> = { quotidien: "🔁 quotidienne", hebdo: "🔁 hebdo", "2sem": "🔁 2 sem", mensuel: "🔁 mensuelle" };

const FORM_VIDE = { titre: "", description: "", assigne_a: "", date_due: "", priorite: 3, recurrence: "" };

export default function TachesPage() {
  const [taches, setTaches] = useState<any[]>([]);
  const [form, setForm] = useState({ ...FORM_VIDE });
  const [detailsOuverts, setDetailsOuverts] = useState(false);
  const [filtreAssigne, setFiltreAssigne] = useState("");
  const [voirCompletees, setVoirCompletees] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const { toast } = useToast();

  const charger = async () => {
    const d = await fetch("/api/taches").then((r) => r.json()).catch(() => []);
    setTaches(Array.isArray(d) ? d : []);
  };
  useEffect(() => { charger(); }, []);

  const creer = async () => {
    if (!form.titre.trim()) { toast("Écris la tâche", "warning"); return; }
    const r = await fetch("/api/taches", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, titre: form.titre.trim(), assigne_a: form.assigne_a || null, date_due: form.date_due || null }),
    });
    if ((await r.json()).id) {
      toast("✓ Tâche ajoutée", "success");
      setForm({ ...FORM_VIDE });
      setDetailsOuverts(false);
      charger();
    } else toast("Erreur", "error");
  };

  const terminer = async (t: any) => {
    const r = await fetch("/api/taches", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, statut: "complete" }),
    }).then((x) => x.json());
    toast(r.prochaine ? "✓ Faite — prochaine occurrence créée 🔁" : "✓ Tâche complétée", "success");
    charger();
  };
  const rouvrir = async (t: any) => {
    await fetch("/api/taches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, statut: "a_faire", date_completion: null }) });
    charger();
  };
  const supprimer = async (t: any) => {
    if (!confirm(`Supprimer « ${t.titre} » ?`)) return;
    await fetch(`/api/taches?id=${t.id}`, { method: "DELETE" });
    charger();
  };
  const reassigner = async (t: any, who: string) => {
    await fetch("/api/taches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, assigne_a: who || null }) });
    charger();
  };
  const sauverEdition = async () => {
    if (!editing?.titre?.trim()) { toast("Titre requis", "warning"); return; }
    await fetch("/api/taches", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editing.id, titre: editing.titre.trim(), description: editing.description || null, date_due: editing.date_due || null, priorite: editing.priorite, recurrence: editing.recurrence || null, assigne_a: editing.assigne_a || null }),
    });
    setEditing(null);
    toast("✓ Tâche modifiée", "success");
    charger();
  };

  const auj = new Date().toISOString().slice(0, 10);
  const filtrees = useMemo(() => taches.filter((t) => !filtreAssigne || t.assigne_a === filtreAssigne), [taches, filtreAssigne]);
  const ouvertes = filtrees.filter((t) => t.statut !== "complete");
  const completees = filtrees.filter((t) => t.statut === "complete");

  const groupes = useMemo(() => ({
    retard: ouvertes.filter((t) => t.date_due && t.date_due < auj),
    aujourdhui: ouvertes.filter((t) => t.date_due === auj),
    avenir: ouvertes.filter((t) => t.date_due && t.date_due > auj),
    sansDate: ouvertes.filter((t) => !t.date_due),
  }), [ouvertes, auj]);

  const Carte = ({ t }: { t: any }) => {
    const prio = PRIORITES.find((p) => p.v === (t.priorite ?? 3));
    const enRetard = t.date_due && t.date_due < auj && t.statut !== "complete";
    return (
      <div className={`bg-white rounded-lg border p-3 flex items-start gap-3 ${enRetard ? "border-red-300" : "border-slate-200"}`}>
        <button
          onClick={() => t.statut === "complete" ? rouvrir(t) : terminer(t)}
          className={`mt-0.5 w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center text-sm font-bold transition ${t.statut === "complete" ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 hover:border-emerald-500 hover:bg-emerald-50"}`}
          title={t.statut === "complete" ? "Rouvrir" : "Marquer faite"}
        >{t.statut === "complete" ? "✓" : ""}</button>

        <div className="flex-1 min-w-0">
          <div className={`font-semibold text-sm ${t.statut === "complete" ? "line-through text-slate-400" : "text-slate-900"}`}>{t.titre}</div>
          {t.description && <div className="text-xs text-slate-500 mt-0.5">{t.description}</div>}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {t.date_due && <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${enRetard ? "bg-red-100 text-red-800" : "bg-blue-50 text-blue-700"}`}>📅 {t.date_due}{enRetard ? " (retard)" : ""}</span>}
            {t.recurrence && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-800 font-semibold">{RECUR_COURT[t.recurrence] || "🔁"}</span>}
            {prio && prio.v !== 3 && <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${prio.c}`}>{prio.l}</span>}
            {t.client_nom && <a href={`/clients/${t.client_id}`} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">👤 {t.client_nom}</a>}
            {t.projet_nom && <a href={`/projets/${t.projet_id}`} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">🏗️ {t.projet_nom}</a>}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <select value={t.assigne_a || ""} onChange={(e) => reassigner(t, e.target.value)} className={`text-[11px] px-1.5 py-1 rounded border bg-white ${t.assigne_a === "Francis" ? "text-blue-700" : t.assigne_a === "Gabriel" ? "text-purple-700" : "text-slate-400"}`} title="Assigner">
            <option value="">— Personne</option>
            {PERSONNES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <div className="flex gap-1">
            <button onClick={() => setEditing({ ...t, recurrence: t.recurrence || "", description: t.description || "", date_due: t.date_due || "", priorite: t.priorite ?? 3, assigne_a: t.assigne_a || "" })} className="text-xs text-slate-500 hover:text-emerald-700" title="Modifier">✏️</button>
            <button onClick={() => supprimer(t)} className="text-xs text-slate-400 hover:text-red-600" title="Supprimer">🗑</button>
          </div>
        </div>
      </div>
    );
  };

  const Section = ({ titre, items, couleur }: { titre: string; items: any[]; couleur: string }) => items.length === 0 ? null : (
    <div className="space-y-2">
      <h2 className={`text-sm font-bold ${couleur}`}>{titre} ({items.length})</h2>
      <div className="space-y-2">{items.map((t) => <Carte key={t.id} t={t} />)}</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="✅ Tâches" soustitre={`${ouvertes.length} à faire${groupes.retard.length ? ` · ${groupes.retard.length} en retard` : ""}`} />
      <main className="max-w-3xl mx-auto p-3 md:p-5 space-y-4">

        {/* Ajout rapide */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-200 p-3 md:p-4">
          <div className="flex gap-2">
            <input
              value={form.titre}
              onChange={(e) => setForm({ ...form, titre: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && !detailsOuverts && creer()}
              placeholder="➕ Nouvelle tâche… (ex: rappeler le client Rydell)"
              className="flex-1 px-3 py-2.5 border rounded-lg text-sm"
            />
            <button onClick={() => setDetailsOuverts(!detailsOuverts)} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm" title="Plus d'options">⚙️</button>
            <button onClick={creer} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold">Ajouter</button>
          </div>

          {detailsOuverts && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t pt-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Assignée à</label>
                <select value={form.assigne_a} onChange={(e) => setForm({ ...form, assigne_a: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  <option value="">— Personne</option>
                  {PERSONNES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Échéance</label>
                <input type="date" value={form.date_due} onChange={(e) => setForm({ ...form, date_due: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Priorité</label>
                <select value={form.priorite} onChange={(e) => setForm({ ...form, priorite: +e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  {PRIORITES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Récurrence</label>
                <select value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  {RECURRENCES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Note (optionnel)</label>
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Détails…" className="w-full px-3 py-2 border rounded text-sm" />
              </div>
            </div>
          )}
        </section>

        {/* Filtre par personne */}
        <div className="flex gap-1 bg-white rounded-lg shadow-sm border p-1 w-fit">
          {[{ v: "", l: "Tous" }, ...PERSONNES.map((p) => ({ v: p, l: p }))].map((f) => (
            <button key={f.v} onClick={() => setFiltreAssigne(f.v)} className={`px-3 py-1.5 rounded text-sm font-semibold ${filtreAssigne === f.v ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{f.l}</button>
          ))}
        </div>

        {ouvertes.length === 0 ? (
          <div className="bg-white rounded-lg border p-10 text-center text-slate-400">
            <div className="text-5xl mb-3">🎉</div>
            <p className="font-semibold text-slate-600">Aucune tâche à faire{filtreAssigne ? ` pour ${filtreAssigne}` : ""}.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <Section titre="🔴 En retard" items={groupes.retard} couleur="text-red-700" />
            <Section titre="📅 Aujourd'hui" items={groupes.aujourdhui} couleur="text-emerald-700" />
            <Section titre="🗓️ À venir" items={groupes.avenir} couleur="text-blue-700" />
            <Section titre="⚪ Sans échéance" items={groupes.sansDate} couleur="text-slate-600" />
          </div>
        )}

        {/* Complétées */}
        {completees.length > 0 && (
          <div>
            <button onClick={() => setVoirCompletees(!voirCompletees)} className="text-sm font-semibold text-slate-500 hover:text-slate-700">
              {voirCompletees ? "▼" : "▶"} ✅ Complétées ({completees.length})
            </button>
            {voirCompletees && <div className="space-y-2 mt-2 opacity-75">{completees.slice(0, 50).map((t) => <Carte key={t.id} t={t} />)}</div>}
          </div>
        )}
      </main>

      {/* Modal édition */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">✏️ Modifier la tâche</h3>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tâche</label>
              <input value={editing.titre} onChange={(e) => setEditing({ ...editing, titre: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Note</label>
              <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Assignée à</label>
                <select value={editing.assigne_a} onChange={(e) => setEditing({ ...editing, assigne_a: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  <option value="">— Personne</option>
                  {PERSONNES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Échéance</label>
                <input type="date" value={editing.date_due} onChange={(e) => setEditing({ ...editing, date_due: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Priorité</label>
                <select value={editing.priorite} onChange={(e) => setEditing({ ...editing, priorite: +e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  {PRIORITES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Récurrence</label>
                <select value={editing.recurrence} onChange={(e) => setEditing({ ...editing, recurrence: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  {RECURRENCES.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={sauverEdition} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">Enregistrer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import Navigation from "@/components/Navigation";
import MicVocal from "@/components/MicVocal";

interface ActionProp { type: string; params: any; resume: string; _statut?: "fait" | "erreur"; }
interface Msg { role: "user" | "assistant"; content: string; outils?: string[]; erreur?: boolean; actions?: ActionProp[]; }

// Mappe une action proposée par Jarvis vers l'endpoint réel (confirmé par l'utilisateur).
async function executerAction(a: ActionProp): Promise<boolean> {
  try {
    if (a.type === "creer_tache") {
      const r = await fetch("/api/taches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a.params) });
      return !!(await r.json()).id;
    }
    if (a.type === "completer_projet") {
      const r = await fetch("/api/projets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: a.params.id, statut: "complete" }) });
      return (await r.json()).ok;
    }
    if (a.type === "creer_depense") {
      const r = await fetch("/api/depenses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a.params) });
      return (await r.json()).ok;
    }
    return false;
  } catch { return false; }
}
const ICONE_ACTION: Record<string, string> = { creer_tache: "✅", completer_projet: "🏁", creer_depense: "💸" };

const SUGGESTIONS = [
  "Quel est mon projet le plus rentable cette année ?",
  "Combien j'ai dépensé ce mois-ci et chez quels fournisseurs ?",
  "Quelle est ma marge moyenne sur les projets actifs ?",
  "Quelles tâches sont en retard ?",
  "Combien d'heures ont été travaillées ce mois par employé ?",
  "Quels extras restent à facturer ?",
  "Quels projets risquent de finir en retard ?",
  "Fais-moi un résumé de la santé financière de l'entreprise.",
];

const NOM_OUTIL: Record<string, string> = {
  apercu_entreprise: "📊 Aperçu", finances_mensuelles: "📅 Finances", projets: "🏗️ Projets",
  depenses: "💸 Dépenses", heures: "⏱️ Heures", taches: "✅ Tâches", clients: "👥 Clients",
  soumissions_stats: "📋 Soumissions", extras: "💲 Extras",
};

// Rendu léger : gras **texte**, puces "- ", sauts de ligne.
function Texte({ t }: { t: string }) {
  return (
    <div className="space-y-1">
      {t.split("\n").map((ligne, i) => {
        const puce = /^\s*[-•]\s+/.test(ligne);
        const contenu = ligne.replace(/^\s*[-•]\s+/, "");
        const parts = contenu.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
          p.startsWith("**") && p.endsWith("**") ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>
        );
        if (ligne.trim() === "") return <div key={i} className="h-1" />;
        return puce
          ? <div key={i} className="flex gap-2 pl-1"><span className="text-emerald-600">•</span><span>{parts}</span></div>
          : <div key={i}>{parts}</div>;
      })}
    </div>
  );
}

export default function JarvisPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  // Question passée en URL (?q=...) depuis le tableau de bord : envoi automatique.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && q.trim()) envoyer(q.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const envoyer = async (q?: string) => {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    const histo = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/jarvis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, historique: histo }),
      });
      const d = await r.json();
      if (d.ok) setMessages((prev) => [...prev, { role: "assistant", content: d.reponse, outils: d.outils, actions: Array.isArray(d.actions) ? d.actions : [] }]);
      else setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ " + (d.error || "Erreur"), erreur: true }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ " + (e?.message || "Erreur réseau"), erreur: true }]);
    } finally { setBusy(false); }
  };

  const confirmer = async (mi: number, ai: number) => {
    const action = messages[mi]?.actions?.[ai];
    if (!action || action._statut) return;
    const ok = await executerAction(action);
    setMessages((prev) => prev.map((m, i) => i !== mi ? m : {
      ...m, actions: m.actions?.map((a, j) => j !== ai ? a : { ...a, _statut: ok ? "fait" : "erreur" }),
    }));
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Navigation titre="🤖 Jarvis" soustitre="Assistant intelligent — pose des questions sur tes données" />

      <main className="flex-1 max-w-3xl w-full mx-auto p-3 md:p-4 flex flex-col">
        <div className="flex-1 space-y-3 pb-4">
          {messages.length === 0 && (
            <div className="text-center py-6">
              <div className="text-5xl mb-2">🤖</div>
              <h2 className="font-bold text-slate-800">Bonjour, je suis Jarvis.</h2>
              <p className="text-sm text-slate-500 mb-4">Je réponds à partir de tes vraies données : projets, finances, dépenses, heures, clients, tâches…</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => envoyer(s)} className="text-sm bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 rounded-lg p-3 text-slate-700 transition">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "user" ? "bg-emerald-600 text-white rounded-br-sm"
                : m.erreur ? "bg-red-50 border border-red-200 text-red-800 rounded-bl-sm"
                : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm"}`}>
                {m.role === "assistant" && !m.erreur ? <Texte t={m.content} /> : <div className="whitespace-pre-wrap">{m.content}</div>}
                {m.actions && m.actions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100 space-y-2">
                    {m.actions.map((a, ai) => (
                      <div key={ai} className="bg-slate-50 border border-slate-200 rounded-lg p-2 flex items-center gap-2">
                        <span className="text-lg">{ICONE_ACTION[a.type] || "⚙️"}</span>
                        <span className="flex-1 text-xs text-slate-700">{a.resume}</span>
                        {a._statut === "fait" ? <span className="text-xs font-bold text-emerald-700">✓ Fait</span>
                          : a._statut === "erreur" ? <span className="text-xs font-bold text-red-600">Échec</span>
                          : <button onClick={() => confirmer(i, ai)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold whitespace-nowrap">Confirmer</button>}
                      </div>
                    ))}
                  </div>
                )}
                {m.outils && m.outils.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1">
                    <span className="text-[10px] text-slate-400">Sources :</span>
                    {m.outils.map((o) => <span key={o} className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{NOM_OUTIL[o] || o}</span>)}
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-slate-500 shadow-sm flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.15s]" />
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.3s]" />
                <span className="ml-1">Jarvis analyse tes données…</span>
              </div>
            </div>
          )}
          <div ref={finRef} />
        </div>
      </main>

      {/* Barre de saisie */}
      <div className="sticky bottom-0 bg-white/95 backdrop-blur border-t border-slate-200 p-3">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} title="Nouvelle conversation" className="p-2.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100">🗑</button>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); envoyer(); } }}
            placeholder="Pose ta question… (ex: quel client me doit le plus d'argent ?)"
            rows={1}
            className="flex-1 px-4 py-2.5 border rounded-2xl text-sm resize-none max-h-32 min-h-[44px]"
          />
          <MicVocal taille="sm" onTranscript={(t) => setInput((v) => (v ? v + " " : "") + t)} titre="Dicter la question" />
          <button onClick={() => envoyer()} disabled={busy || !input.trim()} className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-sm font-bold disabled:opacity-40">
            {busy ? "…" : "Envoyer"}
          </button>
        </div>
        <p className="max-w-3xl mx-auto text-[10px] text-slate-400 text-center mt-1.5">Jarvis lit tes données en direct (lecture seule). Vérifie toujours les chiffres importants.</p>
      </div>
    </div>
  );
}

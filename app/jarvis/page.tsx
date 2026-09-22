"use client";

import { useEffect, useRef, useState } from "react";
import Navigation from "@/components/Navigation";
import MicVocal from "@/components/MicVocal";
import { useToast } from "@/components/Toasts";
// Alias : la page a déjà sa propre fonction `envoyer` (la question posée à Jarvis).
import { envoyer as envoyerEcriture } from "@/lib/envoi";

interface ActionProp { type: string; params: any; resume: string; _statut?: "fait" | "erreur"; }
interface PtGraph { label: string; value: number; }
interface CoutIA { total_usd?: number; mois_usd?: number; }
interface Msg { role: "user" | "assistant"; content: string; outils?: string[]; erreur?: boolean; actions?: ActionProp[]; chart?: PtGraph[]; chartTitre?: string; statut?: string; cout?: CoutIA; }

// Mini graphique à barres (marge mensuelle, etc.) — barres au-dessus/dessous de zéro.
function MiniGraph({ data, titre }: { data: PtGraph[]; titre?: string }) {
  if (!data || data.length === 0) return null;
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <div className="mt-2 pt-2 border-t border-slate-100">
      {titre && <div className="text-[10px] font-semibold text-slate-500 mb-1">{titre}</div>}
      <div className="flex items-end gap-1 h-24">
        {data.map((d, i) => {
          const h = (Math.abs(d.value) / maxAbs) * 100;
          const neg = d.value < 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
              <div className={`text-[9px] font-bold ${neg ? "text-red-600" : "text-emerald-700"}`}>{Math.round(d.value / 1000)}k</div>
              <div className={`w-full rounded-t ${neg ? "bg-red-400" : "bg-emerald-500"}`} style={{ height: `${Math.max(2, h * 0.7)}%` }} title={`${d.label}: ${d.value.toLocaleString("fr-CA")} $`} />
              <div className="text-[9px] text-slate-400 mt-0.5">{d.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Mappe une action proposée par Jarvis vers l'endpoint réel (confirmé par l'utilisateur).
// Retourne `true` si l'écriture a réussi, sinon le message d'erreur : l'action refusée
// (401, validation) affichait juste « erreur » sans dire pourquoi.
async function executerAction(a: ActionProp): Promise<true | string> {
  // `r.ok` vérifié (via envoyer) : `(await r.json()).ok` plantait sur un 401/413 non-JSON.
  if (a.type === "creer_tache") {
    const r = await envoyerEcriture<{ id?: number }>("/api/taches", { corps: a.params });
    return r.ok ? (r.data?.id ? true : "réponse inattendue du serveur") : r.erreur || "erreur";
  }
  if (a.type === "completer_projet") {
    const r = await envoyerEcriture("/api/projets", { methode: "PATCH", corps: { id: a.params.id, statut: "complete" } });
    return r.ok ? true : r.erreur || "erreur";
  }
  if (a.type === "creer_depense") {
    // Clé d'idempotence par tentative : un double envoi (réseau qui bégaie, deux
    // confirmations) ne crée qu'une dépense côté serveur.
    const r = await envoyerEcriture("/api/depenses", { corps: a.params, entetes: { "X-Idempotence-Cle": crypto.randomUUID() } });
    return r.ok ? true : r.erreur || "erreur";
  }
  return "action inconnue";
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
  soumissions_stats: "📋 Soumissions", extras: "💲 Extras", factures_impayees: "🧾 Factures",
  paie: "💵 Paie", client_details: "👤 Client", projet_details: "🔍 Projet", recherche: "🔎 Recherche",
  inventaire: "📦 Inventaire", vehicules_assurances: "🚚 Véhicules",
  proposer_creer_tache: "✅ Tâche", proposer_completer_projet: "🏁 Projet", proposer_creer_depense: "💸 Dépense",
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
  const { toast } = useToast();

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  // Question passée en URL (?q=...) depuis le tableau de bord : envoi automatique.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && q.trim()) envoyer(q.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Met à jour le dernier message (le bulle assistant en cours de streaming).
  const majDernier = (patch: (m: Msg) => Partial<Msg>) =>
    setMessages((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      return [...prev.slice(0, -1), { ...last, ...patch(last) }];
    });

  const envoyer = async (q?: string) => {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    const histo = messages.map((m) => ({ role: m.role, content: m.content }));
    // Ajoute la question + une bulle assistant vide qu'on remplit en direct.
    setMessages((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "", statut: "Analyse en cours…" }]);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch("/api/jarvis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, historique: histo }),
      });
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => ({}));
        majDernier(() => ({ content: "⚠️ " + (d.error || `Erreur ${r.status}`), erreur: true, statut: undefined }));
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "", contenu = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const blocs = buf.split("\n\n");
        buf = blocs.pop() || "";
        for (const bloc of blocs) {
          const ev = /event:\s*(.+)/.exec(bloc)?.[1]?.trim();
          const dm = /data:\s*([\s\S]+)/.exec(bloc)?.[1];
          if (!ev || dm == null) continue;
          let data: any; try { data = JSON.parse(dm); } catch { continue; }
          if (ev === "text") { contenu += data.delta || ""; majDernier(() => ({ content: contenu, statut: undefined })); }
          else if (ev === "statut") majDernier((m) => (m.content ? {} : { statut: "🔎 " + (data.names || []).map((n: string) => NOM_OUTIL[n] || n).join(", ") }));
          else if (ev === "outils") majDernier(() => ({ outils: data.names }));
          else if (ev === "actions") majDernier((m) => ({ actions: [...(m.actions || []), ...(data.actions || [])] }));
          else if (ev === "cout") majDernier(() => ({ cout: data }));
          else if (ev === "erreur") majDernier(() => ({ content: "⚠️ " + (data.error || "Erreur"), erreur: true, statut: undefined }));
        }
      }
      if (!contenu) majDernier((m) => (m.erreur ? {} : { content: "Je n'ai pas réussi à formuler une réponse.", statut: undefined }));
    } catch (e: any) {
      majDernier(() => ({ content: "⚠️ " + (e?.message || "Erreur réseau"), erreur: true, statut: undefined }));
    } finally { setBusy(false); }
  };

  const briefing = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const d = await fetch("/api/jarvis/briefing").then((r) => r.json());
      if (d.ok) setMessages((prev) => [...prev, { role: "assistant", content: d.texte, chart: d.chart, chartTitre: d.chartTitre }]);
      else setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ " + (d.error || "Erreur"), erreur: true }]);
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ " + (e?.message || "Erreur"), erreur: true }]);
    } finally { setBusy(false); }
  };

  // Verrou synchrone (lib/verrou.ts) : `action._statut` n'est posé qu'APRÈS la réponse
  // du serveur, donc deux clics sur « Confirmer » dans le même instant créaient deux
  // fois la tâche ou la dépense proposée.
  const enCoursAction = useRef<Set<string>>(new Set());
  const confirmer = async (mi: number, ai: number) => {
    const action = messages[mi]?.actions?.[ai];
    if (!action || action._statut) return;
    const cle = `${mi}:${ai}`;
    if (enCoursAction.current.has(cle)) return;
    enCoursAction.current.add(cle);
    try {
      const res = await executerAction(action);
      const ok = res === true;
      if (!ok) toast(`Action refusée : ${res}`, "error");
      setMessages((prev) => prev.map((m, i) => i !== mi ? m : {
        ...m, actions: m.actions?.map((a, j) => j !== ai ? a : { ...a, _statut: ok ? "fait" : "erreur" }),
      }));
    } finally { enCoursAction.current.delete(cle); }
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
              <p className="text-sm text-slate-500 mb-3">Je réponds à partir de tes vraies données : projets, finances, dépenses, heures, clients, tâches…</p>
              <button onClick={briefing} className="mb-4 px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-bold shadow">📋 Mon briefing du jour</button>
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
                {m.role === "assistant" && !m.erreur ? (
                  m.content ? <Texte t={m.content} /> : (
                    <div className="flex items-center gap-2 text-slate-500">
                      <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" />
                      <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.15s]" />
                      <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce [animation-delay:0.3s]" />
                      <span className="ml-1 text-xs">{m.statut || "Jarvis analyse tes données…"}</span>
                    </div>
                  )
                ) : <div className="whitespace-pre-wrap">{m.content}</div>}
                {m.chart && <MiniGraph data={m.chart} titre={m.chartTitre} />}
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
                {m.cout && (m.cout.total_usd || 0) > 0 && (
                  <div className="mt-1 text-[9px] text-slate-300 text-right" title="Coût estimé de cette réponse (Claude Opus 4.8)">
                    ≈ {(m.cout.total_usd || 0).toFixed(3)} $ US{m.cout.mois_usd != null ? ` · ${(m.cout.mois_usd).toFixed(2)} $ US ce mois` : ""}
                  </div>
                )}
              </div>
            </div>
          ))}

          {busy && !(messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content && !messages[messages.length - 1]?.erreur) && (
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
          <button onClick={briefing} disabled={busy} title="Briefing du jour" className="p-2.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 disabled:opacity-40">📋</button>
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

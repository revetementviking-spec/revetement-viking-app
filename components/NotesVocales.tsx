"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  contexteSoumission: any;
  onAjustements: (a: any[], transcription: string) => void;
}

export default function NotesVocales({ contexteSoumission, onAjustements }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcription, setTranscription] = useState("");
  const [transcriptionLive, setTranscriptionLive] = useState("");
  const [loading, setLoading] = useState(false);
  const [historique, setHistorique] = useState<{ texte: string; date: string; ajustements: any[] }[]>([]);
  const [erreur, setErreur] = useState("");
  const recognitionRef = useRef<any>(null);
  const supported = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    supported.current = !!SR;
    if (!SR) return;
    const r = new SR();
    r.lang = "fr-CA";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    let finalTranscript = "";
    r.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalTranscript += res[0].transcript + " ";
        else interim += res[0].transcript;
      }
      setTranscription(finalTranscript);
      setTranscriptionLive(interim);
    };
    r.onerror = (e: any) => {
      setErreur("Erreur micro: " + e.error);
      setRecording(false);
    };
    r.onend = () => setRecording(false);
    recognitionRef.current = r;
    // Démontage (changement de page en plein enregistrement) : on coupe le micro, comme
    // MicVocal. Sinon la reconnaissance continuait et ses rappels touchaient un état démonté.
    return () => {
      r.onresult = null; r.onerror = null; r.onend = null;
      try { r.abort(); } catch { /* jamais démarrée */ }
      recognitionRef.current = null;
    };
  }, []);

  const demarrer = () => {
    setErreur("");
    setTranscription("");
    setTranscriptionLive("");
    if (!recognitionRef.current) {
      setErreur("Reconnaissance vocale non supportée. Utilise Chrome/Edge.");
      return;
    }
    try {
      recognitionRef.current.start();
      setRecording(true);
    } catch (e: any) {
      setErreur("Impossible de démarrer: " + e.message);
    }
  };

  const arreter = () => {
    if (recognitionRef.current && recording) {
      recognitionRef.current.stop();
      setRecording(false);
    }
  };

  const analyser = async () => {
    const texte = (transcription + " " + transcriptionLive).trim();
    if (!texte) { setErreur("Aucune transcription à analyser"); return; }
    setLoading(true);
    setErreur("");
    try {
      const r = await fetch("/api/notes-vocales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcription: texte, contexte: contexteSoumission }),
      });
      const d = await r.json();
      if (d.error) { setErreur(d.error); return; }
      onAjustements(d.ajustements || [], texte);
      setHistorique((prev) => [...prev, { texte, date: new Date().toLocaleTimeString("fr-CA"), ajustements: d.ajustements || [] }]);
      setTranscription("");
      setTranscriptionLive("");
    } catch (e: any) {
      setErreur(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Bouton flottant */}
      <button
        onClick={() => setOuvert(!ouvert)}
        className={`fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full shadow-xl flex items-center justify-center text-2xl transition-all ${
          ouvert ? "bg-red-500 hover:bg-red-400" : "bg-violet-600 hover:bg-violet-500"
        } text-white`}
        title="Notes vocales chantier"
      >
        {ouvert ? "✕" : "🎙️"}
      </button>

      {/* Panneau */}
      {ouvert && (
        <div className="fixed bottom-24 right-6 z-40 w-96 max-h-[80vh] bg-white rounded-lg shadow-2xl border-2 border-violet-300 overflow-hidden flex flex-col">
          <div className="bg-gradient-to-r from-violet-600 to-purple-600 text-white p-3">
            <h3 className="font-bold flex items-center gap-2">🎙️ Notes vocales chantier</h3>
            <p className="text-xs text-violet-100 mt-1">Décris la complexité, l'IA ajuste la soumission</p>
          </div>

          <div className="p-4 overflow-y-auto flex-1">
            {!supported.current && (
              <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 mb-3">
                ⚠️ Reconnaissance vocale non supportée. Utilise Chrome ou Edge.
              </div>
            )}

            {/* Zone d'enregistrement */}
            <div className={`border-2 rounded-lg p-3 ${recording ? "border-red-500 bg-red-50 animate-pulse" : "border-violet-200 bg-violet-50"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-violet-900">
                  {recording ? "🔴 ENREGISTREMENT EN COURS" : "Prêt à enregistrer"}
                </span>
                {!recording ? (
                  <button onClick={demarrer} disabled={!supported.current} className="px-3 py-1 bg-violet-600 hover:bg-violet-500 text-white rounded text-xs font-semibold disabled:opacity-50">
                    🎙️ Démarrer
                  </button>
                ) : (
                  <button onClick={arreter} className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-semibold">
                    ⏸ Arrêter
                  </button>
                )}
              </div>
              <div className="min-h-[60px] text-sm bg-white rounded p-2 text-slate-800">
                {transcription}
                <span className="text-slate-400 italic">{transcriptionLive}</span>
                {!transcription && !transcriptionLive && (
                  <span className="text-slate-400 italic text-xs">
                    Parle : "Le pignon avant est plus complexe que prévu, ça va prendre 5h de plus", "Pas d'espace pour échafaudage, il faut le déplacer 6 fois"...
                  </span>
                )}
              </div>
            </div>

            {transcription && !recording && (
              <button
                onClick={analyser}
                disabled={loading}
                className="w-full mt-3 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold text-sm disabled:opacity-50"
              >
                {loading ? "⏳ Analyse IA..." : "✨ Analyser et appliquer à la soumission"}
              </button>
            )}

            {erreur && <div className="mt-2 text-xs text-red-700">{erreur}</div>}

            {/* Historique des notes appliquées */}
            {historique.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-bold text-slate-700 mb-2">Notes appliquées ({historique.length})</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {historique.map((h, i) => (
                    <div key={i} className="bg-emerald-50 border border-emerald-200 rounded p-2 text-xs">
                      <div className="text-slate-500 mb-1">{h.date}</div>
                      <div className="text-slate-800 italic">"{h.texte.slice(0, 100)}{h.texte.length > 100 ? "..." : ""}"</div>
                      {h.ajustements.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {h.ajustements.map((a: any, j: number) => (
                            <div key={j} className="text-emerald-800 font-medium">→ {a.description}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 text-[10px] text-slate-500 border-t pt-2">
              💡 Exemples de phrases : "ajoute 4 heures pour le pignon", "marge à 45%", "accès difficile, +6h mobilisation", "couleur Cèdre Fauve partout"
            </div>
          </div>
        </div>
      )}
    </>
  );
}

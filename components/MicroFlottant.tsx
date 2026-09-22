"use client";

import { useEffect, useRef, useState } from "react";
import { envoyer, lireListe } from "@/lib/envoi";

/** Bouton micro flottant universel : dictée rapide d'une note attachée à un projet.
 *  - Visible en bas à droite sur mobile (et desktop)
 *  - Tap → ouvre une bulle avec dictée Web Speech API
 *  - Sélecteur de projet (auto-rempli avec le dernier projet actif)
 *  - Sauvegarde dans /api/notes-rapides */
export default function MicroFlottant() {
  const [ouvert, setOuvert] = useState(false);
  const [enregistre, setEnregistre] = useState(false);
  const [texte, setTexte] = useState("");
  const [projets, setProjets] = useState<any[]>([]);
  const [projetId, setProjetId] = useState<number | "">("");
  const [statut, setStatut] = useState<"" | "envoi" | "ok" | "erreur">("");
  const recoRef = useRef<any>(null);

  useEffect(() => {
    if (ouvert && projets.length === 0) {
      // ?lite=1 : seul le nom sert au sélecteur ; inutile de recalculer coûts et marges.
      lireListe("/api/projets?statut=actif&lite=1").then((r) => {
        if (!r.ok) return;
        setProjets(r.data);
        if (r.data.length > 0 && !projetId) setProjetId(r.data[0].id);
      });
    }
  }, [ouvert]);

  // Cache le bouton sur certaines pages (login, mode présentation publique)
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const path = window.location.pathname;
    if (path.startsWith("/login") || path.startsWith("/projet/") || path.startsWith("/contrat/") || path.startsWith("/soumission/")) {
      setVisible(false);
    } else setVisible(true);
  }, []);

  const demarrer = async () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert("Dictée vocale non supportée (utilise Chrome ou Edge)"); return; }
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
        flux.getTracks().forEach((t) => t.stop());
      }
    } catch {
      alert("Micro bloqué — clique sur le 🔒 dans la barre d'URL et autorise le micro.");
      return;
    }
    const reco = new SR();
    reco.lang = "fr-CA";
    reco.continuous = true;
    reco.interimResults = true;
    let dejaTraite = 0;
    reco.onresult = (e: any) => {
      let t = "";
      for (let i = dejaTraite; i < e.results.length; i++) {
        if (e.results[i].isFinal) { t += e.results[i][0].transcript + " "; dejaTraite = i + 1; }
      }
      if (t.trim()) setTexte((prev) => (prev ? prev + " " : "") + t.trim());
    };
    reco.onerror = () => setEnregistre(false);
    reco.onend = () => setEnregistre(false);
    try { reco.start(); recoRef.current = reco; setEnregistre(true); }
    catch { setEnregistre(false); }
  };

  const arreter = () => { try { recoRef.current?.stop(); } catch {} setEnregistre(false); };

  const sauvegarder = async () => {
    if (!texte.trim()) return;
    setStatut("envoi");
    // envoyer() ne lève jamais et vérifie `r.ok` ET le corps `{ ok:false }`.
    const r = await envoyer("/api/notes-rapides", { corps: { projet_id: projetId || null, texte, source: "vocal" } });
    if (r.ok) {
      setStatut("ok");
      setTimeout(() => { setOuvert(false); setTexte(""); setStatut(""); }, 1200);
    } else setStatut("erreur");
  };

  if (!visible) return null;

  return (
    <>
      {/* Bouton flottant */}
      {!ouvert && (
        <button
          onClick={() => setOuvert(true)}
          className="fixed bottom-20 right-4 md:bottom-6 md:right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-400 hover:to-emerald-600 text-white text-2xl shadow-lg active:scale-95 transition flex items-center justify-center"
          title="Note vocale rapide"
          aria-label="Ouvrir la note vocale rapide"
        >
          🎤
        </button>
      )}

      {/* Panneau ouvert */}
      {ouvert && (
        <div className="fixed bottom-4 right-4 left-4 md:left-auto md:bottom-6 md:right-6 md:w-96 z-50 bg-white rounded-2xl shadow-2xl border-2 border-emerald-300 p-4 space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-900 flex items-center gap-1">🎤 Note rapide</h3>
            <button onClick={() => { arreter(); setOuvert(false); setTexte(""); setStatut(""); }} className="text-slate-400 hover:text-slate-700 text-xl" aria-label="Fermer">×</button>
          </div>

          {projets.length > 0 && (
            <select value={projetId} onChange={(e) => setProjetId(e.target.value ? +e.target.value : "")} className="w-full px-3 py-2 border rounded text-sm bg-white">
              <option value="">(sans projet — note libre)</option>
              {projets.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
          )}

          <textarea
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder="Parle ou écris ta note ici..."
            rows={4}
            className="w-full px-3 py-2 border rounded text-sm"
          />

          <div className="flex gap-2">
            <button
              onClick={enregistre ? arreter : demarrer}
              className={`flex-1 px-3 py-2 rounded font-bold text-sm transition ${enregistre ? "bg-red-600 hover:bg-red-500 text-white animate-pulse" : "bg-slate-200 hover:bg-slate-300 text-slate-700"}`}
            >
              {enregistre ? "🔴 Arrêter" : "🎤 Dicter"}
            </button>
            <button
              onClick={sauvegarder}
              disabled={!texte.trim() || statut === "envoi"}
              className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-sm disabled:opacity-50"
            >
              {statut === "envoi" ? "⏳" : statut === "ok" ? "✅" : statut === "erreur" ? "⚠️" : "💾 Sauver"}
            </button>
          </div>
          <p className="text-[10px] text-slate-500 text-center">Note rattachée au projet sélectionné · Visible dans son détail</p>
        </div>
      )}
    </>
  );
}

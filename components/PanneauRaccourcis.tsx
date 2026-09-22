"use client";

import { useEffect, useState } from "react";

const RACCOURCIS: { touche: string; description: string; portee: string }[] = [
  { touche: "?", description: "Afficher / fermer ce panneau", portee: "Partout" },
  { touche: "Ctrl + K", description: "Recherche globale (clients, projets, soumissions)", portee: "Partout" },
  { touche: "Ctrl + S", description: "Sauvegarder la soumission en cours", portee: "Formulaire de soumission" },
  { touche: "Esc", description: "Fermer modal / panneau", portee: "Modals" },
  { touche: "Tab", description: "Naviguer entre les champs", portee: "Formulaires" },
];

export default function PanneauRaccourcis() {
  const [ouvert, setOuvert] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore si on est dans un champ texte
      const tag = (e.target as HTMLElement)?.tagName;
      const editable = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;
      if (editable) return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setOuvert((o) => !o);
      } else if (e.key === "Escape") {
        setOuvert(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ouvert) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vk-raccourcis-titre"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={() => setOuvert(false)}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 id="vk-raccourcis-titre" className="text-lg font-bold text-slate-900">⌨️ Raccourcis clavier</h2>
          <button
            onClick={() => setOuvert(false)}
            aria-label="Fermer"
            className="w-8 h-8 rounded hover:bg-slate-100 text-slate-500 text-xl"
          >
            ×
          </button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {RACCOURCIS.map((r) => (
              <tr key={r.touche} className="border-t border-slate-100">
                <td className="py-2 pr-3">
                  <kbd className="font-mono text-xs bg-slate-100 border border-slate-300 rounded px-2 py-0.5 shadow-sm">{r.touche}</kbd>
                </td>
                <td className="py-2 text-slate-800">{r.description}</td>
                <td className="py-2 text-xs text-slate-500 text-right hidden sm:table-cell">{r.portee}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-slate-500 mt-3 text-center">
          Appuie sur <kbd className="font-mono text-xs bg-slate-100 border border-slate-300 rounded px-1.5">?</kbd> pour rouvrir cette aide.
        </p>
      </div>
    </div>
  );
}

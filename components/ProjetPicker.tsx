"use client";

import { useEffect, useRef, useState } from "react";

interface ProjetItem { id: number; nom: string; adresse_chantier?: string; client_nom?: string; statut?: string }

/**
 * Sélecteur de projet cherchable.
 * - Par défaut (champ vide) : n'affiche que les projets EN COURS (statut "actif") → liste courte.
 * - En tapant : cherche dans TOUS les projets fournis (incluant "à venir", etc.) par nom,
 *   adresse de chantier ou nom de client.
 * Le parent décide quels projets sont éligibles via la liste `projets` qu'il passe.
 */
export default function ProjetPicker({ value, onChange, projets, placeholder, className, aucunLabel }: {
  value: number;
  onChange: (id: number) => void;
  projets: ProjetItem[];
  placeholder?: string;
  className?: string;
  aucunLabel?: string; // si fourni, ajoute une entrée "Aucun" (valeur 0)
}) {
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef<HTMLDivElement | null>(null);
  const sel = projets.find((p) => p.id === value);
  const texteAffiche = sel ? `${sel.nom}${sel.client_nom ? ` (${sel.client_nom})` : ""}` : (!value && aucunLabel ? aucunLabel : "");

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOuvert(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const ql = q.trim().toLowerCase();
  const liste = ql
    ? projets.filter((p) => `${p.nom} ${p.adresse_chantier || ""} ${p.client_nom || ""}`.toLowerCase().includes(ql))
    : projets.filter((p) => p.statut === "actif"); // par défaut : en cours seulement

  const tag = (s?: string) => s === "a_venir" ? " · 📅 à venir" : s === "complete" ? " · ✅ complété" : "";

  return (
    <div ref={wrap} className="relative">
      <input
        type="text"
        value={ouvert ? q : texteAffiche}
        onChange={(e) => { setQ(e.target.value); setOuvert(true); }}
        onFocus={() => { setQ(""); setOuvert(true); }}
        placeholder={placeholder || "Projet en cours… (tape un nom ou une adresse)"}
        className={className || "w-full px-3 py-3 border rounded-lg text-sm bg-white"}
        autoComplete="off"
      />
      {ouvert && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-300 rounded-lg shadow-xl z-40 max-h-64 overflow-y-auto">
          {aucunLabel && !ql && (
            <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange(0); setOuvert(false); setQ(""); }}
              className={`block w-full text-left px-3 py-2 text-sm border-b text-slate-600 hover:bg-slate-50 ${value === 0 ? "bg-slate-50" : ""}`}>
              {aucunLabel}
            </button>
          )}
          {liste.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400 italic">{ql ? "Aucun projet trouvé." : "Aucun projet en cours — tape un nom/adresse pour chercher (à venir…)."}</div>
          ) : liste.map((p) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(p.id); setOuvert(false); setQ(""); }}
              className={`block w-full text-left px-3 py-2 text-sm border-b last:border-b-0 hover:bg-emerald-50 ${p.id === value ? "bg-emerald-50" : ""}`}
            >
              <div className="font-semibold text-slate-900 truncate">{p.nom}{p.client_nom ? <span className="font-normal text-slate-500"> · {p.client_nom}</span> : ""}<span className="text-[10px] text-slate-400">{tag(p.statut)}</span></div>
              {p.adresse_chantier && <div className="text-[10px] text-slate-400 truncate">{p.adresse_chantier}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

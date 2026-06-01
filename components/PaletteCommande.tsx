"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Resultat { type: string; id: number | string; titre: string; sous: string }

const ICONES: Record<string, string> = {
  client: "👤",
  projet: "🏗️",
  soumission: "📋",
  contrat: "📝",
  facture: "💰",
  depense: "💸",
};

const ROUTES: Record<string, (id: any) => string> = {
  client: (id) => `/clients/${id}`,
  projet: (id) => `/projets/${id}`,
  soumission: (id) => `/?modifier=${id}`,
  contrat: (id) => `/contrats`,
  facture: (id) => `/finances`,
  depense: (id) => `/depenses`,
};

const NAVIGATION = [
  { titre: "🏠 Tableau de bord", route: "/" },
  { titre: "➕ Nouvelle soumission", route: "/soumissions/nouveau" },
  { titre: "🏗️ Projets", route: "/projets" },
  { titre: "🗺️ Carte des projets", route: "/projets/carte" },
  { titre: "📅 Calendrier projets", route: "/projets/calendrier" },
  { titre: "👥 CRM clients", route: "/clients" },
  { titre: "📋 Soumissions", route: "/soumissions" },
  { titre: "📝 Contrats", route: "/contrats" },
  { titre: "💰 Finances", route: "/finances" },
  { titre: "💵 Paie", route: "/finances/paye" },
  { titre: "💸 Dépenses", route: "/depenses" },
  { titre: "⏱️ Horaire", route: "/heures" },
  { titre: "👷 Employés", route: "/employes" },
  { titre: "📚 Catalogue matériaux", route: "/catalogue" },
  { titre: "🤖 Paramètres IA (règles + documents)", route: "/parametres-ia" },
  { titre: "📦 Inventaire", route: "/inventaire" },
  { titre: "📹 Caméras", route: "/cameras" },
  { titre: "⚙️ Paramètres", route: "/parametres" },
];

export default function PaletteCommande() {
  const [ouvert, setOuvert] = useState(false);
  const [q, setQ] = useState("");
  const [resultats, setResultats] = useState<Resultat[]>([]);
  const [selection, setSelection] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const tBus = useRef<any>(null);

  // Raccourci Ctrl+K / Cmd+K
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOuvert(true);
      } else if (e.key === "Escape" && ouvert) {
        setOuvert(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [ouvert]);

  // Focus à l'ouverture
  useEffect(() => {
    if (ouvert) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQ("");
      setSelection(0);
    }
  }, [ouvert]);

  // Recherche debouncée
  useEffect(() => {
    if (tBus.current) clearTimeout(tBus.current);
    if (q.trim().length < 2) { setResultats([]); return; }
    tBus.current = setTimeout(() => {
      fetch(`/api/recherche?q=${encodeURIComponent(q)}`).then((r) => r.json()).then((d) => {
        setResultats(Array.isArray(d) ? d.slice(0, 20) : []);
        setSelection(0);
      }).catch(() => setResultats([]));
    }, 150);
  }, [q]);

  // Items affichés : navigation filtrée + résultats DB
  const navFiltree = q.trim().length === 0
    ? NAVIGATION
    : NAVIGATION.filter((n) => n.titre.toLowerCase().includes(q.toLowerCase()));
  const items: Array<{ kind: "nav"; titre: string; route: string } | { kind: "data"; res: Resultat }> = [
    ...navFiltree.map((n) => ({ kind: "nav" as const, titre: n.titre, route: n.route })),
    ...resultats.map((r) => ({ kind: "data" as const, res: r })),
  ];

  const allerVers = (item: typeof items[number]) => {
    if (item.kind === "nav") router.push(item.route);
    else {
      const r = ROUTES[item.res.type];
      if (r) router.push(r(item.res.id));
    }
    setOuvert(false);
  };

  if (!ouvert) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[10vh] px-4"
      onClick={() => setOuvert(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setSelection((s) => Math.min(items.length - 1, s + 1)); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setSelection((s) => Math.max(0, s - 1)); }
        else if (e.key === "Enter" && items[selection]) { e.preventDefault(); allerVers(items[selection]); }
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 p-4 border-b border-slate-200">
          <span className="text-2xl">🔎</span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher client, projet, soumission... ou naviguer"
            className="flex-1 outline-none text-base bg-transparent"
          />
          <kbd className="text-[10px] bg-slate-200 text-slate-700 px-2 py-1 rounded font-mono">Esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {items.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              {q.trim().length < 2 ? "Tape au moins 2 caractères..." : "Aucun résultat"}
            </div>
          ) : (
            <div>
              {q.trim().length === 0 && (
                <div className="px-4 pt-3 pb-1 text-[10px] uppercase font-bold text-slate-400">Navigation rapide</div>
              )}
              {items.map((item, i) => (
                <button
                  key={i}
                  onMouseEnter={() => setSelection(i)}
                  onClick={() => allerVers(item)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${i === selection ? "bg-emerald-50 border-l-4 border-emerald-500" : "border-l-4 border-transparent hover:bg-slate-50"}`}
                >
                  {item.kind === "nav" ? (
                    <>
                      <span className="text-base">{item.titre.match(/^[^\s]+/)?.[0] || "→"}</span>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-slate-900">{item.titre.replace(/^[^\s]+\s/, "")}</div>
                        <div className="text-[10px] text-slate-400">{item.route}</div>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="text-base">{ICONES[item.res.type] || "📄"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-900 truncate">{item.res.titre}</div>
                        <div className="text-[11px] text-slate-500 truncate">{item.res.sous}</div>
                      </div>
                      <span className="text-[10px] uppercase text-slate-400">{item.res.type}</span>
                    </>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-2 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-500 flex gap-3 justify-end">
          <span><kbd className="bg-white border px-1.5 py-0.5 rounded font-mono">↑↓</kbd> naviguer</span>
          <span><kbd className="bg-white border px-1.5 py-0.5 rounded font-mono">Enter</kbd> ouvrir</span>
          <span><kbd className="bg-white border px-1.5 py-0.5 rounded font-mono">Esc</kbd> fermer</span>
        </div>
      </div>
    </div>
  );
}

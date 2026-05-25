"use client";

import { useState, useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

interface NavLink {
  href: string;
  label: string;
  icon: string;
}

const LINKS: NavLink[] = [
  { href: "/", label: "Tableau", icon: "📊" },
  { href: "/soumissions/nouveau", label: "Soumission", icon: "➕" },
  { href: "/projets", label: "Projets", icon: "🏗️" },
  { href: "/heures", label: "Horaire", icon: "⏱️" },
  { href: "/clients", label: "CRM", icon: "👥" },
  { href: "/finances/paye", label: "Paie", icon: "💵" },
  { href: "/finances", label: "Finances", icon: "💰" },
];
const LINKS_SECONDAIRES: NavLink[] = [
  { href: "/contrats", label: "Contrats", icon: "📝" },
  { href: "/depenses", label: "Dépenses", icon: "💸" },
  { href: "/soumissions", label: "Liste soum.", icon: "📋" },
  { href: "/employes", label: "Employés", icon: "👷" },
  { href: "/sync", label: "Synchros", icon: "🔄" },
  { href: "/rapports", label: "Rapports", icon: "📈" },
  { href: "/admin/journal", label: "Journal", icon: "📜" },
  { href: "/admin/diagnostic", label: "Diagnostic", icon: "🛠️" },
  { href: "/a-propos", label: "À propos", icon: "ℹ️" },
];

interface Props {
  titre: string;
  soustitre?: string;
  actions?: ReactNode; // boutons spécifiques à la page (Sauver, PDF, Email, etc.)
  badge?: ReactNode; // ex: "✓ Auto-sauvé"
}

export default function Navigation({ titre, soustitre, actions, badge }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [notifs, setNotifs] = useState<{ total: number; relances: number; drive_erreurs: number; taches_ouvertes: number }>({ total: 0, relances: 0, drive_erreurs: 0, taches_ouvertes: 0 });
  const [actionsOuvertes, setActionsOuvertes] = useState(false);
  const [rechercheQ, setRechercheQ] = useState("");
  const [rechercheRes, setRechercheRes] = useState<any[]>([]);
  const [rechercheOuvert, setRechercheOuvert] = useState(false);
  const [dark, setDark] = useState(false);
  const peutRetour = pathname !== "/";

  // Recherche debounced
  useEffect(() => {
    if (!rechercheQ.trim()) { setRechercheRes([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/recherche?q=${encodeURIComponent(rechercheQ)}`).then((r) => r.json()).then(setRechercheRes);
    }, 250);
    return () => clearTimeout(t);
  }, [rechercheQ]);

  // Polling notifications (30s) — pause quand l'onglet est en arrière-plan
  // (économie batterie mobile + requêtes Turso)
  useEffect(() => {
    const charger = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/notifications").then((r) => r.json()).then(setNotifs).catch(() => {});
    };
    charger();
    const id = setInterval(charger, 30000);
    const onVis = () => { if (document.visibilityState === "visible") charger(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  // Ctrl/Cmd+K → focus recherche globale
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        const el = document.getElementById("vk-search-input") as HTMLInputElement | null;
        if (el) { el.focus(); el.select(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Dark mode persistance
  useEffect(() => {
    const saved = typeof window !== "undefined" && localStorage.getItem("vk-theme") === "dark";
    setDark(saved);
    if (saved) document.documentElement.classList.add("vk-dark");
  }, []);
  const toggleDark = () => {
    const nv = !dark;
    setDark(nv);
    document.documentElement.classList.toggle("vk-dark", nv);
    localStorage.setItem("vk-theme", nv ? "dark" : "light");
  };

  const lienResultat = (r: any) =>
    r.type === "client" ? `/clients` :
    r.type === "projet" ? `/projets/${r.id}` :
    r.type === "soumission" ? `/soumissions/${r.id}` : "/";

  return (
    <>
      <header className="bg-slate-900 text-white shadow sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* Bouton retour */}
          {peutRetour && (
            <button
              onClick={() => router.back()}
              className="p-2 rounded hover:bg-slate-700 transition flex-shrink-0"
              title="Retour"
              aria-label="Retour"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}

          {/* Hamburger mobile */}
          <button
            onClick={() => setMenuOuvert(!menuOuvert)}
            className="p-2 rounded hover:bg-slate-700 transition md:hidden flex-shrink-0 relative"
            aria-label={notifs.total > 0 ? `Menu (${notifs.total} notifications)` : "Menu"}
          >
            {notifs.total > 0 && (
              <span className="absolute top-0.5 right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 leading-none">
                {notifs.total > 9 ? "9+" : notifs.total}
              </span>
            )}
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOuvert ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

          {/* Logo Viking */}
          <a href="/" className="flex-shrink-0 hidden sm:block" title="Tableau de bord">
            <img src="/logo-viking.svg" alt="Revêtement Viking" className="h-9 w-9 brightness-0 invert opacity-90 drakkar-animate" />
          </a>

          {/* Titre */}
          <div className="flex-1 min-w-0">
            <h1 className="text-base md:text-xl font-bold flex items-center gap-2 truncate">
              <span className="truncate">{titre}</span>
              {badge && <span className="hidden md:inline-block">{badge}</span>}
            </h1>
            {soustitre && <p className="text-xs text-slate-300 hidden md:block truncate">{soustitre}</p>}
          </div>

          {/* Recherche globale */}
          <div className="hidden md:block relative">
            <input
              id="vk-search-input"
              type="search"
              placeholder="🔍 Rechercher... (Ctrl+K)"
              value={rechercheQ}
              onChange={(e) => { setRechercheQ(e.target.value); setRechercheOuvert(true); }}
              onFocus={() => setRechercheOuvert(true)}
              onBlur={() => setTimeout(() => setRechercheOuvert(false), 200)}
              className="px-3 py-1.5 rounded bg-slate-800 text-white placeholder-slate-400 text-sm w-48 lg:w-64 border border-slate-700 focus:border-emerald-500 outline-none"
            />
            {rechercheOuvert && rechercheRes.length > 0 && (
              <div className="absolute top-full right-0 mt-1 bg-white text-slate-900 rounded-lg shadow-xl border w-72 max-h-80 overflow-y-auto z-50">
                {rechercheRes.map((r, i) => (
                  <a key={i} href={lienResultat(r)} className="block px-3 py-2 hover:bg-slate-100 border-b last:border-b-0">
                    <div className="text-xs text-emerald-700 uppercase font-bold">{r.type}</div>
                    <div className="text-sm font-semibold truncate">{r.titre}</div>
                    {r.sous && <div className="text-xs text-slate-500 truncate">{r.sous}</div>}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Dark mode toggle */}
          <button onClick={toggleDark} className="p-2 rounded hover:bg-slate-700 transition flex-shrink-0 text-lg" title={dark ? "Mode clair" : "Mode sombre"}>
            {dark ? "☀️" : "🌙"}
          </button>

          {/* Liens desktop */}
          <nav className="hidden md:flex gap-1">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className={`px-3 py-2 rounded text-sm transition ${
                  pathname === l.href ? "bg-emerald-600 text-white" : "text-slate-200 hover:bg-slate-700"
                }`}
              >
                <span className="mr-1">{l.icon}</span>
                <span>{l.label}</span>
              </a>
            ))}
          </nav>

          {/* Actions desktop inline */}
          {actions && <div className="hidden lg:flex gap-2 ml-2 border-l border-slate-700 pl-3">{actions}</div>}

          {/* Actions sur tablette/mobile : menu déroulant */}
          {actions && (
            <div className="lg:hidden relative">
              <button
                onClick={() => setActionsOuvertes(!actionsOuvertes)}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-sm font-semibold flex items-center gap-1"
              >
                Actions
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {actionsOuvertes && (
                <div
                  className="absolute right-0 mt-2 bg-white text-slate-900 rounded-lg shadow-xl border p-2 flex flex-col gap-1 min-w-[180px] z-40"
                  onClick={() => setActionsOuvertes(false)}
                >
                  {actions}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Badge mobile */}
        {badge && <div className="md:hidden px-4 pb-2">{badge}</div>}

        {/* Menu mobile */}
        {menuOuvert && (
          <div className="md:hidden bg-slate-800 border-t border-slate-700">
            <nav className="px-2 py-2 flex flex-col gap-1">
              {[...LINKS, ...LINKS_SECONDAIRES].map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  className={`px-3 py-3 rounded text-base flex items-center gap-2 ${
                    pathname === l.href ? "bg-emerald-600 text-white" : "text-slate-200 hover:bg-slate-700"
                  }`}
                >
                  <span className="text-xl">{l.icon}</span>
                  <span>{l.label}</span>
                </a>
              ))}
            </nav>
          </div>
        )}
      </header>

      {/* Bottom nav mobile - 4 icônes fixes en bas */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t-2 border-slate-200 shadow-lg z-20 grid grid-cols-6">
        {LINKS.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className={`flex flex-col items-center justify-center py-2 text-xs font-medium ${
              pathname === l.href || (l.href !== "/" && pathname?.startsWith(l.href)) ? "text-emerald-600 bg-emerald-50" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="text-lg mb-0.5">{l.icon}</span>
            <span className="text-[9px] leading-tight">{l.label}</span>
          </a>
        ))}
      </nav>

      {/* Spacer pour ne pas que le contenu soit caché par la bottom nav mobile */}
      <div className="md:hidden h-16" aria-hidden />
    </>
  );
}

"use client";

import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { activerMoniteurOffline, nbActionsEnAttente } from "@/lib/fileOffline";

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
  { href: "/soumissions", label: "Liste soum.", icon: "📋" },
  { href: "/employes", label: "Employés", icon: "👷" },
  { href: "/inventaire", label: "Inventaire", icon: "📦" },
  { href: "/cameras", label: "Caméras", icon: "📹" },
  { href: "/outils", label: "Outils", icon: "🧰" },
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
  const [notifs, setNotifs] = useState<{ user?: string; total: number; relances: number; drive_erreurs: number; taches_ouvertes: number; mentions: number; mes_relances: number; mentions_items: any[]; relances_items: any[] }>({ total: 0, relances: 0, drive_erreurs: 0, taches_ouvertes: 0, mentions: 0, mes_relances: 0, mentions_items: [], relances_items: [] });
  const [notifsOuvert, setNotifsOuvert] = useState(false);
  const [profilOuvert, setProfilOuvert] = useState(false);
  const [profil, setProfil] = useState<{ username?: string; nom_affichage?: string; photo_data?: string } | null>(null);
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

  // Profil utilisateur (avatar + nom)
  useEffect(() => {
    fetch("/api/auth/profil").then((r) => r.ok ? r.json() : null).then((p) => p && setProfil(p)).catch(() => {});
    // Précharge le cache offline en arrière-plan (clients/projets/soumissions/employés)
    import("@/lib/offlineCache").then((m) => m.prechargerCache());
    activerMoniteurOffline((info) => {
      if (info.envoyees > 0) {
        // Toast léger sans dépendance — visible une fois la connexion revenue
        const t = document.createElement("div");
        t.className = "fixed bottom-20 right-4 bg-emerald-600 text-white px-4 py-2 rounded shadow-lg text-sm z-50";
        t.textContent = `✓ ${info.envoyees} saisie(s) hors-ligne synchronisée(s)`;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 4000);
      }
    });
  }, []);

  const deconnexion = async () => {
    if (!confirm("Te déconnecter ?")) return;
    await fetch("/api/login", { method: "DELETE" });
    router.replace("/login");
  };

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
    r.type === "client" ? `/clients/${r.id}` :
    r.type === "projet" ? `/projets/${r.id}` :
    r.type === "soumission" ? `/soumissions/${r.id}` :
    r.type === "commentaire" || r.type === "sous-tâche" || r.type === "fichier" ? `/clients/${r.id}` : "/";

  return (
    <>
      <header className="bg-slate-900 text-white shadow sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center gap-2">
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
          <Link href="/" prefetch className="flex-shrink-0 hidden sm:block" title="Tableau de bord">
            <img src="/logo-viking.svg" alt="Revêtement Viking" className="h-7 w-7 brightness-0 invert opacity-90 drakkar-animate" />
          </Link>

          {/* Liens nav desktop — placés à GAUCHE, juste après le logo */}
          <nav className="hidden md:flex gap-1">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                prefetch
                className={`px-2.5 py-1 rounded text-sm transition whitespace-nowrap ${
                  pathname === l.href ? "bg-emerald-600 text-white" : "text-slate-200 hover:bg-slate-700"
                }`}
              >
                <span className="mr-1">{l.icon}</span>
                <span>{l.label}</span>
              </Link>
            ))}
          </nav>

          {/* Titre — uniquement sur mobile (sur desktop, il passe en sous-rangée) */}
          <div className="flex-1 min-w-0 md:hidden">
            <h1 className="text-base font-bold flex items-center gap-2 truncate">
              <span className="truncate">{titre}</span>
            </h1>
          </div>

          {/* Spacer desktop pour pousser les contrôles à droite */}
          <div className="hidden md:block flex-1" />

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
                  <Link key={i} href={lienResultat(r)} className="block px-3 py-2 hover:bg-slate-100 border-b last:border-b-0">
                    <div className="text-xs text-emerald-700 uppercase font-bold">{r.type}</div>
                    <div className="text-sm font-semibold truncate">{r.titre}</div>
                    {r.sous && <div className="text-xs text-slate-500 truncate">{r.sous}</div>}
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Cloche de notifications + dropdown */}
          <div className="relative">
            <button
              onClick={() => setNotifsOuvert(!notifsOuvert)}
              className="p-2 rounded hover:bg-slate-700 transition flex-shrink-0 text-lg relative"
              title="Notifications"
              aria-label={`Notifications (${notifs.total})`}
            >
              🔔
              {notifs.total > 0 && (
                <span className="absolute top-0.5 right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[16px] h-[16px] flex items-center justify-center px-1 leading-none">
                  {notifs.total > 9 ? "9+" : notifs.total}
                </span>
              )}
            </button>
            {notifsOuvert && (
              <div className="absolute top-full right-0 mt-2 bg-white text-slate-900 rounded-lg shadow-xl border w-80 max-w-[90vw] max-h-[70vh] overflow-y-auto z-50">
                <div className="p-3 border-b bg-slate-50">
                  <div className="font-bold text-sm">🔔 Notifications {notifs.user && <span className="font-normal text-slate-500">— {notifs.user}</span>}</div>
                  <div className="text-[10px] text-slate-500">@mentions + relances dues + tâches</div>
                </div>
                {/* @Mentions */}
                {notifs.mentions_items.length > 0 && (
                  <div className="p-2">
                    <div className="text-[10px] font-bold uppercase text-emerald-700 px-2 py-1">💬 Mentions reçues ({notifs.mentions})</div>
                    {notifs.mentions_items.map((m: any) => (
                      <a key={m.id} href={`/clients`} className="block px-3 py-2 hover:bg-emerald-50 rounded text-sm border-l-2 border-emerald-400 mb-1">
                        <div className="flex justify-between"><strong className="truncate">@{m.auteur || "—"} → {m.client_nom || "?"}</strong><span className="text-[10px] text-slate-500">{new Date(m.date_creation).toLocaleDateString("fr-CA", { day: "numeric", month: "short" })}</span></div>
                        <div className="text-xs text-slate-600 line-clamp-2">{m.texte}</div>
                      </a>
                    ))}
                  </div>
                )}
                {/* Relances dues à moi */}
                {notifs.relances_items.length > 0 && (
                  <div className="p-2 border-t">
                    <div className="text-[10px] font-bold uppercase text-amber-700 px-2 py-1">⏰ Mes relances dues ({notifs.mes_relances})</div>
                    {notifs.relances_items.map((c: any) => {
                      const retard = c.date_relance < new Date().toISOString().slice(0, 10);
                      return (
                        <a key={c.id} href={`/clients`} className={`block px-3 py-2 hover:bg-amber-50 rounded text-sm border-l-2 mb-1 ${retard ? "border-red-500" : "border-amber-400"}`}>
                          <div className="flex justify-between"><strong className="truncate">{c.nom}</strong><span className={`text-[10px] ${retard ? "text-red-700 font-bold" : "text-amber-700"}`}>{c.date_relance.slice(5)}</span></div>
                          <div className="text-xs text-slate-500 truncate">{c.adresse || ""}{c.telephone ? ` · ${c.telephone}` : ""}</div>
                        </a>
                      );
                    })}
                  </div>
                )}
                {notifs.mentions_items.length === 0 && notifs.relances_items.length === 0 && (
                  <div className="p-6 text-center text-sm text-slate-500">🎉 Rien à signaler.</div>
                )}
                {/* Compteurs autres */}
                {(notifs.relances > 0 || notifs.taches_ouvertes > 0 || notifs.drive_erreurs > 0) && (
                  <div className="p-2 border-t text-xs text-slate-600 space-y-1">
                    {notifs.relances > 0 && <div>📋 Soumissions à relancer : <strong>{notifs.relances}</strong></div>}
                    {notifs.taches_ouvertes > 0 && <div>✅ Tâches ouvertes : <strong>{notifs.taches_ouvertes}</strong></div>}
                    {notifs.drive_erreurs > 0 && <div>☁️ Erreurs Drive : <strong>{notifs.drive_erreurs}</strong></div>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Menu profil (avatar + dropdown) */}
          <div className="relative">
            <button onClick={() => setProfilOuvert(!profilOuvert)} className="flex items-center gap-1.5 p-1 rounded-full hover:bg-slate-700 transition flex-shrink-0" title="Profil & paramètres" aria-label="Profil">
              {profil?.photo_data ? (
                <img src={profil.photo_data} alt="Profil" className="w-8 h-8 rounded-full object-cover border border-slate-500" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-sm font-bold">
                  {(profil?.nom_affichage || profil?.username || "?").trim()[0]}
                </div>
              )}
            </button>
            {profilOuvert && (
              <div className="absolute top-full right-0 mt-2 bg-white text-slate-900 rounded-lg shadow-xl border w-60 z-50">
                <div className="p-3 border-b">
                  <div className="font-bold text-sm">{profil?.nom_affichage || profil?.username || "Utilisateur"}</div>
                  {profil?.username && profil?.nom_affichage && <div className="text-[10px] text-slate-500">@{profil.username}</div>}
                </div>
                <Link href="/parametres" onClick={() => setProfilOuvert(false)} className="block px-3 py-2 hover:bg-slate-100 text-sm">⚙️ Mon profil &amp; paramètres</Link>
                <button onClick={() => { setProfilOuvert(false); deconnexion(); }} className="block w-full text-left px-3 py-2 hover:bg-red-50 text-sm text-red-700 border-t">🚪 Se déconnecter</button>
              </div>
            )}
          </div>

          {/* Dark mode toggle */}
          <button onClick={toggleDark} className="p-2 rounded hover:bg-slate-700 transition flex-shrink-0 text-lg" title={dark ? "Mode clair" : "Mode sombre"}>
            {dark ? "☀️" : "🌙"}
          </button>

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

        {/* Sous-rangée desktop : titre compact + sous-titre */}
        <div className="hidden md:flex max-w-7xl mx-auto px-4 pb-1.5 items-baseline gap-3">
          <h1 className="text-sm font-bold truncate flex items-center gap-2">
            <span className="truncate">{titre}</span>
            {badge && <span>{badge}</span>}
          </h1>
          {soustitre && <p className="text-[11px] text-slate-300 truncate">{soustitre}</p>}
        </div>

        {/* Badge mobile */}
        {badge && <div className="md:hidden px-4 pb-2">{badge}</div>}

        {/* Menu mobile */}
        {menuOuvert && (
          <div className="md:hidden bg-slate-800 border-t border-slate-700">
            <nav className="px-2 py-2 flex flex-col gap-1">
              {[...LINKS, ...LINKS_SECONDAIRES].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMenuOuvert(false)}
                  className={`px-3 py-3 rounded text-base flex items-center gap-2 ${
                    pathname === l.href ? "bg-emerald-600 text-white" : "text-slate-200 hover:bg-slate-700"
                  }`}
                >
                  <span className="text-xl">{l.icon}</span>
                  <span>{l.label}</span>
                </Link>
              ))}
            </nav>
          </div>
        )}
      </header>

      {/* Bottom nav mobile — 1 colonne par lien (grid auto), padding safe-area iOS */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t-2 border-slate-200 shadow-lg z-20 grid"
        style={{
          gridTemplateColumns: `repeat(${LINKS.length}, minmax(0, 1fr))`,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            prefetch
            className={`flex flex-col items-center justify-center py-2 px-0.5 text-xs font-medium ${
              pathname === l.href || (l.href !== "/" && pathname?.startsWith(l.href)) ? "text-emerald-600 bg-emerald-50" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <span className="text-lg mb-0.5">{l.icon}</span>
            <span className="text-[9px] leading-tight truncate w-full text-center">{l.label}</span>
          </Link>
        ))}
      </nav>

    </>
  );
}

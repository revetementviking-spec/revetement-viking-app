"use client";

import Navigation from "@/components/Navigation";

const OUTILS = [
  { href: "/sync", icon: "🔄", titre: "Synchronisations", desc: "Google Drive · Asana — sauvegarde et import automatiques" },
  { href: "/rapports", icon: "📈", titre: "Rapports", desc: "Statistiques, rendements, analyses de rentabilité" },
  { href: "/admin/journal", icon: "📜", titre: "Journal d'activité", desc: "Traçabilité : qui a fait quoi, quand (audit)" },
  { href: "/admin/diagnostic", icon: "🛠️", titre: "Diagnostic", desc: "État système, Drive, erreurs, validation backup" },
  { href: "/a-propos", icon: "ℹ️", titre: "À propos", desc: "Informations sur l'application et l'entreprise" },
];

export default function OutilsPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="🧰 Outils" soustitre="Synchros · Rapports · Journal · Diagnostic · À propos" />
      <main className="max-w-3xl mx-auto p-4 md:p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {OUTILS.map((o) => (
            <a
              key={o.href}
              href={o.href}
              className="bg-white rounded-lg shadow hover:shadow-lg hover:border-emerald-300 border-2 border-transparent transition p-4 flex items-start gap-3"
            >
              <span className="text-3xl flex-shrink-0">{o.icon}</span>
              <div className="min-w-0">
                <div className="font-bold text-slate-900">{o.titre}</div>
                <div className="text-xs text-slate-500 mt-0.5">{o.desc}</div>
              </div>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

export default function MaintenancePage() {
  const [verifie, setVerifie] = useState(0);

  // Vérifie périodiquement : dès que la maintenance se termine, on revient à l'accueil.
  useEffect(() => {
    const t = setInterval(() => {
      fetch("/api/maintenance")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && (!d.actif || d.bypass)) window.location.href = "/";
          else setVerifie((v) => v + 1);
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-800 to-slate-900 text-white flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <div className="text-6xl">🛠️</div>
        <h1 className="text-2xl font-bold">Mise à jour en cours</h1>
        <p className="text-slate-300">
          L'application est temporairement en maintenance pendant qu'on y apporte des
          améliorations. Reviens dans quelques minutes — cette page se rouvrira toute
          seule une fois terminé.
        </p>
        <p className="text-xs text-slate-500">Revêtement Viking · vérification automatique{verifie > 0 ? ` (${verifie})` : ""}</p>
      </div>
    </div>
  );
}

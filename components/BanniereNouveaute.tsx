"use client";

import { useEffect, useState } from "react";

/**
 * Bannière bleue d'annonce d'une nouvelle fonctionnalité.
 * Affichée à chaque personne pendant ses 3 PROCHAINES connexions (sessions), puis
 * disparaît. Compté par appareil via localStorage (sessions via sessionStorage).
 *
 * Pour annoncer une NOUVELLE fonctionnalité plus tard : changer VERSION (le compteur
 * repart à zéro) et MESSAGE.
 */
const VERSION = "2026-06-heures";
const MESSAGE =
  "✨ Nouveauté : la saisie d'heures est améliorée — description en paragraphe et projet en cours proposé automatiquement. L'app est aussi plus rapide.";
const MAX_CONNEXIONS = 3;

export default function BanniereNouveaute() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Pas sur la page de login ni les pages publiques (signature client)
    const p = window.location.pathname;
    if (p.startsWith("/login") || p.startsWith("/maintenance") || p.startsWith("/soumission") || p.startsWith("/contrat") || p.startsWith("/projet/")) return;
    try {
      const cleVues = `nouveaute:${VERSION}:vues`;
      const cleSession = `nouveaute:${VERSION}:session`;
      let vues = parseInt(localStorage.getItem(cleVues) || "0", 10);
      // On ne compte qu'une fois par session (= une connexion)
      if (!sessionStorage.getItem(cleSession)) {
        vues += 1;
        localStorage.setItem(cleVues, String(vues));
        sessionStorage.setItem(cleSession, "1");
      }
      if (vues <= MAX_CONNEXIONS) setVisible(true);
    } catch { /* localStorage indisponible — on n'affiche rien */ }
  }, []);

  const fermer = () => {
    try { localStorage.setItem(`nouveaute:${VERSION}:vues`, String(MAX_CONNEXIONS + 1)); } catch {}
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="bg-blue-600 text-white px-4 py-2 flex items-center justify-between gap-3 text-sm shadow">
      <span className="font-medium">{MESSAGE}</span>
      <button onClick={fermer} aria-label="Fermer l'annonce" className="flex-shrink-0 w-7 h-7 rounded-full hover:bg-blue-500 flex items-center justify-center font-bold">✕</button>
    </div>
  );
}

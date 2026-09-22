"use client";

import { useEffect, useState } from "react";

/** Enregistre le service worker et annonce une nouvelle version quand elle est prête.
 *
 *  Avant, rien ne disait qu'une nouvelle version venait de s'installer : l'onglet ouvert
 *  gardait l'ancien code (et un ancien cache) jusqu'à un rechargement que personne ne
 *  savait devoir faire. Bannière persistante avec un bouton « Recharger » — pas un toast
 *  qui disparaît. */
export default function PWARegister() {
  const [majDispo, setMajDispo] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let demonte = false;
    // Premier contrôle de la page = première installation, pas une mise à jour.
    const avaitControleur = !!navigator.serviceWorker.controller;
    const onControllerChange = () => { if (avaitControleur && !demonte) setMajDispo(true); };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let onVisible: (() => void) | null = null;
    const timer = setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").then((reg) => {
        if (demonte) return;
        reg.addEventListener("updatefound", () => {
          const neuf = reg.installing;
          if (!neuf) return;
          neuf.addEventListener("statechange", () => {
            // « installed » alors qu'un contrôleur est déjà en place = nouvelle version prête.
            if (neuf.state === "installed" && navigator.serviceWorker.controller && !demonte) setMajDispo(true);
          });
        });
        // Vérifie une nouvelle version à chaque retour sur l'onglet (le navigateur, lui,
        // ne le fait qu'à la navigation ou toutes les 24 h).
        onVisible = () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); };
        document.addEventListener("visibilitychange", onVisible);
      }).catch(() => {});
    }, 2000);

    return () => {
      demonte = true;
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      if (onVisible) document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!majDispo) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-4 right-4 md:left-auto md:right-4 md:w-96 z-[95] bg-slate-900 text-white rounded-lg shadow-xl px-4 py-3 flex items-center gap-3"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)" }}
    >
      <span className="flex-1 text-sm font-semibold">Nouvelle version disponible</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="min-h-11 px-4 rounded bg-emerald-600 hover:bg-emerald-500 font-bold text-sm"
      >
        Recharger
      </button>
    </div>
  );
}

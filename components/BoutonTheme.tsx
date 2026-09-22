"use client";

import { useEffect, useState } from "react";

const CLE = "vk-theme";
const CLASSE = "vk-dark";

/** Bouton qui bascule mode sombre/clair.
 *
 *  UN seul mécanisme, le même que la feuille de style (globals.css : `html.vk-dark`) et
 *  que le script inline de app/layout.tsx qui pose la classe AVANT l'hydratation, depuis
 *  localStorage `vk-theme`. Avant, ce bouton posait `data-theme="dark"`, que personne ne
 *  lisait : le mode sombre était inatteignable.
 *
 *  `variante="menu"` : ligne pleine largeur pour le menu profil de Navigation. */
export default function BoutonTheme({ variante = "icone" }: { variante?: "icone" | "menu" }) {
  // Pas de lecture de localStorage au premier rendu (SSR) : on lit la classe déjà posée.
  const [sombre, setSombre] = useState(false);

  useEffect(() => {
    setSombre(document.documentElement.classList.contains(CLASSE));
  }, []);

  const appliquer = (sombreV: boolean) => {
    setSombre(sombreV);
    document.documentElement.classList.toggle(CLASSE, sombreV);
    try { localStorage.setItem(CLE, sombreV ? "dark" : "light"); } catch { /* stockage indisponible */ }
  };

  if (variante === "menu") {
    return (
      <button
        type="button"
        onClick={() => appliquer(!sombre)}
        className="block w-full text-left px-3 py-2 hover:bg-slate-100 text-sm min-h-11"
        aria-pressed={sombre}
      >
        {sombre ? "☀️ Mode clair" : "🌙 Mode sombre"}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => appliquer(!sombre)}
      className="min-w-11 min-h-11 flex items-center justify-center rounded hover:bg-slate-100 transition text-base"
      title={sombre ? "Passer en mode clair" : "Passer en mode sombre"}
      aria-label="Basculer le thème"
      aria-pressed={sombre}
    >
      {sombre ? "☀️" : "🌙"}
    </button>
  );
}

"use client";

import { useEffect } from "react";

/**
 * Garde de session global.
 *
 * Intercepte les réponses `fetch` : si l'API répond **401** (session expirée),
 * redirige vers /login en conservant la destination — au lieu de laisser les
 * composants afficher des écrans vides (B8 fait que /api/* renvoie 401 JSON,
 * plus un 307 HTML, donc on peut le détecter proprement ici).
 *
 * Sans danger sur la page /login elle-même (un mauvais mot de passe y renvoie 401
 * mais on n'y redirige pas → pas de boucle).
 */
export default function Garde401() {
  useEffect(() => {
    const originalFetch = window.fetch;
    let redirige = false;

    window.fetch = async (...args) => {
      const res = await originalFetch(...args);
      // Ne réagit QU'aux 401 de NOTRE serveur (même origine) — jamais aux fetchs
      // tiers (OpenStreetMap, météo, Drive…) pour éviter toute fausse redirection.
      let memeOrigine = true;
      try {
        const u = typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url || "";
        if (u && /^https?:\/\//i.test(u)) memeOrigine = u.startsWith(window.location.origin);
      } catch { /* défaut : on considère même origine */ }
      if (
        res.status === 401 &&
        memeOrigine &&
        !redirige &&
        !window.location.pathname.startsWith("/login")
      ) {
        redirige = true; // évite plusieurs redirections sur fetchs parallèles
        const dest = window.location.pathname + window.location.search;
        window.location.href = `/login?redirect=${encodeURIComponent(dest)}`;
      }
      return res;
    };

    return () => { window.fetch = originalFetch; };
  }, []);

  return null;
}

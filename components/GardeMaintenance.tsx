"use client";

import { useEffect } from "react";

/**
 * Garde de maintenance (côté client, monté dans le layout).
 *
 * Si le mode maintenance est ON (réglé dans Paramètres) et que ce navigateur n'a
 * pas le bypass, redirige vers /maintenance. Le navigateur qui a activé la
 * maintenance possède un cookie bypass et continue à travailler normalement.
 *
 * Pages toujours accessibles (pour ne pas se verrouiller / ne pas bloquer les
 * clients) : /maintenance, /login, /parametres, et les pages publiques signées.
 */
export default function GardeMaintenance() {
  useEffect(() => {
    const p = window.location.pathname;
    if (
      p.startsWith("/maintenance") ||
      p.startsWith("/login") ||
      p.startsWith("/parametres") ||
      p.startsWith("/soumission") ||
      p.startsWith("/contrat") ||
      p.startsWith("/projet/")
    ) return;

    fetch("/api/maintenance")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.actif && !d.bypass) window.location.href = "/maintenance";
      })
      .catch(() => {});
  }, []);

  return null;
}

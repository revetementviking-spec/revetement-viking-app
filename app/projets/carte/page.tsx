"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import Navigation from "@/components/Navigation";
import { lireListe } from "@/lib/envoi";
import ErreurChargement from "@/components/ErreurChargement";

/** Vue carte interactive des projets actifs.
 * Utilise Leaflet via CDN (gratuit, OpenStreetMap tiles) — pas de clé API.
 * Géocodage via Nominatim (OSM) avec petit cache localStorage 30 jours. */

interface Coord { lat: number; lng: number }

const COULEURS: Record<string, string> = {
  actif: "#10b981",
  a_venir: "#f59e0b",
  complete: "#3b82f6",
  annule: "#ef4444",
};

async function geocoder(adresse: string): Promise<Coord | null> {
  if (!adresse) return null;
  const cle = `vk-geo-${adresse.toLowerCase().trim()}`;
  try {
    const cache = localStorage.getItem(cle);
    if (cache) {
      const c = JSON.parse(cache);
      if (Date.now() - c.t < 30 * 86400000) return c.v;
    }
  } catch {}
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(adresse + ", Québec, Canada")}&format=json&limit=1`);
    const data = await r.json();
    if (!data?.[0]) return null;
    const v = { lat: +data[0].lat, lng: +data[0].lon };
    try { localStorage.setItem(cle, JSON.stringify({ t: Date.now(), v })); } catch {}
    return v;
  } catch { return null; }
}

export default function CarteProjets() {
  const [projets, setProjets] = useState<any[]>([]);
  const [pretLeaflet, setPretLeaflet] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // ?lite=1 : la carte n'a besoin que de id, nom, adresse_chantier, statut et
    // client_nom (tous dans la réponse allégée) — la liste complète recalculait coûts et
    // marges de chaque projet pour rien.
    lireListe("/api/projets?lite=1").then((r) => { if (r.ok) { setErreur(null); setProjets(r.data); } else setErreur(r.erreur); });
  }, []);

  useEffect(() => {
    if (!pretLeaflet || !containerRef.current || mapRef.current) return;
    const L = (window as any).L;
    if (!L) return;
    const map = L.map(containerRef.current).setView([46.8, -71.3], 7); // Centre Québec
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
  }, [pretLeaflet]);

  useEffect(() => {
    if (!pretLeaflet || !mapRef.current || projets.length === 0) return;
    const L = (window as any).L;
    const map = mapRef.current;
    setChargement(true);
    (async () => {
      const points: any[] = [];
      for (const p of projets) {
        const adr = p.adresse_chantier || p.adresse || "";
        if (!adr) continue;
        const c = await geocoder(adr);
        if (!c) continue;
        const couleur = COULEURS[p.statut] || "#64748b";
        const icon = L.divIcon({
          className: "vk-pin",
          html: `<div style="background:${couleur};width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)"></div>`,
          iconSize: [22, 22], iconAnchor: [11, 22],
        });
        const m = L.marker([c.lat, c.lng], { icon }).addTo(map);
        m.bindPopup(`
          <div style="font-family:system-ui;font-size:13px">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px">${p.nom}</div>
            <div style="color:#64748b;margin-bottom:6px">📍 ${adr}</div>
            ${p.client_nom ? `<div>👤 ${p.client_nom}</div>` : ""}
            <a href="/projets/${p.id}" style="display:inline-block;margin-top:6px;color:#10b981;font-weight:600">Ouvrir le projet →</a>
          </div>
        `);
        points.push([c.lat, c.lng]);
      }
      if (points.length > 0) map.fitBounds(points, { padding: [40, 40] });
      setChargement(false);
    })();
  }, [pretLeaflet, projets]);

  return (
    <div className="min-h-screen bg-slate-50">
      <Script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" onLoad={() => setPretLeaflet(true)} />
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <Navigation titre="🗺️ Carte des projets" soustitre={`${projets.length} projet(s) sur la carte`} />
      <main className="max-w-7xl mx-auto p-3 md:p-4 space-y-3">
        <div className="flex flex-wrap gap-2 text-xs items-center">
          <span className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded">🟢 Actif</span>
          <span className="px-2 py-1 bg-amber-100 text-amber-800 rounded">🟡 À venir</span>
          <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">🔵 Complété</span>
          <button onClick={() => {
            if (!navigator.geolocation) { alert("Géolocalisation non supportée"); return; }
            navigator.geolocation.getCurrentPosition((pos) => {
              const L = (window as any).L;
              const map = mapRef.current;
              if (!L || !map) return;
              const c = [pos.coords.latitude, pos.coords.longitude];
              map.setView(c, 12);
              L.circleMarker(c, { radius: 10, color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 0.5 }).addTo(map).bindPopup("📍 Vous êtes ici");
            }, () => alert("Permission géolocalisation refusée"));
          }} className="ml-auto px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold">📍 Projets autour de moi</button>
        </div>
        {erreur && <ErreurChargement erreur={erreur} onReessayer={() => { setErreur(null); lireListe("/api/projets?lite=1").then((r) => { if (r.ok) setProjets(r.data); else setErreur(r.erreur); }); }} />}
        <div ref={containerRef} className="bg-white rounded-lg shadow" style={{ height: "calc(100vh - 200px)", minHeight: 400 }} />
        {chargement && <div className="text-center text-xs text-slate-500">📍 Géocodage des adresses en cours...</div>}
      </main>
    </div>
  );
}

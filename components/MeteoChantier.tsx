"use client";

import { useEffect, useState } from "react";

const ICONES: Record<number, { icon: string; label: string }> = {
  0: { icon: "☀️", label: "Ensoleillé" }, 1: { icon: "🌤️", label: "Peu nuageux" },
  2: { icon: "⛅", label: "Partiellement nuageux" }, 3: { icon: "☁️", label: "Nuageux" },
  45: { icon: "🌫️", label: "Brouillard" }, 48: { icon: "🌫️", label: "Brouillard givrant" },
  51: { icon: "🌦️", label: "Bruine" }, 53: { icon: "🌦️", label: "Bruine" }, 55: { icon: "🌧️", label: "Bruine forte" },
  61: { icon: "🌧️", label: "Pluie légère" }, 63: { icon: "🌧️", label: "Pluie" }, 65: { icon: "🌧️", label: "Pluie forte" },
  71: { icon: "🌨️", label: "Neige légère" }, 73: { icon: "🌨️", label: "Neige" }, 75: { icon: "❄️", label: "Neige forte" },
  77: { icon: "🌨️", label: "Grésil" }, 80: { icon: "🌦️", label: "Averses" }, 81: { icon: "🌧️", label: "Averses fortes" },
  82: { icon: "⛈️", label: "Averses violentes" }, 85: { icon: "🌨️", label: "Averses neige" },
  86: { icon: "❄️", label: "Averses neige fortes" }, 95: { icon: "⛈️", label: "Orage" },
  96: { icon: "⛈️", label: "Orage grêle" }, 99: { icon: "⛈️", label: "Orage violent" },
};

function travailPossible(code: number, vent: number, precip: number): { ok: boolean; raison: string } {
  if (code >= 95) return { ok: false, raison: "Orage" };
  if (code >= 80 || precip > 3) return { ok: false, raison: "Pluie forte" };
  if (vent > 40) return { ok: false, raison: "Vent fort" };
  if (code >= 71 && code <= 77) return { ok: false, raison: "Neige" };
  return { ok: true, raison: "OK pour chantier" };
}

export default function MeteoChantier({ adresse }: { adresse: string }) {
  const [data, setData] = useState<any>(null);
  const [erreur, setErreur] = useState<string>("");

  useEffect(() => {
    if (!adresse) return;
    let stop = false;
    (async () => {
      try {
        // 1. Geocode via Open-Meteo (gratuit, sans clé)
        const ville = adresse.split(",").slice(-2).join(",").trim() || adresse;
        const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(ville)}&count=1&language=fr&format=json`).then(r => r.json());
        if (stop) return;
        const loc = g.results?.[0];
        if (!loc) { setErreur("Adresse introuvable"); return; }
        // 2. Météo actuelle + prochain 3 jours
        const m = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=3&timezone=America%2FToronto`).then(r => r.json());
        if (!stop) setData({ ville: loc.name, ...m });
      } catch (e: any) { if (!stop) setErreur(e.message); }
    })();
    return () => { stop = true; };
  }, [adresse]);

  if (erreur) return <div className="text-xs text-amber-700">⚠️ Météo : {erreur}</div>;
  if (!data) return <div className="text-xs text-slate-400">⏳ Météo...</div>;

  const cur = data.current;
  const code = ICONES[cur.weather_code] || { icon: "🌡️", label: "" };
  const verdict = travailPossible(cur.weather_code, cur.wind_speed_10m, cur.precipitation);

  return (
    <div className={`rounded-lg p-3 border-2 ${verdict.ok ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
      <div className="flex items-center gap-3">
        <span className="text-3xl">{code.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-sm">{Math.round(cur.temperature_2m)}°C · {code.label}</div>
          <div className="text-xs text-slate-600">💨 {Math.round(cur.wind_speed_10m)} km/h · 💧 {cur.precipitation} mm · {data.ville}</div>
        </div>
        <span className={`text-xs font-bold px-2 py-1 rounded ${verdict.ok ? "bg-emerald-600 text-white" : "bg-amber-600 text-white"}`}>
          {verdict.ok ? "✓ Chantier OK" : "⚠ " + verdict.raison}
        </span>
      </div>
      {data.daily && (
        <div className="flex gap-2 mt-2 text-xs">
          {data.daily.time.map((d: string, i: number) => (
            <div key={d} className="flex-1 text-center bg-white rounded p-1.5 border">
              <div className="font-semibold">{i === 0 ? "Aujourd'hui" : new Date(d).toLocaleDateString("fr-CA", { weekday: "short" })}</div>
              <div className="text-lg">{ICONES[data.daily.weather_code[i]]?.icon || "🌡️"}</div>
              <div className="text-slate-600">{Math.round(data.daily.temperature_2m_max[i])}° / {Math.round(data.daily.temperature_2m_min[i])}°</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

// Laval QC (Quartier Vimont, peut être ajusté)
const LAT = 45.5667;
const LON = -73.7333;
const VILLE = "Laval, QC";

const ICONES: Record<number, { icon: string; label: string }> = {
  0: { icon: "☀️", label: "Ensoleillé" },
  1: { icon: "🌤️", label: "Peu nuageux" },
  2: { icon: "⛅", label: "Partiellement nuageux" },
  3: { icon: "☁️", label: "Nuageux" },
  45: { icon: "🌫️", label: "Brouillard" },
  48: { icon: "🌫️", label: "Brouillard givrant" },
  51: { icon: "🌦️", label: "Bruine légère" },
  53: { icon: "🌦️", label: "Bruine" },
  55: { icon: "🌧️", label: "Bruine forte" },
  61: { icon: "🌧️", label: "Pluie légère" },
  63: { icon: "🌧️", label: "Pluie" },
  65: { icon: "🌧️", label: "Pluie forte" },
  71: { icon: "🌨️", label: "Neige légère" },
  73: { icon: "🌨️", label: "Neige" },
  75: { icon: "❄️", label: "Neige forte" },
  77: { icon: "🌨️", label: "Grésil" },
  80: { icon: "🌦️", label: "Averses" },
  81: { icon: "🌧️", label: "Averses fortes" },
  82: { icon: "⛈️", label: "Averses violentes" },
  85: { icon: "🌨️", label: "Averses de neige" },
  86: { icon: "❄️", label: "Forte neige" },
  95: { icon: "⛈️", label: "Orage" },
  96: { icon: "⛈️", label: "Orage grêle" },
  99: { icon: "⛈️", label: "Orage violent" },
};

const JOURS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

interface JourMeteo { date: string; codeIcone: number; tmin: number; tmax: number; pluie_mm: number; vent_max: number; }

export default function Meteo() {
  const [jours, setJours] = useState<JourMeteo[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=America/Toronto&forecast_days=7`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (!d.daily) throw new Error("Pas de données");
        const out: JourMeteo[] = d.daily.time.map((t: string, i: number) => ({
          date: t,
          codeIcone: d.daily.weather_code[i],
          tmin: Math.round(d.daily.temperature_2m_min[i]),
          tmax: Math.round(d.daily.temperature_2m_max[i]),
          pluie_mm: d.daily.precipitation_sum[i],
          vent_max: Math.round(d.daily.wind_speed_10m_max[i]),
        }));
        setJours(out);
      })
      .catch((e) => setErreur(e.message));
  }, []);

  if (erreur) return null; // pas de bandeau si erreur

  if (jours.length === 0) {
    return (
      <section className="bg-white rounded-lg shadow p-4 md:p-5">
        <div className="skeleton h-4 w-1/3 mb-3" />
        <div className="grid grid-cols-7 gap-2">
          {[1,2,3,4,5,6,7].map((i) => <div key={i} className="skeleton h-24 rounded" />)}
        </div>
      </section>
    );
  }

  return (
    <section className="bg-gradient-to-br from-sky-50 to-blue-50 border-2 border-sky-200 rounded-lg p-4 md:p-5">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-bold text-sky-900">🌤️ Météo · 7 jours · {VILLE}</h2>
        <a href={`https://www.meteomedia.com/ca/meteo/quebec/laval`} target="_blank" rel="noreferrer" className="text-xs text-sky-700 hover:underline">Détails →</a>
      </div>
      <div className="grid grid-cols-7 gap-1 md:gap-2">
        {jours.map((j) => {
          const d = new Date(j.date + "T12:00:00");
          const info = ICONES[j.codeIcone] || { icon: "❓", label: "Inconnu" };
          const aujourd = j.date === new Date().toISOString().slice(0, 10);
          const pluieAlerte = j.pluie_mm > 5;
          return (
            <div key={j.date} className={`bg-white rounded-lg p-2 text-center ${aujourd ? "ring-2 ring-sky-500" : ""}`} title={info.label}>
              <div className={`text-[10px] font-bold uppercase ${aujourd ? "text-sky-700" : "text-slate-500"}`}>{aujourd ? "Auj." : JOURS[d.getDay()]}</div>
              <div className="text-[10px] text-slate-400">{d.getDate()}/{d.getMonth() + 1}</div>
              <div className="text-2xl md:text-3xl my-1">{info.icon}</div>
              <div className="text-xs md:text-sm font-bold text-slate-900">{j.tmax}°<span className="text-slate-400 font-normal">/{j.tmin}°</span></div>
              {j.pluie_mm > 0 && (
                <div className={`text-[10px] mt-0.5 font-semibold ${pluieAlerte ? "text-blue-700" : "text-slate-500"}`}>
                  💧 {j.pluie_mm.toFixed(0)}mm
                </div>
              )}
              {j.vent_max >= 40 && (
                <div className="text-[10px] text-amber-700 font-semibold mt-0.5">💨 {j.vent_max}km/h</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-slate-500 mt-2">⚠️ Pluie &gt; 5mm = travaux extérieurs à éviter · Vent &gt; 40 km/h = sécurité échafaudage</div>
    </section>
  );
}

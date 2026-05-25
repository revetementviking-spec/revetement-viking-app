"use client";

import { useEffect, useState } from "react";

/** Bandeau qui apparaît en haut quand la connexion réseau est perdue.
 *  Disparaît automatiquement au retour en ligne. */
export default function IndicateurHorsLigne() {
  const [enLigne, setEnLigne] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setEnLigne(navigator.onLine);
    const onOn = () => setEnLigne(true);
    const onOff = () => setEnLigne(false);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);
    return () => {
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
    };
  }, []);

  if (enLigne) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-[90] bg-amber-500 text-white text-center text-sm font-semibold py-1.5 shadow-md"
    >
      📡 Hors ligne — tes modifications seront sauvegardées dès le retour de la connexion
    </div>
  );
}

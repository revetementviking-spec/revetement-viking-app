"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[Viking Error Boundary]", error);
    // Envoi vers Sentry-light maison
    fetch("/api/log-erreur", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        path: typeof window !== "undefined" ? window.location.pathname : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl border-2 border-red-200 p-6 max-w-md w-full">
        <div className="text-6xl mb-3 text-center">⚠️</div>
        <h1 className="text-xl font-bold text-slate-900 text-center mb-2">Oups, une erreur est survenue</h1>
        <p className="text-sm text-slate-600 text-center mb-4">
          Pas de panique — tes données sont en sécurité. Tu peux réessayer ou revenir au tableau de bord.
        </p>
        {error.digest && (
          <p className="text-[10px] text-slate-400 text-center mb-4 font-mono">Réf : {error.digest}</p>
        )}
        <details className="text-xs text-slate-500 mb-4">
          <summary className="cursor-pointer hover:text-slate-700">Détails techniques</summary>
          <pre className="mt-2 bg-slate-50 p-2 rounded overflow-x-auto text-[10px]">{error.message}</pre>
        </details>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={reset}
            className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold"
          >
            🔄 Réessayer
          </button>
          <a
            href="/"
            className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg font-bold text-center"
          >
            🏠 Tableau de bord
          </a>
        </div>
      </div>
    </div>
  );
}

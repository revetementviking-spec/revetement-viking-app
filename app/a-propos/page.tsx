"use client";

import Navigation from "@/components/Navigation";

export default function AProposPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="ℹ️ À propos" />
      <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
        <section className="bg-white rounded-lg shadow p-6 text-center">
          <img src="/logo-viking.svg" alt="Logo" className="h-32 w-32 mx-auto mb-3" />
          <h1 className="text-3xl font-bold text-slate-900">Revêtement Viking Inc.</h1>
          <p className="text-slate-600">Revêtement extérieur — Soffite · Fascia · Solin · Parement</p>
          <p className="text-xs text-slate-500 mt-2">RBQ 5811-4299-01</p>
        </section>

        <section className="bg-white rounded-lg shadow p-5 space-y-2">
          <h2 className="font-bold">Contact</h2>
          <p className="text-sm">📧 <a href="mailto:info@entreprisesxpress.ca" className="text-emerald-700 hover:underline">info@entreprisesxpress.ca</a></p>
          <p className="text-sm">🌐 app.revetementviking.com</p>
        </section>

        <section className="bg-white rounded-lg shadow p-5 space-y-2">
          <h2 className="font-bold">L'application</h2>
          <p className="text-sm text-slate-700">Plateforme interne de gestion : soumissions IA, projets, heures multi-employés, dépenses, outils, rapports financiers.</p>
          <ul className="text-sm space-y-1 list-disc list-inside text-slate-600">
            <li>Analyse automatique de rapports Hover par IA</li>
            <li>Estimation par vision multi-photos</li>
            <li>Suivi de rentabilité projet en temps réel</li>
            <li>Multi-employés avec calcul DAS automatique</li>
            <li>Catalogue d'outils avec traçabilité</li>
            <li>Export CSV pour comptable</li>
          </ul>
        </section>

        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="font-bold mb-2">Version</h2>
          <p className="text-xs text-slate-500">v1.0 — Mai 2026 · Next.js + Turso · Hébergé sur Vercel</p>
        </section>
      </main>
    </div>
  );
}

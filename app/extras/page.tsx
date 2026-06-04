"use client";

import Navigation from "@/components/Navigation";
import ExtrasVue from "@/components/ExtrasVue";

export default function ExtrasPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="💲 Extras à facturer" soustitre="Travaux / matériaux supplémentaires hors soumission" />
      <main className="max-w-3xl mx-auto p-4 md:p-6">
        <ExtrasVue />
      </main>
    </div>
  );
}

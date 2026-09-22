"use client";

import Navigation from "@/components/Navigation";
import DoublonsVue from "@/components/DoublonsVue";

// Page dédiée : c'est l'adresse qu'ouvre le push du matin (/finances/doublons).
// La même vue vit aussi dans l'onglet « Doublons » de /finances.
export default function DoublonsPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="🧾 Factures en double" soustitre="Fournisseurs et clients · rien n'est supprimé automatiquement" />
      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        <DoublonsVue />
      </main>
    </div>
  );
}

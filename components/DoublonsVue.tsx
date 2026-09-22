"use client";

import { useEffect, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import { ecrire, lireListe } from "@/lib/envoi";

// Écran des factures en double. Deux familles, jamais mélangées (voir lib/doublons-factures.ts) :
// les factures de FOURNISSEURS (dépenses — payer deux fois) et les factures CLIENT émises
// (facturer deux fois). Ici, on montre les DEUX pièces côte à côte : sans ça, il faut
// ouvrir deux onglets pour trancher, et on ne tranche jamais.
//
// L'écran ne supprime RIEN et ne fusionne RIEN. Deux gestes seulement : ouvrir la pièce
// pour la corriger soi-même, ou dire « ce n'est pas un doublon » pour faire taire l'alerte.

function dateLocale(iso: string): string {
  const s = String(iso || "").slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" });
}

export default function DoublonsVue() {
  const [paires, setPaires] = useState<any[]>([]);
  const [chargement, setChargement] = useState(true);
  const { toast } = useToast();

  const charger = async () => {
    setChargement(true);
    // `lireListe` = lecture AVEC filet (lib/envoi.ts). Surtout pas `envoyer()`, qui POSTe
    // par défaut : la lecture partait alors en POST, la route répondait 400 « cle requise »,
    // et l'écran affichait « aucun doublon » — le pire des mensonges pour une alerte d'argent.
    const r = await lireListe<any>("/api/doublons");
    // Une erreur de lecture ne doit pas se déguiser en « aucun doublon » : c'est
    // exactement le genre de silence qui fait payer une facture deux fois.
    if (!r.ok) { toast(`Lecture des doublons impossible : ${r.erreur}`, "error"); setChargement(false); return; }
    setPaires(Array.isArray(r.data) ? r.data : []);
    setChargement(false);
  };

  useEffect(() => { charger(); }, []);

  const ecarter = async (p: any) => {
    if (!confirm(
      `Écarter cette alerte ?\n\n${p.raison}\n\nLes deux pièces restent telles quelles — seule l'alerte se tait, pour cette paire, définitivement.`
    )) return;
    if (!(await ecrire("/api/doublons", "POST", { cle: p.cle }, "Enregistrement"))) return;
    toast("Alerte écartée — ce n'est pas un doublon", "info");
    charger();
  };

  const francs = paires.filter((p) => p.certitude === "franc").length;

  return (
    <div className="space-y-4">
      <section className="bg-gradient-to-br from-rose-50 to-amber-50 border-2 border-rose-200 rounded-lg p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="font-bold text-rose-900">🧾 Factures qui semblent en double</h2>
            <p className="text-xs text-rose-800 mt-0.5">
              Même fournisseur, même montant, à 30 jours ou moins — ou deux factures client au même numéro.
              L'app signale ; rien n'est supprimé tout seul.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-rose-700 uppercase font-semibold">À vérifier</div>
            <div className="text-2xl font-bold text-rose-900">{paires.length}</div>
            {francs > 0 && <div className="text-[11px] text-rose-700">dont {francs} certaine{francs > 1 ? "s" : ""}</div>}
          </div>
        </div>
      </section>

      {chargement ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-slate-500">Analyse des factures…</div>
      ) : paires.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-6xl mb-4">✅</div>
          <h3 className="text-lg font-bold text-slate-700 mb-2">Aucun doublon détecté</h3>
          <p className="text-sm text-slate-500">
            Les factures fournisseurs et les factures client ont été comparées. Rien à signaler.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {paires.map((p) => (
            <div key={p.cle} className={`bg-white rounded-lg shadow p-4 border-l-4 ${p.certitude === "franc" ? "border-rose-600" : "border-amber-500"}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded font-bold ${p.certitude === "franc" ? "bg-rose-100 text-rose-900" : "bg-amber-100 text-amber-900"}`}>
                      {p.certitude === "franc" ? "⛔ Doublon certain" : "⚠ Doublon probable"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded font-semibold bg-slate-100 text-slate-700">
                      {p.famille === "depense" ? "💸 Facture fournisseur" : "🧾 Facture client"}
                    </span>
                    <strong className="text-slate-900">{p.libelle}</strong>
                  </div>
                  <p className="text-sm text-slate-600 mt-1">{p.raison}</p>
                </div>
                <button
                  onClick={() => ecarter(p)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold whitespace-nowrap"
                  title="Les deux pièces sont légitimes — ne plus signaler cette paire"
                >
                  ✓ Ce n'est pas un doublon
                </button>
              </div>

              {/* Les deux pièces côte à côte : c'est ce qui permet de trancher sans naviguer. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                {(p.pieces || []).map((piece: any) => (
                  <div key={piece.id} className="bg-slate-50 rounded p-3 text-sm">
                    <div className="flex justify-between items-baseline gap-2">
                      <span className="font-bold text-slate-900">
                        {p.famille === "depense" ? (piece.fournisseur || "Fournisseur inconnu") : (piece.numero || `Facture #${piece.id}`)}
                      </span>
                      <span className="font-bold text-slate-900">{formatCAD(piece.montant || 0)}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{dateLocale(piece.date)}</div>
                    {piece.description && <div className="text-xs text-slate-600 mt-1 line-clamp-2">{piece.description}</div>}
                    <div className="text-xs text-slate-500 mt-1">
                      🏗️ {piece.projet_nom || (piece.projet_id ? `Projet #${piece.projet_id}` : "Aucun chantier")}
                    </div>
                    {piece.projet_id && (
                      <a
                        href={`/projets/${piece.projet_id}`}
                        className="inline-flex items-center min-h-10 text-xs text-blue-600 hover:underline font-semibold"
                      >
                        Ouvrir le chantier pour corriger →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

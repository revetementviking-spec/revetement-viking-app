"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";
import { formatCAD } from "@/lib/calculateur";
import ModalExtra from "@/components/ModalExtra";

const ICONE: Record<string, string> = { montant: "💰", heures: "⏱️", materiaux: "📦" };

/** Liste + gestion des extras à facturer. Réutilisé par la page /extras et l'onglet
 *  Extras des Finances. */
export default function ExtrasVue() {
  const [onglet, setOnglet] = useState<"a_charger" | "charge">("a_charger");
  const [extras, setExtras] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const { toast } = useToast();

  const charger = async () => {
    setLoading(true);
    const d = await fetch(`/api/extras?statut=${onglet}`).then((r) => r.json()).catch(() => []);
    setExtras(Array.isArray(d) ? d : []);
    setLoading(false);
  };
  useEffect(() => { charger(); }, [onglet]);

  const basculer = async (e: any, charge: boolean) => {
    await fetch("/api/extras", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: e.id, statut: charge ? "charge" : "a_charger" }) });
    toast(charge ? "✓ Marqué facturé" : "Remis à facturer", "success");
    setExtras((arr) => arr.filter((x) => x.id !== e.id));
  };
  const supprimer = async (e: any) => {
    if (!confirm("Supprimer cet extra ?")) return;
    await fetch(`/api/extras?id=${e.id}`, { method: "DELETE" });
    toast("Extra supprimé", "info");
    setExtras((arr) => arr.filter((x) => x.id !== e.id));
  };

  const total = extras.reduce((s, e) => s + (e.montant || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2 border-b">
          <button onClick={() => setOnglet("a_charger")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${onglet === "a_charger" ? "border-amber-600 text-amber-700" : "border-transparent text-slate-500"}`}>À facturer</button>
          <button onClick={() => setOnglet("charge")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${onglet === "charge" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`}>Facturés</button>
        </div>
        <button onClick={() => setModal(true)} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-bold">＋ Extra</button>
      </div>

      {onglet === "a_charger" && extras.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm font-bold text-amber-900">
          {extras.length} extra(s) à facturer{total > 0 ? ` · ${formatCAD(total)}` : ""}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">Chargement…</div>
      ) : extras.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-slate-500">
          {onglet === "a_charger" ? "Aucun extra en attente de facturation 🎉" : "Aucun extra facturé pour l'instant."}
        </div>
      ) : (
        <div className="space-y-2">
          {extras.map((e) => (
            <div key={e.id} className="bg-white rounded-lg shadow p-4 flex gap-3">
              {e.a_photo && (
                <a href={`/api/extras/${e.id}/photo`} target="_blank" rel="noreferrer" className="flex-shrink-0">
                  <img src={`/api/extras/${e.id}/photo`} alt="Justif" className="w-16 h-16 object-cover rounded border" />
                </a>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-900">{ICONE[e.nature] || "💲"} {e.description}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {e.projet_nom || "Sans projet"} · {e.date}{e.saisi_par ? ` · saisi par ${e.saisi_par}` : ""}
                </div>
                <div className="text-sm font-bold text-amber-700 mt-1">
                  {e.montant ? formatCAD(e.montant) : e.heures ? `${e.heures} h` : e.nature === "materiaux" ? "Matériaux — montant à déterminer" : "Montant à déterminer"}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                {onglet === "a_charger" ? (
                  <button onClick={() => basculer(e, true)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold whitespace-nowrap">✓ Facturé</button>
                ) : (
                  <button onClick={() => basculer(e, false)} className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded text-xs font-bold whitespace-nowrap">↩ Rouvrir</button>
                )}
                <button onClick={() => supprimer(e)} className="px-3 py-1.5 text-red-600 hover:bg-red-50 rounded text-xs font-semibold">🗑 Suppr.</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ModalExtra ouvert={modal} onClose={() => setModal(false)} onSuccess={charger} />
    </div>
  );
}

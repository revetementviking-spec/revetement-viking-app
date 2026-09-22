"use client";

import { useEffect, useRef, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import { nombreSaisi } from "@/lib/calculs";
import { aujourdhuiMontreal } from "@/lib/date";

/** Facturation d'un projet : la table `factures_projet` et son API existaient depuis
 *  longtemps, mais AUCUN écran ne les alimentait — d'où « Facturé / Encaissé / À recevoir »
 *  bloqués à 0 $ partout (fiche projet, Finances, rapport hebdo, alertes de factures
 *  impayées). C'est l'écran qui manquait. */
export default function FacturesProjet({ projetId, onChange }: { projetId: number; onChange?: () => void }) {
  const [factures, setFactures] = useState<any[]>([]);
  const [ouvert, setOuvert] = useState(false);
  const [busy, setBusy] = useState(false);
  const aujourdhui = aujourdhuiMontreal();
  const [form, setForm] = useState({ numero: "", montant: "", date: aujourdhui, description: "" });
  const { toast } = useToast();

  const charger = async () => {
    try {
      const r = await fetch(`/api/factures?projet_id=${projetId}`, { cache: "no-store" });
      const d = await r.json();
      setFactures(Array.isArray(d) ? d : []);
    } catch { setFactures([]); }
  };
  useEffect(() => { charger(); }, [projetId]);

  const rafraichir = () => { charger(); onChange?.(); };

  // Verrou par référence (lib/verrou.ts) : deux clics du même instant créaient deux factures
  // — et doublaient « Facturé / À recevoir ».
  const enCours = useRef(false);
  const ajouter = async () => {
    if (enCours.current) return;
    enCours.current = true;
    try { await ajouterReel(); } finally { enCours.current = false; }
  };
  const ajouterReel = async () => {
    // Virgule décimale acceptée, comme partout ailleurs dans l'app.
    const montant = nombreSaisi(form.montant);
    if (!isFinite(montant) || montant === 0) { toast("Montant invalide", "warning"); return; }
    if (!form.date) { toast("Date requise", "warning"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/factures", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projet_id: projetId, numero: form.numero.trim() || null, montant, date: form.date, description: form.description.trim() || null }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({} as any));
        toast(d?.error || "Échec de l'enregistrement", "error");
        return;
      }
      toast(`✓ Facture de ${formatCAD(montant)} ajoutée`, "success");
      // Doublon possible : on le dit TOUT DE SUITE, pendant que la facture est sous les
      // yeux. La facture est bel et bien enregistrée — c'est un avertissement, pas un
      // refus : deux versements égaux sur un même contrat, ça existe.
      const d = await r.json().catch(() => ({} as any));
      if (Array.isArray(d?.doublons) && d.doublons.length > 0) {
        toast(`⚠ ${d.doublons[0].raison} — à vérifier dans Finances → Doublons`, "warning");
      }
      setForm({ numero: "", montant: "", date: aujourdhui, description: "" });
      setOuvert(false);
      rafraichir();
    } catch (e: any) {
      toast(`Réseau indisponible — facture non enregistrée`, "error");
    } finally { setBusy(false); }
  };

  const basculerPaiement = async (f: any) => {
    const payee = !!f.payee;
    if (payee && !confirm(`Annuler le paiement de ${formatCAD(f.montant)} ?`)) return;
    try {
      const r = await fetch("/api/factures", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: f.id, action: payee ? "annuler_paiement" : "marquer_payee" }),
      });
      if (!r.ok) { toast("Échec — statut inchangé", "error"); return; }
      toast(payee ? "Paiement annulé" : `✓ Encaissé : ${formatCAD(f.montant)}`, "success");
      rafraichir();
    } catch { toast("Réseau indisponible", "error"); }
  };

  const supprimer = async (f: any) => {
    if (!confirm(`Supprimer la facture ${f.numero || ""} de ${formatCAD(f.montant)} ?`)) return;
    try {
      const r = await fetch(`/api/factures?id=${f.id}`, { method: "DELETE" });
      if (!r.ok) {
        // Le serveur refuse désormais de supprimer une facture ENCAISSÉE et explique
        // quoi faire (annuler le paiement d'abord). « Échec de la suppression » tout
        // court laissait l'utilisateur devant un mur.
        const d = await r.json().catch(() => ({} as any));
        toast(d?.message || d?.error || "Échec de la suppression", "error");
        return;
      }
      toast("Facture supprimée", "info");
      rafraichir();
    } catch { toast("Réseau indisponible", "error"); }
  };

  const totalFacture = factures.reduce((s, f) => s + (+f.montant || 0), 0);
  const totalPaye = factures.filter((f) => f.payee).reduce((s, f) => s + (+f.montant || 0), 0);
  const aRecevoir = totalFacture - totalPaye;

  return (
    <section className="bg-white rounded-lg shadow p-4 md:p-5 space-y-3">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h2 className="font-bold">🧾 Facturation ({factures.length})</h2>
        <button onClick={() => setOuvert((o) => !o)} className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold">
          {ouvert ? "Annuler" : "＋ Nouvelle facture"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-blue-50 rounded p-2">
          <div className="text-[10px] text-blue-700 uppercase font-semibold">Facturé</div>
          <div className="font-bold text-blue-900">{formatCAD(totalFacture)}</div>
        </div>
        <div className="bg-emerald-50 rounded p-2">
          <div className="text-[10px] text-emerald-700 uppercase font-semibold">Encaissé</div>
          <div className="font-bold text-emerald-900">{formatCAD(totalPaye)}</div>
        </div>
        <div className={`rounded p-2 ${aRecevoir > 0 ? "bg-amber-50" : "bg-slate-50"}`}>
          <div className={`text-[10px] uppercase font-semibold ${aRecevoir > 0 ? "text-amber-700" : "text-slate-500"}`}>À recevoir</div>
          <div className={`font-bold ${aRecevoir > 0 ? "text-amber-900" : "text-slate-500"}`}>{formatCAD(aRecevoir)}</div>
        </div>
      </div>

      {ouvert && (
        <div className="border-2 border-emerald-200 bg-emerald-50/40 rounded-lg p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] font-medium text-slate-600">N° de facture (optionnel)</span>
              <input type="text" value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} placeholder="F-001" className="w-full mt-0.5 px-3 py-2 border rounded text-sm" />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium text-slate-600">Date *</span>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full mt-0.5 px-3 py-2 border rounded text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] font-medium text-slate-600">Montant * <span className="text-slate-400">(taxes incluses · négatif = note de crédit)</span></span>
            <input type="text" inputMode="decimal" value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} placeholder="5 000,00" className="w-full mt-0.5 px-3 py-2 border rounded text-sm text-right font-semibold" />
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-slate-600">Description</span>
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Acompte, 2e versement, balance finale…" className="w-full mt-0.5 px-3 py-2 border rounded text-sm" />
          </label>
          <button onClick={ajouter} disabled={busy} className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-bold text-sm">
            {busy ? "⏳…" : "💾 Enregistrer la facture"}
          </button>
        </div>
      )}

      {factures.length === 0 ? (
        <p className="text-sm text-slate-500 italic">Aucune facture. Ajoute-les ici pour suivre ce qui est facturé et ce qui reste à encaisser.</p>
      ) : (
        <ul className="space-y-1.5">
          {factures.map((f) => (
            <li key={f.id} className={`flex items-center gap-2 border rounded p-2 text-sm ${f.payee ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
              <span className="text-lg">{f.payee ? "✅" : "🧾"}</span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">
                  {f.numero ? `${f.numero} · ` : ""}{formatCAD(f.montant)}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  {f.date}{f.description ? ` · ${f.description}` : ""}
                  {f.payee && f.date_paiement ? ` · encaissée le ${f.date_paiement}` : ""}
                </div>
              </div>
              <button onClick={() => basculerPaiement(f)} className={`px-2 py-1 rounded text-[11px] font-bold whitespace-nowrap ${f.payee ? "bg-slate-200 hover:bg-slate-300 text-slate-700" : "bg-emerald-600 hover:bg-emerald-500 text-white"}`}>
                {f.payee ? "↺ Non payée" : "💵 Encaissée"}
              </button>
              {/* Geste destructif sur une facture : cible d'au moins 44 px au doigt,
                  sinon elle est à 24 px juste à côté du bouton « Encaissée ». */}
              <button onClick={() => supprimer(f)} aria-label="Supprimer la facture" className="min-w-[44px] min-h-[44px] flex items-center justify-center text-red-600 hover:bg-red-50 rounded text-[13px]">🗑</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

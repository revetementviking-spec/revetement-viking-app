"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import FAB from "@/components/FAB";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";

const STATUTS: Record<string, { l: string; c: string }> = {
  brouillon: { l: "Brouillon", c: "bg-slate-200 text-slate-700" },
  envoye: { l: "Envoyé", c: "bg-blue-100 text-blue-900" },
  signe: { l: "Signé ✓", c: "bg-emerald-100 text-emerald-900" },
  refuse: { l: "Refusé", c: "bg-red-100 text-red-900" },
  annule: { l: "Annulé", c: "bg-slate-300 text-slate-700" },
};

export default function ContratsPage() {
  const [contrats, setContrats] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [creerOuvert, setCreerOuvert] = useState(false);
  const [filtre, setFiltre] = useState("");
  const [form, setForm] = useState<any>({
    titre: "", client_id: "", date_emission: new Date().toISOString().slice(0, 10),
    date_debut_travaux: "", date_fin_prevue: "",
    montant_avant_taxes: "", depot_pct: 30,
    description_travaux: "", garantie: "", conditions: "",
  });
  const { toast } = useToast();

  const charger = async () => {
    const [c, cl] = await Promise.all([
      fetch(filtre ? `/api/contrats?statut=${filtre}` : "/api/contrats").then((r) => r.json()),
      fetch("/api/clients").then((r) => r.json()),
    ]);
    setContrats(c);
    setClients(cl);
  };

  useEffect(() => { charger(); }, [filtre]);

  const creer = async () => {
    if (!form.titre || !form.client_id) { toast("Titre et client requis", "warning"); return; }
    const avant = +form.montant_avant_taxes || 0;
    const total = avant * 1.14975;
    const depot = total * (form.depot_pct / 100);
    const payload = { ...form, montant_avant_taxes: avant, montant_total: total, depot_montant: depot, client_id: +form.client_id };
    const r = await fetch("/api/contrats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (d.ok) {
      toast(`Contrat ${d.numero} créé`, "success");
      setCreerOuvert(false);
      setForm({ ...form, titre: "", client_id: "", montant_avant_taxes: "", description_travaux: "" });
      charger();
    }
  };

  const telechargerPDF = async (c: any) => {
    const detail = await fetch(`/api/contrats?id=${c.id}`).then((r) => r.json());
    const { genererContratBlob } = await import("@/lib/pdf-contrat");
    const blob = await genererContratBlob(detail);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Contrat-${c.numero}.pdf`; a.click();
    URL.revokeObjectURL(url);
  };

  const envoyer = async (c: any) => {
    const detail = await fetch(`/api/contrats?id=${c.id}`).then((r) => r.json());
    if (!detail.client_courriel) { toast("Pas de courriel client", "warning"); return; }
    await telechargerPDF(c);
    await fetch("/api/contrats", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, statut: "envoye" }) });
    const sujet = `Contrat ${c.numero} - Revêtement Viking Inc.`;
    const corps = `Bonjour ${detail.client_nom},

Vous trouverez ci-joint le contrat ${c.numero} pour les travaux : ${detail.titre}.

Montant total : ${formatCAD(detail.montant_total || 0)}
Dépôt requis à la signature : ${formatCAD(detail.depot_montant || 0)} (${detail.depot_pct}%)

Le PDF vient d'être téléchargé sur votre appareil. Veuillez le joindre à ce courriel avant d'envoyer.

Une fois signé, scannez-le et retournez-le à : info@entreprisesxpress.ca

Cordialement,
Revêtement Viking Inc.
RBQ 5811-4299-01`;
    window.location.href = `mailto:${detail.client_courriel}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
    setTimeout(charger, 500);
  };

  const marquerSigne = async (c: any) => {
    await fetch("/api/contrats", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, statut: "signe", signe_par_client: 1, date_signature: new Date().toISOString().slice(0, 10) }) });
    toast("Contrat marqué signé ✓", "success");
    charger();
  };

  const supprimer = async (id: number) => {
    if (!confirm("Supprimer ce contrat ?")) return;
    await fetch(`/api/contrats?id=${id}`, { method: "DELETE" });
    charger();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation
        titre="📝 Contrats"
        soustitre={`${contrats.length} contrat(s)`}
        actions={<button onClick={() => setCreerOuvert(true)} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold text-left">➕ Nouveau contrat</button>}
      />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* Filtres */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFiltre("")} className={`px-3 py-1 rounded text-sm ${!filtre ? "bg-slate-900 text-white" : "bg-white border"}`}>Tous</button>
          {Object.entries(STATUTS).map(([k, v]) => (
            <button key={k} onClick={() => setFiltre(k)} className={`px-3 py-1 rounded text-sm ${filtre === k ? "bg-slate-900 text-white" : v.c}`}>{v.l}</button>
          ))}
        </div>

        {contrats.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">📝</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucun contrat</h3>
            <p className="text-sm text-slate-500 mb-4">Crée un contrat à partir d'une soumission acceptée.</p>
            <button onClick={() => setCreerOuvert(true)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Premier contrat</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {contrats.map((c) => (
              <div key={c.id} className="bg-white rounded-lg shadow p-4 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 truncate">{c.titre}</div>
                    <div className="text-xs text-slate-500">{c.numero} · {c.client_nom || "Sans client"}</div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap font-semibold ${STATUTS[c.statut]?.c || "bg-slate-200"}`}>{STATUTS[c.statut]?.l || c.statut}</span>
                </div>
                <div className="text-xs space-y-0.5">
                  <div className="flex justify-between"><span className="text-slate-500">Émis :</span><span>{c.date_emission}</span></div>
                  {c.date_debut_travaux && <div className="flex justify-between"><span className="text-slate-500">Début :</span><span>{c.date_debut_travaux}</span></div>}
                  <div className="flex justify-between"><span className="text-slate-500">Montant total :</span><strong className="text-emerald-700">{formatCAD(c.montant_total || 0)}</strong></div>
                  <div className="flex justify-between"><span className="text-slate-500">Dépôt :</span><span>{formatCAD(c.depot_montant || 0)} ({c.depot_pct}%)</span></div>
                </div>
                <div className="flex gap-1 pt-2 border-t flex-wrap">
                  <button onClick={() => telechargerPDF(c)} className="flex-1 px-2 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded text-xs font-bold">📄 PDF</button>
                  <button onClick={() => envoyer(c)} className="flex-1 px-2 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-900 rounded text-xs font-bold">✉️ Envoyer</button>
                  {c.statut !== "signe" && <button onClick={() => marquerSigne(c)} className="flex-1 px-2 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 rounded text-xs font-bold">✓ Signé</button>}
                  <button onClick={() => supprimer(c.id)} className="px-2 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs">🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {creerOuvert && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setCreerOuvert(false)}>
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-lg w-full p-5 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">Nouveau contrat</h3>

            <In label="Titre du contrat *" v={form.titre} o={(v) => setForm({ ...form, titre: v })} placeholder="Ex: Revêtement extérieur résidence Tremblay" />

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Client *</label>
              <select value={form.client_id} onChange={(e) => setForm({ ...form, client_id: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                <option value="">— Choisir —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}{c.adresse ? ` (${c.adresse.slice(0, 30)})` : ""}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date émission</label>
                <input type="date" value={form.date_emission} onChange={(e) => setForm({ ...form, date_emission: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
              </div>
              <In label="Montant avant taxes $ *" v={form.montant_avant_taxes} o={(v) => setForm({ ...form, montant_avant_taxes: v })} type="number" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Début travaux</label>
                <input type="date" value={form.date_debut_travaux} onChange={(e) => setForm({ ...form, date_debut_travaux: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Fin prévue</label>
                <input type="date" value={form.date_fin_prevue} onChange={(e) => setForm({ ...form, date_fin_prevue: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Dépôt %</label>
              <input type="number" value={form.depot_pct} onChange={(e) => setForm({ ...form, depot_pct: +e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Description des travaux</label>
              <textarea value={form.description_travaux} onChange={(e) => setForm({ ...form, description_travaux: e.target.value })} rows={3} className="w-full px-3 py-2 border rounded text-sm" />
            </div>

            <details>
              <summary className="text-xs font-semibold cursor-pointer text-emerald-700">Conditions et garantie personnalisées</summary>
              <div className="space-y-2 mt-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Garantie</label>
                  <textarea value={form.garantie} onChange={(e) => setForm({ ...form, garantie: e.target.value })} rows={2} placeholder="Laisser vide pour garantie standard 1 an" className="w-full px-3 py-2 border rounded text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Conditions générales</label>
                  <textarea value={form.conditions} onChange={(e) => setForm({ ...form, conditions: e.target.value })} rows={3} placeholder="Laisser vide pour conditions standard" className="w-full px-3 py-2 border rounded text-sm" />
                </div>
              </div>
            </details>

            <div className="bg-emerald-50 p-3 rounded text-sm">
              <div className="flex justify-between"><span>Sous-total :</span><strong>{formatCAD(+form.montant_avant_taxes || 0)}</strong></div>
              <div className="flex justify-between"><span>Avec taxes (14.975%) :</span><strong>{formatCAD((+form.montant_avant_taxes || 0) * 1.14975)}</strong></div>
              <div className="flex justify-between text-emerald-900"><span>Dépôt {form.depot_pct}% :</span><strong>{formatCAD((+form.montant_avant_taxes || 0) * 1.14975 * (form.depot_pct / 100))}</strong></div>
            </div>

            <div className="flex gap-2 justify-end pt-2 sticky bottom-0 bg-white">
              <button onClick={() => setCreerOuvert(false)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={creer} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">Créer le contrat</button>
            </div>
          </div>
        </div>
      )}

      <FAB />
    </div>
  );
}

function In({ label, v, o, type = "text", placeholder }: { label: string; v: string; o: (v: string) => void; type?: string; placeholder?: string }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type={type} value={v} onChange={(e) => o(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import Navigation from "@/components/Navigation";
import FAB from "@/components/FAB";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import { aujourdhuiMontreal } from "@/lib/date";
import { ecrire, envoyer as envoyerEcriture, nombreSaisi, lireListe, lireJson } from "@/lib/envoi";
import ErreurChargement from "@/components/ErreurChargement";
import Modale from "@/components/Modale";
import Pagination, { usePagination } from "@/components/Pagination";

// Courriel de retour des contrats signés : celui de l'entreprise (lib/pdf-contrat.tsx,
// ENTREPRISE.courriel) — pas celui d'Entreprises Xpress. Recopié ici plutôt qu'importé :
// importer pdf-contrat.tsx tirerait tout @react-pdf dans le paquet de cette page.
const COURRIEL_ENTREPRISE = "revetementviking@gmail.com";

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
    titre: "", client_id: "", date_emission: aujourdhuiMontreal(),
    date_debut_travaux: "", date_fin_prevue: "",
    montant_avant_taxes: "", depot_pct: "30",
    description_travaux: "", garantie: "", conditions: "",
  });
  const { toast } = useToast();

  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const charger = async () => {
    setChargement(true);
    try {
      // Lectures avec filet : un 500 faisait planter le rendu sur `.map` d'un objet d'erreur.
      const [c, cl] = await Promise.all([
        lireListe(filtre ? `/api/contrats?statut=${filtre}` : "/api/contrats"),
        lireListe("/api/clients"),
      ]);
      if (!c.ok) { setErreur(c.erreur); return; }
      setErreur(null);
      setContrats(c.data);
      if (cl.ok) setClients(cl.data);
    } finally { setChargement(false); }
  };

  useEffect(() => { charger(); }, [filtre]);

  // Pagination de l'affichage (50 par page) ; retour à la page 1 quand le filtre change.
  const pg = usePagination(contrats.length, 50);
  const contratsVisibles = contrats.slice(pg.debut, pg.fin);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { pg.reset(); }, [filtre]);

  const creationEnCours = useRef(false);
  const creer = async () => {
    // Verrou par ref (lib/verrou.ts) : deux clics du même instant créaient deux contrats.
    if (creationEnCours.current) return;
    if (!form.titre || !form.client_id) { toast("Titre et client requis", "warning"); return; }
    // Virgule décimale (clavier québécois) : `+"12 500,50"` donnait NaN → `|| 0` → un
    // contrat créé à 0 $, sans un mot. nombreSaisi() lit « 12 500,50 $ » correctement.
    const avant = nombreSaisi(form.montant_avant_taxes);
    if (!Number.isFinite(avant) || avant <= 0) { toast("Montant avant taxes invalide (ex. : 12 500,50)", "warning"); return; }
    const depotPct = nombreSaisi(form.depot_pct);
    if (!Number.isFinite(depotPct) || depotPct < 0 || depotPct > 100) { toast("Dépôt invalide : un pourcentage entre 0 et 100", "warning"); return; }
    const total = avant * 1.14975;
    const depot = total * (depotPct / 100);
    const payload = { ...form, depot_pct: depotPct, montant_avant_taxes: avant, montant_total: total, depot_montant: depot, client_id: +form.client_id };
    creationEnCours.current = true;
    try {
      const res = await envoyerEcriture<{ numero?: string }>("/api/contrats", { corps: payload });
      if (!res.ok) { toast(`Contrat NON créé : ${res.erreur}`, "error"); return; }
      toast(`Contrat ${res.data?.numero} créé`, "success");
      setCreerOuvert(false);
      setForm({ ...form, titre: "", client_id: "", montant_avant_taxes: "", description_travaux: "" });
      charger();
    } finally { creationEnCours.current = false; }
  };

  const lireDetail = async (c: any): Promise<any | null> => {
    const r = await lireJson<any>(`/api/contrats?id=${c.id}`);
    if (!r.ok || !r.data || !r.data.id) { toast(`Contrat ${c.numero} illisible : ${r.ok ? "introuvable" : r.erreur}`, "error"); return null; }
    return r.data;
  };

  const telechargerPDF = async (c: any): Promise<boolean> => {
    const detail = await lireDetail(c);
    if (!detail) return false;
    const { genererContratBlob } = await import("@/lib/pdf-contrat");
    const blob = await genererContratBlob(detail);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Contrat-${c.numero}.pdf`; a.click();
    URL.revokeObjectURL(url);
    return true;
  };

  const envoyer = async (c: any) => {
    const detail = await lireDetail(c);
    if (!detail) return;
    if (!detail.client_courriel) { toast("Pas de courriel client", "warning"); return; }
    if (!(await telechargerPDF(c))) return;
    if (!(await ecrire("/api/contrats", "PATCH", { id: c.id, statut: "envoye" }, "Enregistrement"))) return;
    const sujet = `Contrat ${c.numero} - Revêtement Viking Inc.`;
    const corps = `Bonjour ${detail.client_nom},

Vous trouverez ci-joint le contrat ${c.numero} pour les travaux : ${detail.titre}.

Montant total : ${formatCAD(detail.montant_total || 0)}
Dépôt requis à la signature : ${formatCAD(detail.depot_montant || 0)} (${detail.depot_pct}%)

Le PDF vient d'être téléchargé sur votre appareil. Veuillez le joindre à ce courriel avant d'envoyer.

Une fois signé, scannez-le et retournez-le à : ${COURRIEL_ENTREPRISE}

Cordialement,
Revêtement Viking Inc.
RBQ 5811-4299-01`;
    window.location.href = `mailto:${detail.client_courriel}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
    setTimeout(charger, 500);
  };

  const marquerSigne = async (c: any) => {
    if (!(await ecrire("/api/contrats", "PATCH", { id: c.id, statut: "signe", signe_par_client: 1, date_signature: aujourdhuiMontreal() }, "Enregistrement"))) return;
    toast("Contrat marqué signé ✓", "success");
    charger();
  };

  const supprimer = async (id: number) => {
    if (!confirm("Supprimer ce contrat ?")) return;
    if (!(await ecrire(`/api/contrats?id=${id}`, "DELETE", undefined, "Suppression"))) return;
    toast("Contrat supprimé", "info");
    charger();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation
        titre="📝 Contrats"
        soustitre={`${contrats.length} contrat(s)`}
        actions={<>
          {/* Deux parcours distincts : le contrat interne de cet écran (suivi maison), et
              le contrat à faire signer en ligne par le client (page dédiée, devis joint,
              certificat d'authentification, projet créé à la signature). */}
          <a href="/contrats/nouveau" className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded text-sm font-semibold text-left inline-block">✍️ Contrat à faire signer</a>
          <button onClick={() => setCreerOuvert(true)} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold text-left">➕ Nouveau contrat</button>
        </>}
      />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* Filtres */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setFiltre("")} className={`px-3 py-1 rounded text-sm ${!filtre ? "bg-slate-900 text-white" : "bg-white border"}`}>Tous</button>
          {Object.entries(STATUTS).map(([k, v]) => (
            <button key={k} onClick={() => setFiltre(k)} className={`px-3 py-1 rounded text-sm ${filtre === k ? "bg-slate-900 text-white" : v.c}`}>{v.l}</button>
          ))}
        </div>

        {erreur ? (
          <ErreurChargement erreur={erreur} onReessayer={charger} />
        ) : chargement && contrats.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-6 text-center text-slate-500">Chargement...</div>
        ) : contrats.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">📝</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucun contrat</h3>
            <p className="text-sm text-slate-500 mb-4">Crée un contrat à partir d'une soumission acceptée.</p>
            <button onClick={() => setCreerOuvert(true)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Premier contrat</button>
          </div>
        ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {contratsVisibles.map((c) => (
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
                  <button onClick={() => supprimer(c.id)} aria-label={`Supprimer le contrat ${c.numero}`} className="min-w-11 min-h-11 inline-flex items-center justify-center bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs">🗑</button>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-lg shadow">
            <Pagination total={contrats.length} page={pg.page} pageSize={pg.pageSize} onPage={pg.setPage} onPageSize={pg.setPageSize} label="contrats" />
          </div>
          </>
        )}
      </main>

      {creerOuvert && (
        <Modale onClose={() => setCreerOuvert(false)} titre="Nouveau contrat" className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
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
              {/* type="text" + inputMode : un champ number refuse « 12 500,50 » (virgule du clavier québécois). */}
              <In label="Montant avant taxes $ *" v={form.montant_avant_taxes} o={(v) => setForm({ ...form, montant_avant_taxes: v })} inputMode="decimal" placeholder="Ex. : 12 500,50" />
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
              <input type="text" inputMode="decimal" value={form.depot_pct} onChange={(e) => setForm({ ...form, depot_pct: e.target.value })} placeholder="Ex. : 30" className="w-full px-3 py-2 border rounded text-sm" />
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

            {(() => {
              // Aperçu calculé avec nombreSaisi : `+"12 500,50"` donnait NaN → « 0,00 $ ».
              const avant = nombreSaisi(form.montant_avant_taxes) || 0;
              const pct = nombreSaisi(form.depot_pct) || 0;
              return (
                <div className="bg-emerald-50 p-3 rounded text-sm">
                  <div className="flex justify-between"><span>Sous-total :</span><strong>{formatCAD(avant)}</strong></div>
                  <div className="flex justify-between"><span>Avec taxes (14,975 %) :</span><strong>{formatCAD(avant * 1.14975)}</strong></div>
                  <div className="flex justify-between text-emerald-900"><span>Dépôt {form.depot_pct} % :</span><strong>{formatCAD(avant * 1.14975 * (pct / 100))}</strong></div>
                </div>
              );
            })()}

            <div className="flex gap-2 justify-end pt-2 sticky bottom-0 bg-white">
              <button onClick={() => setCreerOuvert(false)} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={creer} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">Créer le contrat</button>
            </div>
          </div>
        </Modale>
      )}

      <FAB />
    </div>
  );
}

function In({ label, v, o, type = "text", placeholder, inputMode }: { label: string; v: string; o: (v: string) => void; type?: string; placeholder?: string; inputMode?: "decimal" | "numeric" | "text" }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type={type} inputMode={inputMode} value={v} onChange={(e) => o(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}

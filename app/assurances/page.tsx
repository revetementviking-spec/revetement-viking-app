"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import { formatCAD } from "@/lib/calculateur";
import ZoneDepot from "@/components/ZoneDepot";
import { ecrire, lireListe, nombreSaisi } from "@/lib/envoi";
import { fichierTropLourd } from "@/lib/limites-fichiers";
import { useVerrou } from "@/lib/verrou";
import ErreurChargement from "@/components/ErreurChargement";
import Modale from "@/components/Modale";

const TYPES = ["Auto / flotte", "Responsabilité civile", "Chantier / RBQ", "Équipement / outils", "Cautionnement", "Autre"];

function joursAvant(dateISO?: string): number | null {
  if (!dateISO) return null;
  const [y, m, d] = dateISO.split("-").map(Number);
  const cible = new Date(y, (m || 1) - 1, d || 1);
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  return Math.round((cible.getTime() - auj.getTime()) / 86400000);
}

export default function AssurancesPage() {
  const [assurances, setAssurances] = useState<any[]>([]);
  const [vehicules, setVehicules] = useState<any[]>([]);
  const [creerOuvert, setCreerOuvert] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [docOuvert, setDocOuvert] = useState<{ id: number; type?: string } | null>(null);
  const vide = { type: "Auto / flotte", compagnie: "", numero_police: "", vehicule_id: "", date_debut: "", date_renouvellement: "", prime_annuelle: "", notes: "", document_data: "", document_type: "" };
  const [form, setForm] = useState<any>(vide);
  const { toast } = useToast();

  const [erreur, setErreur] = useState<string | null>(null);
  const charger = () => {
    // Lectures avec filet : un 500 faisait planter le rendu sur `.reduce` d'un objet d'erreur.
    lireListe("/api/assurances").then((r) => { if (r.ok) { setErreur(null); setAssurances(r.data); } else setErreur(r.erreur); });
    lireListe("/api/vehicules").then((r) => { if (r.ok) setVehicules(r.data); });
  };
  useEffect(() => { charger(); }, []);

  const traiterDoc = (f?: File) => {
    if (!f) return;
    const tropLourd = fichierTropLourd(f);
    if (tropLourd) { toast(tropLourd, "warning"); return; }
    const reader = new FileReader();
    reader.onload = () => setForm((x: any) => ({ ...x, document_data: reader.result, document_type: f.type }));
    reader.readAsDataURL(f);
  };
  const uploadDoc = (e: React.ChangeEvent<HTMLInputElement>) => traiterDoc(e.target.files?.[0]);

  // Verrou par ref (lib/verrou.ts) : deux clics du même instant créaient deux polices.
  const verrou = useVerrou();
  const sauver = () => verrou.executer(async () => {
    if (!form.compagnie?.trim() && !form.type?.trim()) { toast("Type ou compagnie requis", "warning"); return; }
    // nombreSaisi et non `+` : « 1 250,50 » (virgule du clavier québécois) donnait NaN → null.
    const prime = form.prime_annuelle ? nombreSaisi(form.prime_annuelle) : null;
    if (prime !== null && !Number.isFinite(prime)) { toast("Prime annuelle illisible (ex. : 1 250,50)", "warning"); return; }
    const body = { ...form, vehicule_id: form.vehicule_id ? +form.vehicule_id : null, prime_annuelle: prime, ...(edit ? { id: edit.id } : {}) };
    // Avant : fetch nu + r.json() — sur un 413 (document trop lourd, réponse HTML de la
    // plateforme), le JSON.parse levait et l'écran restait muet, formulaire ouvert.
    if (!(await ecrire("/api/assurances", edit ? "PATCH" : "POST", body, "Enregistrement"))) return;
    toast(edit ? "Assurance modifiée" : "Assurance ajoutée", "success");
    setCreerOuvert(false); setEdit(null); setForm(vide); charger();
  });
  const supprimer = async (id: number) => {
    if (!confirm("Supprimer cette assurance ?")) return;
    if (!(await ecrire(`/api/assurances?id=${id}`, "DELETE", undefined, "Suppression"))) return;
    toast("Supprimée", "info"); charger();
  };
  const ouvrirEdit = (a: any) => { setEdit(a); setForm({ ...vide, ...a, vehicule_id: a.vehicule_id || "", prime_annuelle: a.prime_annuelle != null ? String(a.prime_annuelle) : "", document_data: "", document_type: a.document_type || "" }); setCreerOuvert(true); };

  const totalPrimes = assurances.reduce((s, a) => s + (a.prime_annuelle || 0), 0);
  const aRenouveler = assurances.filter((a) => { const j = joursAvant(a.date_renouvellement); return j !== null && j <= 45; });

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="🛡️ Assurances" soustitre={`${assurances.length} police(s) · ${formatCAD(totalPrimes)}/an`} />
      <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
        <button onClick={() => { setEdit(null); setForm(vide); setCreerOuvert(true); }} className="w-full md:w-auto px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold shadow">➕ Ajouter une assurance</button>

        {/* Alerte renouvellements à magasiner */}
        {aRenouveler.length > 0 && (
          <section className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4">
            <h2 className="font-bold text-amber-900 mb-2">⏰ À magasiner — renouvellement dans moins de 45 jours</h2>
            <div className="space-y-1">
              {aRenouveler.map((a) => {
                const j = joursAvant(a.date_renouvellement)!;
                return (
                  <div key={a.id} className="flex justify-between text-sm bg-white rounded px-3 py-2 border border-amber-200">
                    <span className="font-semibold">{a.compagnie || a.type}</span>
                    <span className={j <= 14 ? "text-red-700 font-bold" : "text-amber-700"}>{j < 0 ? `Expiré depuis ${-j} j` : `dans ${j} jours`} ({a.date_renouvellement})</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {erreur ? (
          <ErreurChargement erreur={erreur} onReessayer={charger} />
        ) : assurances.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center text-slate-500"><div className="text-5xl mb-3">🛡️</div>Aucune assurance enregistrée.</div>
        ) : (
          <div className="space-y-3">
            {assurances.map((a) => {
              const j = joursAvant(a.date_renouvellement);
              const vehic = vehicules.find((v) => v.id === a.vehicule_id);
              return (
                <div key={a.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900">{a.compagnie || "—"}</div>
                      <div className="text-xs text-slate-500">{a.type}{a.numero_police ? ` · police ${a.numero_police}` : ""}{vehic ? ` · ${vehic.nom}` : ""}</div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      {(a.a_document || a.document_type) && <button onClick={() => setDocOuvert({ id: a.id, type: a.document_type })} className="min-h-11 px-2 inline-flex items-center text-xs text-blue-700 hover:underline">📎 Doc</button>}
                      <button onClick={() => ouvrirEdit(a)} aria-label={`Modifier l'assurance ${a.compagnie || a.type}`} className="min-w-11 min-h-11 inline-flex items-center justify-center text-xs text-emerald-700 hover:bg-emerald-50 rounded">✏️</button>
                      <button onClick={() => supprimer(a.id)} aria-label={`Supprimer l'assurance ${a.compagnie || a.type}`} className="min-w-11 min-h-11 inline-flex items-center justify-center text-xs text-red-600 hover:bg-red-50 rounded">🗑</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2 text-sm">
                    {a.prime_annuelle != null && <div><span className="text-slate-500 text-xs">Prime/an</span><div className="font-bold">{formatCAD(a.prime_annuelle)}</div></div>}
                    {a.date_debut && <div><span className="text-slate-500 text-xs">Début</span><div>{a.date_debut}</div></div>}
                    {a.date_renouvellement && (
                      <div>
                        <span className="text-slate-500 text-xs">Renouvellement</span>
                        <div className={`font-bold ${j !== null && j <= 14 ? "text-red-700" : j !== null && j <= 45 ? "text-amber-700" : ""}`}>
                          {a.date_renouvellement}{j !== null && ` (${j < 0 ? "expiré" : j + " j"})`}
                        </div>
                      </div>
                    )}
                  </div>
                  {a.notes && <div className="text-xs italic text-slate-600 mt-2 p-2 bg-slate-50 rounded">{a.notes}</div>}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Modal créer/éditer */}
      {creerOuvert && (
        <Modale onClose={() => setCreerOuvert(false)} titre={edit ? "Modifier l'assurance" : "Nouvelle assurance"} className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{edit ? "Modifier" : "Nouvelle"} assurance</h3>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <I label="Compagnie" v={form.compagnie} on={(x: string) => setForm({ ...form, compagnie: x })} ph="Ex: Intact, Promutuel" />
            <I label="N° de police" v={form.numero_police} on={(x: string) => setForm({ ...form, numero_police: x })} />
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Véhicule lié (optionnel)</label>
              <select value={form.vehicule_id} onChange={(e) => setForm({ ...form, vehicule_id: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                <option value="">— Aucun —</option>
                {vehicules.map((v) => <option key={v.id} value={v.id}>{v.nom}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <I label="Début" v={form.date_debut} on={(x: string) => setForm({ ...form, date_debut: x })} type="date" />
              <I label="Renouvellement" v={form.date_renouvellement} on={(x: string) => setForm({ ...form, date_renouvellement: x })} type="date" />
            </div>
            {/* type="text" + inputMode : un champ number refuse « 1 250,50 » (virgule du clavier québécois). */}
            <I label="Prime annuelle ($)" v={form.prime_annuelle} on={(x: string) => setForm({ ...form, prime_annuelle: x })} inputMode="decimal" ph="Ex. : 1 250,50" />
            <ZoneDepot onFichiers={(files) => traiterDoc(files[0])} accept="image/*,application/pdf" multiple={false} messageSurvol="📎 Dépose le document">
            <div className="border border-dashed border-slate-300 rounded p-2">
              <label className="block text-xs font-medium text-slate-600 mb-1">Document (police PDF/photo) — glisse-dépose accepté</label>
              {form.document_data ? <div className="text-xs text-emerald-700 mb-1">✓ Nouveau document chargé</div> : edit?.a_document ? <div className="text-xs text-slate-500 mb-1">Document existant conservé</div> : null}
              <input type="file" accept="image/*,application/pdf" onChange={uploadDoc} className="text-xs" />
            </div>
            </ZoneDepot>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" rows={2} placeholder="Couverture, franchise, courtier..." />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setCreerOuvert(false)} className="px-4 py-2 bg-slate-200 rounded text-sm">Annuler</button>
              <button onClick={sauver} disabled={verrou.occupe} className="px-4 py-2 bg-emerald-600 disabled:opacity-50 text-white rounded text-sm font-bold">{verrou.occupe ? "…" : "Sauver"}</button>
            </div>
          </div>
        </Modale>
      )}

      {/* Visualiseur document */}
      {docOuvert && (
        <Modale onClose={() => setDocOuvert(null)} titre="Document d'assurance" fermerAuClicFond={false} className="fixed inset-0 z-[80] bg-black/95 flex flex-col">
          <div className="flex items-center justify-between p-3 text-white safe-top">
            <button onClick={() => setDocOuvert(null)} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 font-semibold text-sm">← Retour</button>
            <span className="text-sm opacity-80">Document d'assurance</span>
            <a href={`/api/assurances/${docOuvert.id}/document`} target="_blank" rel="noreferrer" download className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">⬇</a>
          </div>
          <div className="flex-1 bg-white">
            {docOuvert.type?.startsWith("image/") ? (
              <div className="w-full h-full flex items-center justify-center bg-black" onClick={() => setDocOuvert(null)}>
                <img src={`/api/assurances/${docOuvert.id}/document`} alt="Document" onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <iframe src={`/api/assurances/${docOuvert.id}/document#view=FitH&toolbar=1`} title="Document" className="w-full h-full border-0" />
            )}
          </div>
        </Modale>
      )}
    </div>
  );
}

function I({ label, v, on, ph, type = "text", inputMode }: { label: string; v: string; on: (x: string) => void; ph?: string; type?: string; inputMode?: "decimal" | "numeric" | "text" }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} inputMode={inputMode} value={v} onChange={(e) => on(e.target.value)} placeholder={ph} className="w-full px-3 py-2 border rounded text-sm" />
    </div>
  );
}

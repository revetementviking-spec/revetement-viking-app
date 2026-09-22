"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import FAB from "@/components/FAB";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import ZoneDepot from "@/components/ZoneDepot";
import { aujourdhuiMontreal } from "@/lib/date";
import { ecrire, nombreSaisi, lireListe } from "@/lib/envoi";
import { fichierTropLourd } from "@/lib/limites-fichiers";
import { useVerrou } from "@/lib/verrou";
import ErreurChargement from "@/components/ErreurChargement";
import Modale from "@/components/Modale";

const POSTES = ["Installateur", "Apprenti", "Chef d'équipe", "Estimateur", "Administration", "Autre"];

export default function EmployesPage() {
  const [employes, setEmployes] = useState<any[]>([]);
  const [edit, setEdit] = useState<any>(null);
  const [creerOuvert, setCreerOuvert] = useState(false);
  const [filtreActif, setFiltreActif] = useState<"actifs" | "tous" | "inactifs">("actifs");
  const { toast } = useToast();

  const [erreur, setErreur] = useState<string | null>(null);
  const charger = async () => {
    // Lecture avec filet : un 500 faisait planter le rendu sur `.filter` d'un objet d'erreur.
    const r = await lireListe("/api/employes");
    if (!r.ok) { setErreur(r.erreur); return; }
    setErreur(null);
    setEmployes(r.data);
  };

  useEffect(() => { charger(); }, []);

  const reset = () => ({ nom: "", taux_horaire: "", das_pct: "0.15", recoit_talon: 1, poste: "Installateur", telephone: "", courriel: "", adresse: "", date_naissance: "", nas: "", date_embauche: aujourdhuiMontreal(), contact_urgence_nom: "", contact_urgence_lien: "", contact_urgence_tel: "", notes: "", specimen_cheque_data: "", specimen_cheque_type: "" });
  const [form, setForm] = useState<any>(reset());

  // Verrou par ref (lib/verrou.ts) : deux clics du même instant créaient deux employés.
  const verrou = useVerrou();
  const sauver = () => verrou.executer(async () => {
    if (!form.nom?.trim() || !form.taux_horaire) { toast("Nom et taux requis", "warning"); return; }
    // Virgule décimale : `+"30,50"` donnait NaN et le serveur le stockait tel quel.
    const taux = nombreSaisi(form.taux_horaire);
    if (!Number.isFinite(taux) || taux <= 0) { toast("Taux horaire invalide (ex. : 30,50)", "warning"); return; }
    const das = String(form.das_pct ?? "").trim() ? nombreSaisi(form.das_pct) : 0.15;
    if (!Number.isFinite(das) || das < 0 || das > 1) { toast("DAS invalide : une fraction entre 0 et 1 (ex. : 0,15)", "warning"); return; }
    const body = { ...form, taux_horaire: taux, das_pct: das, recoit_talon: form.recoit_talon ? 1 : 0 };
    if (edit) {
      if (!(await ecrire("/api/employes", "PATCH", { id: edit.id, ...body }, "Enregistrement"))) return;
      toast(`✓ ${form.nom} mis à jour`, "success");
    } else {
      if (!(await ecrire("/api/employes", "POST", body, "Enregistrement"))) return;
      toast(`✓ ${form.nom} ajouté`, "success");
    }
    setEdit(null);
    setCreerOuvert(false);
    setForm(reset());
    charger();
  });

  const ouvrirEdit = async (e: any) => {
    // La liste ne porte plus le NAS, la date de naissance ni le spécimen de chèque :
    // la fiche complète est demandée à l'unité, sinon l'enregistrement écraserait ces
    // champs avec du vide.
    let fiche = e;
    try {
      const r = await fetch(`/api/employes?id=${e.id}`, { cache: "no-store" });
      if (r.ok) fiche = { ...e, ...(await r.json()) };
    } catch {
      toast("Fiche complète indisponible (hors ligne ?) — réessaie avant de modifier", "warning");
      return;
    }
    setEdit(fiche);
    setForm({ ...reset(), ...fiche, taux_horaire: String(fiche.taux_horaire), das_pct: String(fiche.das_pct ?? 0.15), recoit_talon: fiche.recoit_talon ?? 1 });
    setCreerOuvert(true);
  };

  const desactiver = async (e: any) => {
    if (!confirm(`Désactiver ${e.nom} ? Il n'apparaîtra plus dans la saisie d'heures.`)) return;
    if (!(await ecrire(`/api/employes?id=${e.id}`, "DELETE", undefined, "Suppression"))) return;
    toast(`${e.nom} désactivé`, "info");
    charger();
  };

  const reactiver = async (e: any) => {
    if (!(await ecrire("/api/employes", "PATCH", { id: e.id, actif: 1 }, "Enregistrement"))) return;
    toast(`${e.nom} réactivé`, "success");
    charger();
  };

  const traiterSpecimen = (file?: File) => {
    if (!file) return;
    const tropLourd = fichierTropLourd(file);
    if (tropLourd) { toast(tropLourd, "warning"); return; }
    if (form.specimen_cheque_data && !confirm("Un spécimen est déjà joint. Le remplacer ?")) return;
    const reader = new FileReader();
    reader.onload = () => setForm({ ...form, specimen_cheque_data: reader.result, specimen_cheque_type: file.type });
    reader.readAsDataURL(file);
  };
  const uploadSpecimen = (e: React.ChangeEvent<HTMLInputElement>) => traiterSpecimen(e.target.files?.[0]);

  const affiches = employes.filter((e) => {
    if (filtreActif === "actifs") return e.actif;
    if (filtreActif === "inactifs") return !e.actif;
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation
        titre="👷 Employés"
        soustitre={`${affiches.length} ${filtreActif}`}
        actions={
          <button onClick={() => { setEdit(null); setForm(reset()); setCreerOuvert(true); }} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold text-left">
            ➕ Nouvel employé
          </button>
        }
      />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        {/* Filtre statut */}
        <div className="flex gap-2">
          {[
            { v: "actifs", l: "Actifs" },
            { v: "inactifs", l: "Inactifs" },
            { v: "tous", l: "Tous" },
          ].map((f: any) => (
            <button key={f.v} onClick={() => setFiltreActif(f.v)} className={`px-3 py-1 rounded text-sm ${filtreActif === f.v ? "bg-slate-900 text-white" : "bg-white border"}`}>{f.l}</button>
          ))}
        </div>

        {erreur ? (
          <ErreurChargement erreur={erreur} onReessayer={charger} />
        ) : affiches.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">👷</div>
            <h3 className="text-lg font-bold text-slate-700 mb-2">Aucun employé</h3>
            <button onClick={() => { setEdit(null); setForm(reset()); setCreerOuvert(true); }} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">➕ Premier employé</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {affiches.map((e) => (
              <div key={e.id} className={`bg-white rounded-lg shadow p-4 space-y-2 ${!e.actif ? "opacity-60" : ""}`}>
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 text-lg truncate">{e.nom}</div>
                    {e.poste && <div className="text-xs text-slate-500">{e.poste}</div>}
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-emerald-700">{formatCAD(e.taux_horaire || 0)}/h</div>
                    {!e.actif && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded">Inactif</span>}
                  </div>
                </div>
                <div className="text-xs space-y-0.5">
                  {e.telephone && <div>📞 <a href={`tel:${e.telephone}`} className="text-blue-600">{e.telephone}</a></div>}
                  {e.courriel && <div>✉️ <a href={`mailto:${e.courriel}`} className="text-blue-600 truncate">{e.courriel}</a></div>}
                  {e.adresse && <div className="text-slate-600 truncate">📍 {e.adresse}</div>}
                  {e.date_embauche && <div className="text-slate-500">📅 Embauché : {e.date_embauche}</div>}
                  {e.contact_urgence_nom && <div className="text-amber-700">🚨 {e.contact_urgence_nom}{e.contact_urgence_tel ? ` · ${e.contact_urgence_tel}` : ""}</div>}
                  {(e.a_specimen || e.specimen_cheque_data) && <div className="text-emerald-700">📎 Spécimen chèque archivé</div>}
                </div>
                <div className="flex gap-1 pt-2 border-t">
                  <button onClick={() => ouvrirEdit(e)} className="flex-1 px-2 py-1.5 bg-slate-100 hover:bg-slate-200 rounded text-xs font-semibold">✏️ Modifier</button>
                  {e.actif ? (
                    <button onClick={() => desactiver(e)} className="px-2 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs">Désactiver</button>
                  ) : (
                    <button onClick={() => reactiver(e)} className="px-2 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded text-xs">Réactiver</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {creerOuvert && (
        <Modale onClose={() => { setCreerOuvert(false); setEdit(null); }} titre={edit ? `Modifier ${edit.nom}` : "Nouvel employé"} className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-2xl w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="text-lg font-bold">{edit ? `Modifier ${edit.nom}` : "Nouvel employé"}</h3>

            {/* Identité */}
            <fieldset className="border rounded p-3">
              <legend className="text-xs font-bold text-slate-600 px-1">Identité</legend>
              <div className="space-y-2">
                <In label="Nom complet *" v={form.nom} o={(v) => setForm({ ...form, nom: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <In label="Date de naissance" v={form.date_naissance} o={(v) => setForm({ ...form, date_naissance: v })} type="date" />
                  <In label="NAS" v={form.nas} o={(v) => setForm({ ...form, nas: v })} placeholder="XXX-XXX-XXX" />
                </div>
                <In label="Adresse" v={form.adresse} o={(v) => setForm({ ...form, adresse: v })} />
                <div className="grid grid-cols-2 gap-2">
                  <In label="Téléphone" v={form.telephone} o={(v) => setForm({ ...form, telephone: v })} type="tel" />
                  <In label="Courriel" v={form.courriel} o={(v) => setForm({ ...form, courriel: v })} type="email" />
                </div>
              </div>
            </fieldset>

            {/* Emploi */}
            <fieldset className="border rounded p-3">
              <legend className="text-xs font-bold text-slate-600 px-1">Emploi</legend>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Poste</label>
                    <select value={form.poste} onChange={(ev) => setForm({ ...form, poste: ev.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                      {POSTES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <In label="Date embauche" v={form.date_embauche} o={(v) => setForm({ ...form, date_embauche: v })} type="date" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {/* type="text" + inputMode : un champ number refuse « 30,50 » (virgule du clavier québécois). */}
                  <In label="Taux horaire $/h *" v={form.taux_horaire} o={(v) => setForm({ ...form, taux_horaire: v })} inputMode="decimal" placeholder="Ex. : 30,50" />
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">DAS (fraction, ex. : 0,15)</label>
                    <input type="text" inputMode="decimal" value={form.das_pct} onChange={(ev) => setForm({ ...form, das_pct: ev.target.value })} placeholder="0,15" className="w-full px-3 py-2 border rounded text-sm text-right" />
                  </div>
                </div>
                <label className="flex items-start gap-2 cursor-pointer bg-slate-50 border rounded p-2 mt-1">
                  <input type="checkbox" checked={!!form.recoit_talon} onChange={(ev) => setForm({ ...form, recoit_talon: ev.target.checked ? 1 : 0 })} className="w-4 h-4 mt-0.5" />
                  <span className="text-xs text-slate-700">
                    <strong>Reçoit un talon de paie</strong>
                    <span className="block text-[11px] text-slate-500">Décoche pour les propriétaires : leurs heures et leur coût de chantier restent calculés, mais aucun talon n'est produit pour eux.</span>
                  </span>
                </label>
              </div>
            </fieldset>

            {/* Contact d'urgence */}
            <fieldset className="border rounded p-3">
              <legend className="text-xs font-bold text-slate-600 px-1">🚨 Contact d'urgence</legend>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <In label="Nom" v={form.contact_urgence_nom} o={(v) => setForm({ ...form, contact_urgence_nom: v })} />
                  <In label="Lien" v={form.contact_urgence_lien} o={(v) => setForm({ ...form, contact_urgence_lien: v })} placeholder="Conjoint, parent..." />
                </div>
                <In label="Téléphone" v={form.contact_urgence_tel} o={(v) => setForm({ ...form, contact_urgence_tel: v })} type="tel" />
              </div>
            </fieldset>

            {/* Spécimen chèque */}
            <fieldset className="border rounded p-3">
              <legend className="text-xs font-bold text-slate-600 px-1">📎 Spécimen de chèque — glisse-dépose accepté</legend>
              <ZoneDepot onFichiers={(files) => traiterSpecimen(files[0])} accept="image/*,application/pdf" multiple={false} messageSurvol="📎 Dépose le spécimen">
              {form.specimen_cheque_data ? (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded p-2">
                  {form.specimen_cheque_type?.startsWith("image/") ? (
                    <img src={form.specimen_cheque_data} alt="Spécimen" className="w-16 h-16 object-cover rounded" />
                  ) : (
                    <div className="w-16 h-16 bg-slate-200 rounded flex items-center justify-center text-2xl">📄</div>
                  )}
                  <div className="flex-1 text-xs">Spécimen archivé</div>
                  <button type="button" onClick={() => {
                    const w = window.open();
                    if (w) {
                      if (form.specimen_cheque_type?.startsWith("image/")) w.document.write(`<img src="${form.specimen_cheque_data}" style="max-width:100%" />`);
                      else w.location.href = form.specimen_cheque_data;
                    }
                  }} className="text-xs text-blue-600 hover:underline">Voir</button>
                  <button type="button" onClick={() => setForm({ ...form, specimen_cheque_data: "", specimen_cheque_type: "" })} className="text-red-600 hover:bg-red-100 px-2 py-1 rounded text-xs">✕</button>
                </div>
              ) : (
                <label className="cursor-pointer bg-white border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 rounded p-3 text-center transition flex items-center justify-center gap-2 text-sm font-semibold text-slate-700">
                  📎 Joindre PDF ou photo
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={uploadSpecimen} />
                </label>
              )}
              </ZoneDepot>
            </fieldset>

            {/* Notes */}
            <fieldset className="border rounded p-3">
              <legend className="text-xs font-bold text-slate-600 px-1">Notes</legend>
              <textarea value={form.notes} onChange={(ev) => setForm({ ...form, notes: ev.target.value })} rows={2} placeholder="Allergies, conditions médicales, certifications..." className="w-full px-3 py-2 border rounded text-sm" />
            </fieldset>

            <div className="flex gap-2 justify-end pt-2 sticky bottom-0 bg-white">
              <button onClick={() => { setCreerOuvert(false); setEdit(null); }} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={sauver} disabled={verrou.occupe} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-sm font-bold">{verrou.occupe ? "…" : edit ? "Mettre à jour" : "Créer"}</button>
            </div>
          </div>
        </Modale>
      )}

      <FAB onSuccess={charger} />
    </div>
  );
}

function In({ label, v, o, type = "text", placeholder, inputMode }: { label: string; v: string; o: (v: string) => void; type?: string; placeholder?: string; inputMode?: "decimal" | "numeric" | "text" }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type={type} inputMode={inputMode} value={v || ""} onChange={(e) => o(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 border rounded text-sm" />
    </div>
  );
}

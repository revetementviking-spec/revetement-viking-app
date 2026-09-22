"use client";

import { useEffect, useRef, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import ZoneDepot from "@/components/ZoneDepot";
import { compresserImage } from "@/lib/img";
import { ecrire, envoyer, lireListe, nombreSaisi } from "@/lib/envoi";
import { useVerrou } from "@/lib/verrou";
import ErreurChargement from "@/components/ErreurChargement";
import Modale from "@/components/Modale";

export default function Bibliotheque() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    adresse: "",
    type_materiau: "vinyle",
    parement_pi2: "",
    fascia_pi_lin: "",
    soffite_pi2: "",
    nb_etages: "1",
    total_soumission: "",
    heures_reelles: "",
    complexite: "moyenne",
    notes_chantier: "",
    hover_data_json: "",
    soumission_data_json: "",
  });
  const [photos, setPhotos] = useState<File[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const photosRef = useRef<HTMLInputElement>(null);
  // Verrou par ref (lib/verrou.ts) : `disabled={uploading}` sur un état laissait passer
  // deux clics du même instant — deux chantiers de référence identiques.
  const verrou = useVerrou();
  const uploading = verrou.occupe;

  const charger = async () => {
    setLoading(true);
    try {
      // Lecture avec filet : un 500 faisait planter le rendu sur `.map` d'un objet d'erreur.
      const r = await lireListe("/api/bibliotheque");
      if (!r.ok) { setErreur(r.erreur); return; }
      setErreur(null);
      setJobs(r.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { charger(); }, []);

  const ajouter = () => verrou.executer(async () => {
    if (!form.parement_pi2 || !form.total_soumission) {
      alert("Au minimum : surface parement + total soumission.");
      return;
    }
    // Les nombres saisis (« 1 250,5 ») sont lus avec nombreSaisi ; un NaN est refusé ici.
    const champsNum: Array<[keyof typeof form, string]> = [["parement_pi2", "Parement pi²"], ["fascia_pi_lin", "Fascia pi-lin"], ["soffite_pi2", "Soffite pi²"], ["total_soumission", "Total soumission"], ["heures_reelles", "Heures réelles"]];
    const nombres: Record<string, number | null> = {};
    for (const [cle, nom] of champsNum) {
      const v = String(form[cle] || "").trim();
      if (!v) { nombres[cle] = null; continue; }
      const n = nombreSaisi(v);
      if (!Number.isFinite(n)) { alert(`${nom} illisible (ex. : 1 250,5).`); return; }
      nombres[cle] = n;
    }
    try {
      // Compression côté navigateur avant l'envoi (même chemin que les autres photos de
      // l'app) : l'upload part en JSON et les images sont stockées en base, pas sur disque.
      const images: string[] = [];
      for (const f of photos.slice(0, 10)) {
        try { images.push(await compresserImage(f)); } catch { /* photo illisible : ignorée */ }
      }
      const res = await envoyer<any>("/api/bibliotheque", { corps: { ...form, ...nombres, photos: images } });
      const d = res.ok ? res.data || {} : { error: res.erreur };
      if (res.ok) {
        alert(`Chantier ajouté à la bibliothèque (#${d.id})${d.photos ? ` — ${d.photos} photo(s)` : ""}${d.photos_ignorees ? ` · ${d.photos_ignorees} ignorée(s) (trop lourde)` : ""}`);
        setForm({ adresse: "", type_materiau: "vinyle", parement_pi2: "", fascia_pi_lin: "", soffite_pi2: "", nb_etages: "1", total_soumission: "", heures_reelles: "", complexite: "moyenne", notes_chantier: "", hover_data_json: "", soumission_data_json: "" });
        setPhotos([]);
        if (photosRef.current) photosRef.current.value = "";
        charger();
      } else { alert("Erreur : " + d.error); }
    } catch (e: any) {
      alert("Erreur : " + (e?.message || "photo illisible"));
    }
  });

  const supprimer = async (id: number) => {
    if (!confirm("Supprimer ce chantier de référence ?")) return;
    if (!(await ecrire(`/api/bibliotheque?id=${id}`, "DELETE", undefined, "Suppression"))) return;
    charger();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📚 Bibliothèque" soustitre="Plus tu en mets, plus l'IA estime juste" />

      <main className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Formulaire d'ajout */}
        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="text-lg font-bold mb-3">➕ Ajouter un chantier de référence</h2>
          <p className="text-sm text-slate-600 mb-4">
            Remplis avec un vrai chantier déjà complété (Hover + soumission finale + heures réelles + photos). L'auto-estimateur les utilisera pour mieux estimer les futurs projets similaires.
          </p>
          <div className="space-y-3">
            <Input label="Adresse" v={form.adresse} on={(v) => setForm({ ...form, adresse: v })} />
            <div className="grid grid-cols-2 gap-2">
              <Select label="Type matériau" v={form.type_materiau} on={(v) => setForm({ ...form, type_materiau: v })} opts={["vinyle", "maibec-canexel", "maibec-bois", "mac-acier", "mac-harrywood", "aluminium", "mixte"]} />
              <Select label="Nb étages" v={form.nb_etages} on={(v) => setForm({ ...form, nb_etages: v })} opts={["1", "2", "3"]} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Num label="Parement pi² ⭐" v={form.parement_pi2} on={(v) => setForm({ ...form, parement_pi2: v })} />
              <Num label="Fascia pi-lin" v={form.fascia_pi_lin} on={(v) => setForm({ ...form, fascia_pi_lin: v })} />
              <Num label="Soffite pi²" v={form.soffite_pi2} on={(v) => setForm({ ...form, soffite_pi2: v })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Num label="Total soumission $ ⭐" v={form.total_soumission} on={(v) => setForm({ ...form, total_soumission: v })} />
              <Num label="Heures réelles travaillées" v={form.heures_reelles} on={(v) => setForm({ ...form, heures_reelles: v })} />
            </div>
            <Select label="Complexité" v={form.complexite} on={(v) => setForm({ ...form, complexite: v })} opts={["faible", "moyenne", "élevée"]} />
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes chantier (particularités, obstacles, leçons)</label>
              <textarea value={form.notes_chantier} onChange={(e) => setForm({ ...form, notes_chantier: e.target.value })} rows={3} className="w-full px-3 py-2 border rounded text-sm" placeholder="Ex: Fronton triangulaire avant, échafaudage déplacé 4 fois, accès difficile par l'arrière..." />
            </div>
            <ZoneDepot onFichiers={(f) => setPhotos((prev) => [...prev, ...f].slice(0, 10))} accept="image/*" messageSurvol="📷 Dépose les photos">
              <div className="border border-dashed border-slate-300 rounded p-2">
                <label className="block text-xs font-medium text-slate-600 mb-1">📷 Photos chantier/maison (optionnel) — glisse-dépose accepté</label>
                <input ref={photosRef} type="file" accept="image/*" multiple onChange={(e) => setPhotos(Array.from(e.target.files || []).slice(0, 10))} className="text-sm" />
                {photos.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs text-slate-500 mb-1">{photos.length} photo(s) · max 10</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {photos.map((p, i) => (
                        <div key={i} className="relative">
                          <img src={URL.createObjectURL(p)} alt="" className="w-14 h-14 object-cover rounded border" />
                          <button type="button" onClick={() => setPhotos((prev) => prev.filter((_, k) => k !== i))} aria-label={`Retirer la photo ${i + 1}`} className="absolute -top-3 -right-3 min-w-11 min-h-11 flex items-center justify-center"><span className="bg-red-500 text-white rounded-full w-4 h-4 text-[9px] leading-none flex items-center justify-center">✕</span></button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </ZoneDepot>
            <details>
              <summary className="cursor-pointer text-xs text-slate-600">📄 Données Hover (avancé - optionnel)</summary>
              <textarea value={form.hover_data_json} onChange={(e) => setForm({ ...form, hover_data_json: e.target.value })} rows={3} placeholder='Colle le JSON Hover ou laisse vide' className="w-full mt-2 px-3 py-2 border rounded text-xs font-mono" />
            </details>
            <button onClick={ajouter} disabled={uploading} className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold disabled:opacity-50">
              {uploading ? "⏳ Envoi en cours..." : "💾 Ajouter à la bibliothèque"}
            </button>
          </div>
        </section>

        {/* Liste des chantiers de référence */}
        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="text-lg font-bold mb-3">Chantiers de référence ({jobs.length})</h2>
          {erreur ? (
            <ErreurChargement erreur={erreur} onReessayer={charger} />
          ) : loading ? (
            <p className="text-slate-500">Chargement...</p>
          ) : jobs.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-5xl mb-3">📚</div>
              <h3 className="font-bold text-slate-700 mb-1">Bibliothèque vide</h3>
              <p className="text-sm text-slate-500">Plus tu en mets, plus l'IA estime juste.<br/>Idéal : 5-10 chantiers représentatifs de ton entreprise.</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[700px] overflow-y-auto">
              {jobs.map((j) => {
                // Ids des photos en base. L'ancien `photos_json` ne contenait que des noms
                // de fichiers écrits sur un disque éphémère : ces images n'existent plus.
                const photoIds: string[] = String(j.photo_ids || "").split(",").filter(Boolean);
                return (
                  <div key={j.id} className="border rounded p-3 bg-slate-50 text-sm">
                    <div className="flex justify-between mb-1">
                      <strong>{j.adresse || "Sans adresse"}</strong>
                      <button onClick={() => supprimer(j.id)} aria-label={`Supprimer le chantier ${j.adresse || "#" + j.id}`} className="min-w-11 min-h-11 flex items-center justify-center text-red-600 hover:bg-red-50 rounded text-xs">✕</button>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                      <span className="bg-blue-100 text-blue-900 px-2 py-0.5 rounded">{j.type_materiau}</span>
                      <span className="bg-slate-200 px-2 py-0.5 rounded">{j.nb_etages} étage(s)</span>
                      <span className={`px-2 py-0.5 rounded ${j.complexite === "élevée" ? "bg-red-100 text-red-900" : j.complexite === "faible" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>{j.complexite}</span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div><span className="text-slate-500">Parement:</span> <strong>{j.parement_pi2} pi²</strong></div>
                      <div><span className="text-slate-500">Fascia:</span> <strong>{j.fascia_pi_lin} pl</strong></div>
                      <div><span className="text-slate-500">Soffite:</span> <strong>{j.soffite_pi2} pi²</strong></div>
                      <div><span className="text-slate-500">Total:</span> <strong className="text-emerald-700">{formatCAD(j.total_soumission)}</strong></div>
                      <div><span className="text-slate-500">H. réelles:</span> <strong>{j.heures_reelles || "—"} h</strong></div>
                      <div><span className="text-slate-500">$/pi²:</span> <strong>{(j.total_soumission / j.parement_pi2).toFixed(2)}$</strong></div>
                    </div>
                    {j.notes_chantier && <div className="mt-2 text-xs italic text-slate-700">"{j.notes_chantier}"</div>}
                    {/* La route /api/bibliotheque/photo/[id] ne sert pas de vignette (?thumb=1) :
                        demande faite à l'agent serveur. En attendant, plein format en lazy. */}
                    {photoIds.length > 0 && (
                      <div className="mt-2 flex gap-1.5 flex-wrap">
                        {photoIds.map((pid) => (
                          <button key={pid} type="button" onClick={() => setZoom(`/api/bibliotheque/photo/${pid}`)} title="Agrandir" aria-label="Agrandir la photo">
                            <img src={`/api/bibliotheque/photo/${pid}`} alt="Photo du chantier" loading="lazy" decoding="async" className="w-16 h-16 object-cover rounded border hover:ring-2 hover:ring-emerald-500 transition" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Visualiseur plein écran (le composant Lightbox est câblé sur /api/photos, pas réutilisable ici) */}
      {zoom && (
        <Modale onClose={() => setZoom(null)} titre="Photo du chantier" className="fixed inset-0 z-[90] bg-black/95 flex flex-col">
          <div className="flex items-center justify-between p-3 text-white">
            <button onClick={() => setZoom(null)} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 font-semibold text-sm">← Retour</button>
            <a href={zoom} target="_blank" rel="noreferrer" download onClick={(e) => e.stopPropagation()} aria-label="Télécharger la photo" className="px-3 py-2 min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-sm">⬇</a>
          </div>
          <div className="flex-1 flex items-center justify-center p-3">
            <img src={zoom} alt="Photo du chantier" onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full object-contain" />
          </div>
        </Modale>
      )}
    </div>
  );
}

function Input({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="text" value={v} onChange={(e) => on(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}
// type="text" + inputMode="decimal" : un champ number refuse « 1 250,5 » (virgule du
// clavier québécois). La lecture passe par nombreSaisi() à la soumission.
function Num({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="text" inputMode="decimal" value={v} onChange={(e) => on(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}
function Select({ label, v, on, opts }: { label: string; v: string; on: (v: string) => void; opts: string[] }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><select value={v} onChange={(e) => on(e.target.value)} className="w-full px-3 py-2 border rounded text-sm">{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select></div>;
}

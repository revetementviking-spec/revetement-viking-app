"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toasts";
import { compresserImage } from "@/lib/img";
import { PIPELINE_STAGES } from "@/components/PipelineCRM";

interface Props {
  client: any;
  projets: any[];
  onClose: () => void;
  onUpdate: () => void;
}

const UTILISATEURS = ["Gabriel", "Francis"];

export default function PipelineDrawer({ client, projets, onClose, onUpdate }: Props) {
  const [form, setForm] = useState({
    nom: client.nom || "",
    adresse: client.adresse || "",
    telephone: client.telephone || "",
    courriel: client.courriel || "",
    pipeline_stage: client.pipeline_stage || "",
    assignee: client.assignee || "",
    date_relance: client.date_relance || "",
    projet_lien_id: client.projet_lien_id || 0,
    tags: client.tags || "",
    notes: client.notes || "",
  });
  const [fichiers, setFichiers] = useState<any[]>([]);
  const [taches, setTaches] = useState<any[]>([]);
  const [commentaires, setCommentaires] = useState<any[]>([]);
  const [nouvelleTache, setNouvelleTache] = useState("");
  const [nouveauComm, setNouveauComm] = useState("");
  const [uploadEnCours, setUploadEnCours] = useState(false);
  const [busy, setBusy] = useState(false);
  const [moiUtilisateur, setMoiUtilisateur] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();

  const rechargerTaches = () => fetch(`/api/client-taches?client_id=${client.id}`).then((r) => r.json()).then((t) => Array.isArray(t) && setTaches(t)).catch(() => {});
  const rechargerComm = () => fetch(`/api/client-commentaires?client_id=${client.id}`).then((r) => r.json()).then((c) => Array.isArray(c) && setCommentaires(c)).catch(() => {});

  useEffect(() => {
    fetch(`/api/client-fichiers?client_id=${client.id}`).then((r) => r.json()).then((f) => Array.isArray(f) && setFichiers(f)).catch(() => {});
    rechargerTaches();
    rechargerComm();
    fetch("/api/auth/me").then((r) => r.json()).then((d) => setMoiUtilisateur(d.user)).catch(() => {});
  }, [client.id]);

  const ajouterTache = async () => {
    const titre = nouvelleTache.trim();
    if (!titre) return;
    await fetch("/api/client-taches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: client.id, titre }) });
    setNouvelleTache("");
    rechargerTaches();
  };
  const cocherTache = async (t: any) => {
    await fetch("/api/client-taches", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: t.id, complete: !t.complete }) });
    rechargerTaches();
  };
  const supprimerTache = async (id: number) => {
    await fetch(`/api/client-taches?id=${id}`, { method: "DELETE" });
    rechargerTaches();
  };

  const posterComm = async () => {
    const texte = nouveauComm.trim();
    if (!texte) return;
    const r = await fetch("/api/client-commentaires", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: client.id, texte }) });
    const d = await r.json();
    setNouveauComm("");
    rechargerComm();
    if (d.mentions && d.mentions.length) toast(`📧 Courriel envoyé à @${d.mentions.join(", @")}`, "success");
  };
  const supprimerComm = async (id: number) => {
    if (!confirm("Supprimer ce commentaire ?")) return;
    await fetch(`/api/client-commentaires?id=${id}`, { method: "DELETE" });
    rechargerComm();
  };

  const sauver = async () => {
    setBusy(true);
    try {
      await fetch("/api/clients", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: client.id, ...form,
          projet_lien_id: form.projet_lien_id ? +form.projet_lien_id : null,
          date_relance: form.date_relance || null,
          assignee: form.assignee || null,
          pipeline_stage: form.pipeline_stage || null,
        }),
      });
      toast("✓ Modifications enregistrées", "success");
      onUpdate();
    } finally { setBusy(false); }
  };

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadEnCours(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f.size > 15 * 1024 * 1024) { toast(`${f.name} > 15 MB, ignoré`, "warning"); continue; }
        let data: string;
        let type = f.type || "application/octet-stream";
        if (type.startsWith("image/")) {
          data = await compresserImage(f);
          type = "image/jpeg";
        } else {
          data = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result as string);
            r.onerror = rej;
            r.readAsDataURL(f);
          });
        }
        await fetch("/api/client-fichiers", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: client.id, nom: f.name, type, data, taille: f.size }),
        });
      }
      const next = await fetch(`/api/client-fichiers?client_id=${client.id}`).then((r) => r.json());
      setFichiers(Array.isArray(next) ? next : []);
      toast(`${files.length} fichier(s) ajouté(s)`, "success");
    } catch (e: any) {
      toast("Erreur upload : " + (e?.message || ""), "error");
    } finally { setUploadEnCours(false); }
  };

  const supprimerFichier = async (id: number) => {
    if (!confirm("Supprimer ce fichier ?")) return;
    await fetch(`/api/client-fichiers?id=${id}`, { method: "DELETE" });
    setFichiers((arr) => arr.filter((f) => f.id !== id));
    toast("Fichier supprimé", "info");
  };

  // Drop zone : empêche le drag par défaut, gère le drop
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); dropRef.current?.classList.add("ring-4", "ring-emerald-400"); };
  const onDragLeave = () => { dropRef.current?.classList.remove("ring-4", "ring-emerald-400"); };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dropRef.current?.classList.remove("ring-4", "ring-emerald-400");
    upload(e.dataTransfer.files);
  };

  const dateRetard = form.date_relance && form.date_relance < new Date().toISOString().slice(0, 10);
  const tagsList = form.tags ? form.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl md:rounded-lg max-w-3xl w-full max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 z-10 bg-gradient-to-r from-emerald-700 to-teal-700 text-white p-4 flex justify-between items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-lg truncate">👤 {form.nom}</h2>
            <div className="text-xs opacity-90 truncate">{form.adresse || "Sans adresse"}</div>
            {moiUtilisateur && <div className="text-[10px] opacity-75 mt-0.5">Connecté en tant que <strong>{moiUtilisateur}</strong></div>}
          </div>
          <Link href={`/clients/${client.id}`} className="text-xs bg-white/15 hover:bg-white/25 px-2 py-1 rounded">Fiche complète →</Link>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-xl leading-none">✕</button>
        </header>

        <div className="p-4 space-y-4">
          {/* Coordonnées */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Nom" value={form.nom} onChange={(v) => setForm({ ...form, nom: v })} />
            <Field label="Adresse" value={form.adresse} onChange={(v) => setForm({ ...form, adresse: v })} />
            <Field label="Téléphone" value={form.telephone} onChange={(v) => setForm({ ...form, telephone: v })} />
            <Field label="Courriel" value={form.courriel} onChange={(v) => setForm({ ...form, courriel: v })} />
          </section>

          {/* Pipeline / assignee / relance / projet */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">📊 Étape du pipeline</label>
              <select value={form.pipeline_stage} onChange={(e) => setForm({ ...form, pipeline_stage: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                <option value="">— Aucune —</option>
                {PIPELINE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.emoji} {s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">👤 Assigné à</label>
              <div className="flex gap-1">
                {UTILISATEURS.map((u) => (
                  <button key={u} type="button" onClick={() => setForm({ ...form, assignee: form.assignee === u ? "" : u })} className={`flex-1 px-3 py-2 rounded text-sm font-semibold border-2 ${form.assignee === u ? "bg-emerald-600 text-white border-emerald-700" : "bg-white text-slate-700 border-slate-200"}`}>
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">⏰ Date de relance / rappel</label>
              <input type="date" value={form.date_relance || ""} onChange={(e) => setForm({ ...form, date_relance: e.target.value })} className={`w-full px-3 py-2 border rounded text-sm ${dateRetard ? "bg-red-50 border-red-400 text-red-900" : ""}`} />
              {dateRetard && <p className="text-[10px] text-red-700 mt-1">⚠️ En retard</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">🏗️ Projet lié</label>
              <select value={form.projet_lien_id} onChange={(e) => setForm({ ...form, projet_lien_id: +e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                <option value={0}>— Aucun —</option>
                {projets.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
            </div>
          </section>

          {/* Tags */}
          <section>
            <label className="block text-xs font-medium text-slate-600 mb-1">🏷️ Tags (séparés par des virgules)</label>
            <input type="text" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Ex: priorité haute, fascia, soffite" className="w-full px-3 py-2 border rounded text-sm" />
            {tagsList.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {tagsList.map((t: string) => <span key={t} className="text-[10px] bg-indigo-100 text-indigo-900 px-2 py-0.5 rounded-full font-semibold">#{t}</span>)}
              </div>
            )}
          </section>

          {/* Notes */}
          <section>
            <label className="block text-xs font-medium text-slate-600 mb-1">📝 Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Détails internes du dossier…" className="w-full px-3 py-2 border rounded text-sm" />
          </section>

          {/* SOUS-TÂCHES (checklist) */}
          <section>
            <label className="block text-xs font-medium text-slate-600 mb-1">✅ Sous-tâches ({taches.filter((t) => t.complete).length}/{taches.length})</label>
            <div className="flex gap-2 mb-2">
              <input type="text" value={nouvelleTache} onChange={(e) => setNouvelleTache(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ajouterTache()} placeholder="Nouvelle sous-tâche…" className="flex-1 px-3 py-2 border rounded text-sm" />
              <button onClick={ajouterTache} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">＋</button>
            </div>
            {taches.length > 0 && (
              <ul className="space-y-1">
                {taches.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 bg-slate-50 rounded p-2">
                    <input type="checkbox" checked={!!t.complete} onChange={() => cocherTache(t)} className="w-4 h-4" />
                    <span className={`flex-1 text-sm ${t.complete ? "line-through text-slate-400" : "text-slate-800"}`}>{t.titre}</span>
                    <button onClick={() => supprimerTache(t.id)} className="text-xs text-red-600 hover:underline">🗑</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* COMMENTAIRES (fil) */}
          <section>
            <label className="block text-xs font-medium text-slate-600 mb-1">💬 Fil de discussion ({commentaires.length})</label>
            <div className="space-y-2 mb-2 max-h-64 overflow-y-auto">
              {commentaires.map((c) => {
                const aMention = c.mentions ? String(c.mentions).split(",") : [];
                return (
                  <div key={c.id} className="bg-slate-50 border-l-4 border-emerald-400 rounded p-2 text-sm">
                    <div className="flex justify-between items-start gap-2">
                      <strong className="text-emerald-800">👤 {c.auteur || "—"}</strong>
                      <span className="text-[10px] text-slate-500">{new Date(c.date_creation).toLocaleString("fr-CA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="text-slate-800 whitespace-pre-wrap mt-0.5">
                      {String(c.texte).split(/(@Gabriel|@Francis)/gi).map((part, i) =>
                        /^@(Gabriel|Francis)$/i.test(part)
                          ? <span key={i} className="bg-yellow-100 text-yellow-900 font-bold px-1 rounded">{part}</span>
                          : <span key={i}>{part}</span>
                      )}
                    </div>
                    {aMention.length > 0 && <div className="text-[10px] text-emerald-700 mt-1">📧 Envoyé à @{aMention.join(", @")}</div>}
                    <button onClick={() => supprimerComm(c.id)} className="text-[10px] text-red-600 hover:underline mt-1">Supprimer</button>
                  </div>
                );
              })}
              {commentaires.length === 0 && <p className="text-xs text-slate-400 italic">Aucun commentaire. Lance la discussion ↓</p>}
            </div>
            <div className="flex gap-2">
              <textarea value={nouveauComm} onChange={(e) => setNouveauComm(e.target.value)} rows={2} placeholder="Ajouter un commentaire… @Gabriel ou @Francis pour notifier par courriel" className="flex-1 px-3 py-2 border rounded text-sm" />
              <button onClick={posterComm} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold self-stretch">Poster</button>
            </div>
          </section>

          {/* Fichiers — zone de drop */}
          <section>
            <label className="block text-xs font-medium text-slate-600 mb-1">📎 Fichiers (plans, photos, contrats)</label>
            <div
              ref={dropRef}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center bg-slate-50 transition"
            >
              <div className="text-2xl mb-1">📥</div>
              <p className="text-sm font-semibold text-slate-700">Glisse-dépose des fichiers ici</p>
              <p className="text-xs text-slate-500 mb-2">ou</p>
              <label className="cursor-pointer inline-block bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-xs font-bold">
                📁 Choisir des fichiers
                <input type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} disabled={uploadEnCours} />
              </label>
              {uploadEnCours && <p className="text-xs text-slate-500 mt-2">⏳ Upload en cours…</p>}
            </div>
            {fichiers.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {fichiers.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 bg-white border border-slate-200 rounded p-2 text-xs">
                    <span className="text-lg">{(f.type || "").startsWith("image/") ? "🖼️" : (f.type || "").includes("pdf") ? "📄" : "📎"}</span>
                    <a href={`/api/client-fichiers/${f.id}`} target="_blank" rel="noreferrer" className="flex-1 truncate font-semibold text-emerald-700 hover:underline">{f.nom}</a>
                    <span className="text-[10px] text-slate-500">{f.taille ? `${Math.round(f.taille / 1024)} ko` : ""} · {f.ajoute_par || "—"}</span>
                    <button onClick={() => supprimerFichier(f.id)} className="text-xs text-red-600 hover:bg-red-100 px-2 py-1 rounded">🗑</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="sticky bottom-0 bg-white border-t p-3 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Fermer</button>
          <button onClick={sauver} disabled={busy} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-sm font-bold">
            {busy ? "⏳…" : "💾 Enregistrer"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";
import BottomSheet from "@/components/BottomSheet";
import { compresserImage } from "@/lib/img";

interface Props { ouvert: boolean; onClose: () => void; onSuccess?: () => void; projetIdInitial?: number; }

export default function ModalPhotos({ ouvert, onClose, onSuccess, projetIdInitial }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [projets, setProjets] = useState<any[]>([]);
  const [projet_id, setProjetId] = useState<number>(0);
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ total: 0, done: 0 });
  const { toast } = useToast();

  useEffect(() => {
    if (!ouvert) return;
    fetch("/api/projets").then((r) => r.json()).then((tous: any[]) => {
      const dispo = (Array.isArray(tous) ? tous : [])
        .filter((p) => p.statut !== "complete" && p.statut !== "annule")
        .sort((a, b) => (a.statut === "actif" ? -1 : 1) - (b.statut === "actif" ? -1 : 1));
      setProjets(dispo);
      if (!projet_id && dispo.length > 0) setProjetId(projetIdInitial || dispo[0].id);
    });
  }, [ouvert]);

  const ajouterFichiers = (fl: FileList | null) => {
    if (!fl) return;
    const max = 20 * 1024 * 1024;
    const ok = Array.from(fl).filter((f) => {
      if (f.size > max) { toast(`${f.name} > 20 MB ignoré`, "warning"); return false; }
      return true;
    });
    setFiles((prev) => [...prev, ...ok]);
  };
  const retirer = (i: number) => setFiles(files.filter((_, idx) => idx !== i));

  const envoyer = async () => {
    if (!projet_id) { toast("Choisis un projet", "warning"); return; }
    if (files.length === 0) { toast("Aucun fichier", "warning"); return; }
    setBusy(true);
    setProgress({ total: files.length, done: 0 });
    try {
      // Upload séquentiel rapide (compression parallélisable mais on garde simple)
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        let data: string;
        let type: string;
        if (f.type.startsWith("video/")) {
          // Vidéo : upload direct en base64 (pas de compression)
          data = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result as string);
            r.onerror = rej;
            r.readAsDataURL(f);
          });
          type = f.type;
        } else {
          data = await compresserImage(f);
          type = "image/jpeg";
        }
        await fetch("/api/photos", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projet_id, date, description: description || f.name,
            photo_data: data, photo_type: type, employes: "Manuel",
          }),
        });
        setProgress({ total: files.length, done: i + 1 });
      }
      toast(`✓ ${files.length} fichier(s) ajoutés au projet`, "success");
      setFiles([]);
      setDescription("");
      onSuccess?.();
      onClose();
    } catch (e: any) {
      toast("Erreur : " + e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const tailleTotal = files.reduce((s, f) => s + f.size, 0);

  return (
    <BottomSheet
      ouvert={ouvert}
      onClose={onClose}
      titre="📸 Photos / Vidéos"
      soustitre="Classement direct dans un projet"
      couleurHeader="from-blue-600 to-indigo-600"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-3 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-semibold">Annuler</button>
          <button onClick={envoyer} disabled={busy || files.length === 0 || !projet_id} className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-bold disabled:opacity-50">
            {busy ? `⏳ ${progress.done}/${progress.total}` : `📤 Envoyer ${files.length}`}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {projets.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
            ⚠️ Aucun projet actif. <a href="/projets" className="font-bold underline">Crée un projet</a>.
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Projet *</label>
              <select value={projet_id} onChange={(e) => setProjetId(+e.target.value)} className="w-full px-3 py-3 border rounded-lg text-sm bg-white">
                {projets.map((p) => <option key={p.id} value={p.id}>{p.nom}{p.client_nom ? ` (${p.client_nom})` : ""}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-3 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: avant travaux" className="w-full px-3 py-3 border rounded-lg text-sm" />
              </div>
            </div>

            {/* Boutons rapides upload */}
            <div className="grid grid-cols-3 gap-2">
              <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-lg text-center font-bold text-sm flex flex-col items-center gap-1">
                <span className="text-2xl">📷</span>
                <span>Photo</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => ajouterFichiers(e.target.files)} />
              </label>
              <label className="cursor-pointer bg-red-600 hover:bg-red-500 text-white p-3 rounded-lg text-center font-bold text-sm flex flex-col items-center gap-1">
                <span className="text-2xl">🎥</span>
                <span>Vidéo</span>
                <input type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => ajouterFichiers(e.target.files)} />
              </label>
              <label className="cursor-pointer bg-slate-700 hover:bg-slate-600 text-white p-3 rounded-lg text-center font-bold text-sm flex flex-col items-center gap-1">
                <span className="text-2xl">📁</span>
                <span>Galerie</span>
                <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => ajouterFichiers(e.target.files)} />
              </label>
            </div>

            {/* Aperçu */}
            {files.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-slate-600 flex justify-between">
                  <span><strong>{files.length}</strong> fichier(s) sélectionné(s)</span>
                  <span>{(tailleTotal / 1024 / 1024).toFixed(1)} MB total → compressé</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {files.map((f, i) => {
                    const isVideo = f.type.startsWith("video/");
                    const url = URL.createObjectURL(f);
                    return (
                      <div key={i} className="relative aspect-square">
                        {isVideo ? (
                          <div className="w-full h-full bg-slate-200 rounded flex items-center justify-center text-3xl">🎥</div>
                        ) : (
                          <img src={url} alt={f.name} className="w-full h-full object-cover rounded" />
                        )}
                        <button onClick={() => retirer(i)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs font-bold flex items-center justify-center shadow">✕</button>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 truncate rounded-b">{(f.size / 1024 / 1024).toFixed(1)} MB</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {busy && (
              <div className="bg-blue-50 rounded p-2">
                <div className="text-xs font-semibold text-blue-900">⏳ {progress.done} / {progress.total} envoyé(s)</div>
                <div className="h-2 bg-blue-200 rounded overflow-hidden mt-1">
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
              </div>
            )}

            <p className="text-[10px] text-slate-500">📦 Images compressées à ~300 ko avant envoi (10× plus rapide). Vidéos envoyées tel quel.</p>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

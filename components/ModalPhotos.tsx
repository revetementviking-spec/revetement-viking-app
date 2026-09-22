"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";
import BottomSheet from "@/components/BottomSheet";
import MicVocal from "@/components/MicVocal";
import ProjetPicker from "@/components/ProjetPicker";
import { trierProjetsPourSaisie } from "@/lib/statuts-projet";
import { compresserImage, genererVignette } from "@/lib/img";
import { aujourdhuiMontreal } from "@/lib/date";

interface Props { ouvert: boolean; onClose: () => void; onSuccess?: () => void; projetIdInitial?: number; }

export default function ModalPhotos({ ouvert, onClose, onSuccess, projetIdInitial }: Props) {
  const today = aujourdhuiMontreal();
  const [projets, setProjets] = useState<any[]>([]);
  const [projet_id, setProjetId] = useState<number>(0);
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ total: 0, done: 0 });
  const [videoPct, setVideoPct] = useState<number | null>(null); // % d'upload vidéo en cours
  const { toast } = useToast();

  useEffect(() => {
    if (!ouvert) return;
    fetch("/api/projets?lite=1").then((r) => r.json()).then((tous: any[]) => {
      // Les chantiers COMPLÉTÉS restent disponibles : des photos arrivent après la fin
      // des travaux (retouches, inspection, avant/après pour le marketing, réclamation
      // de garantie). Ils étaient exclus d'office, donc introuvables même en cherchant
      // leur nom — la seule façon d'ajouter une photo était de passer par la fiche du
      // projet. ProjetPicker ne les propose pas par défaut mais les trouve à la recherche,
      // et les marque « ✅ complété ». Les projets ANNULÉS, eux, restent écartés.
      const dispo = trierProjetsPourSaisie(
        (Array.isArray(tous) ? tous : []).filter((p) => p.statut !== "annule"),
      );
      setProjets(dispo);
      if (!projet_id && dispo.length > 0) setProjetId(projetIdInitial || dispo[0].id);
    });
  }, [ouvert]);

  const ajouterFichiers = (fl: FileList | null) => {
    if (!fl) return;
    const MAX_IMAGE = 20 * 1024 * 1024;       // images : 20 Mo (compressées ensuite)
    const MAX_VIDEO = 2 * 1024 * 1024 * 1024; // vidéos : jusqu'à 2 Go (envoyées directement sur Drive)
    const ok = Array.from(fl).filter((f) => {
      const estVideo = f.type.startsWith("video/");
      const max = estVideo ? MAX_VIDEO : MAX_IMAGE;
      if (f.size > max) { toast(`${f.name} > ${estVideo ? "2 Go" : "20 Mo"} ignoré`, "warning"); return false; }
      return true;
    });
    setFiles((prev) => [...prev, ...ok]);
  };
  const retirer = (i: number) => setFiles(files.filter((_, idx) => idx !== i));

  // Vidéo : upload DIRECT vers Google Drive (gros fichiers, pleine qualité, contourne
  // la limite du serveur). Tentative de compression d'abord (échoue sur iPhone → original).
  const envoyerVideo = async (f: File) => {
    let videoFile: File = f;
    if (f.size > 5 * 1024 * 1024) {
      try {
        const { compresserVideo } = await import("@/lib/compress-video");
        videoFile = await compresserVideo(f);
      } catch { /* iOS / non supporté → on envoie l'original en pleine qualité */ }
    }
    const sess = await fetch("/api/photos/upload-session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projet_id, date, description: description || f.name, mimeType: videoFile.type || "video/mp4" }),
    }).then((r) => r.json());
    if (!sess.ok) throw new Error(sess.message || "Drive indisponible pour la vidéo");

    setVideoPct(0);
    const { uploaderVideoDrive } = await import("@/lib/uploadDrive");
    const res = await uploaderVideoDrive(sess.uploadUrl, videoFile, (pct) => setVideoPct(pct));
    setVideoPct(null);
    if (!res.ok) throw new Error(res.erreur || "Envoi vidéo échoué");

    // Réponse vérifiée : la vidéo est déjà SUR Drive à ce stade, mais c'est ce POST qui
    // l'enregistre dans l'app. S'il échoue (session expirée après un envoi de 2 Go, 500,
    // fichier introuvable), la vidéo existe chez Google et n'apparaît nulle part ici —
    // et le compte rendu annonçait quand même la réussite.
    const rEnr = await fetch("/api/photos/video", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projet_id, date, description: description || f.name, nom: sess.nom, mimeType: videoFile.type || "video/mp4", drive_id: res.driveId || null }),
    });
    if (!rEnr.ok) throw new Error(`Vidéo envoyée sur Drive mais NON enregistrée dans l'app (${rEnr.status}) — ${f.name}`);
  };

  // Envoie une seule image : compression + vignette + POST.
  const envoyerImage = async (f: File) => {
    const data = await compresserImage(f);
    const thumb = await genererVignette(f).catch(() => null);
    const r = await fetch("/api/photos", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projet_id, date, description: description || f.name,
        photo_data: data, photo_type: "image/jpeg", employes: "Manuel", thumb_data: thumb,
      }),
    });
    if (!r.ok) throw new Error(`Échec envoi ${f.name}`);
  };

  const envoyer = async () => {
    if (!projet_id) { toast("Choisis un projet", "warning"); return; }
    if (files.length === 0) { toast("Aucun fichier", "warning"); return; }
    setBusy(true);
    setProgress({ total: files.length, done: 0 });
    const avance = () => setProgress((p) => ({ ...p, done: p.done + 1 }));
    try {
      const videos = files.filter((f) => f.type.startsWith("video/"));
      const images = files.filter((f) => !f.type.startsWith("video/"));

      // Images : envoi EN PARALLÈLE (pool de 4) — beaucoup plus rapide que le séquentiel.
      const CONCURRENCE = 4;
      let curseur = 0;
      const echecs: string[] = [];
      const worker = async () => {
        while (curseur < images.length) {
          const f = images[curseur++];
          try { await envoyerImage(f); } catch (e: any) { echecs.push(f.name); }
          avance();
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCE, images.length) }, worker));

      // Vidéos : séquentielles (gros fichiers, barre de progression Drive partagée).
      for (const f of videos) {
        try { await envoyerVideo(f); } catch (e: any) { echecs.push(f.name); }
        avance();
      }

      const reussis = files.length - echecs.length;
      if (echecs.length === 0) {
        toast(`✓ ${reussis} fichier(s) ajoutés au projet`, "success");
      } else {
        toast(`${reussis}/${files.length} envoyés · ${echecs.length} échec(s) : ${echecs.slice(0, 3).join(", ")}`, "warning");
      }
      // On ne ferme que si tout a réussi ; sinon on garde la sélection pour réessayer.
      if (echecs.length === 0) {
        setFiles([]);
        setDescription("");
        onSuccess?.();
        onClose();
      } else {
        setFiles((prev) => prev.filter((f) => echecs.includes(f.name)));
        onSuccess?.();
      }
    } catch (e: any) {
      toast("Erreur : " + e.message, "error");
    } finally {
      setBusy(false);
      setVideoPct(null);
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
            {busy ? (videoPct !== null ? `🎥 ${videoPct}%` : `⏳ ${progress.done}/${progress.total}`) : `📤 Envoyer ${files.length}`}
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
              <ProjetPicker value={projet_id} onChange={(pid) => setProjetId(pid)} projets={projets} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-3 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <div className="flex gap-2">
                  <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: avant travaux… ou micro →" className="flex-1 px-3 py-3 border rounded-lg text-sm" />
                  <MicVocal taille="sm" onTranscript={(t) => setDescription((d) => (d ? d + " " : "") + t)} titre="Dicter la description de la photo" />
                </div>
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
                  <span>{(tailleTotal / 1024 / 1024).toFixed(1)} Mo total → compressé</span>
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
                        {/* Cible tactile 44 px (la pastille visible reste petite) */}
                        <button type="button" onClick={() => retirer(i)} aria-label={`Retirer ${f.name}`} className="absolute -top-3 -right-3 w-11 h-11 flex items-center justify-center">
                          <span aria-hidden="true" className="bg-red-500 text-white rounded-full w-6 h-6 text-xs font-bold flex items-center justify-center shadow">✕</span>
                        </button>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 truncate rounded-b">{(f.size / 1024 / 1024).toFixed(1)} Mo</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {busy && (
              <div className="bg-blue-50 rounded p-2 space-y-1">
                <div className="text-xs font-semibold text-blue-900">⏳ {progress.done} / {progress.total} fichier(s)</div>
                <div className="h-2 bg-blue-200 rounded overflow-hidden">
                  <div className="h-full bg-blue-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
                {videoPct !== null && (
                  <>
                    <div className="text-[10px] text-blue-800">🎥 Envoi de la vidéo vers Drive… {videoPct}% (ne ferme pas l'app)</div>
                    <div className="h-2 bg-blue-200 rounded overflow-hidden">
                      <div className="h-full bg-emerald-600 transition-all" style={{ width: `${videoPct}%` }} />
                    </div>
                  </>
                )}
              </div>
            )}

            <p className="text-[10px] text-slate-500">📦 Photos compressées à ~300 ko avant envoi. 🎥 Vidéos (jusqu'à 2 Go, plusieurs minutes) envoyées directement sur Google Drive en pleine qualité — l'envoi peut être long selon le réseau.</p>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

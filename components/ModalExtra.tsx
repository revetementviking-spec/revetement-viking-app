"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toasts";
import BottomSheet from "@/components/BottomSheet";
import MicVocal from "@/components/MicVocal";
import ProjetPicker from "@/components/ProjetPicker";
import { compresserImage, genererVignette } from "@/lib/img";
import { aujourdhuiMontreal } from "@/lib/date";
import { nombreSaisi } from "@/lib/envoi";
import { postOuFile } from "@/lib/fileOffline";

interface Props { ouvert: boolean; onClose: () => void; onSuccess?: () => void; projetIdInitial?: number; }

type Nature = "montant" | "heures" | "materiaux";
const NATURES: { cle: Nature; label: string; icone: string }[] = [
  { cle: "montant", label: "Montant $", icone: "💰" },
  { cle: "heures", label: "Heures", icone: "⏱️" },
  { cle: "materiaux", label: "Matériaux", icone: "📦" },
];

export default function ModalExtra({ ouvert, onClose, onSuccess, projetIdInitial }: Props) {
  const today = aujourdhuiMontreal();
  const [projets, setProjets] = useState<any[]>([]);
  const [projet_id, setProjetId] = useState<number>(0);
  const [date, setDate] = useState(today);
  const [nature, setNature] = useState<Nature>("montant");
  const [description, setDescription] = useState("");
  const [montant, setMontant] = useState("");
  const [heures, setHeures] = useState("");
  const [photo, setPhoto] = useState<{ data: string; thumb: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!ouvert) return;
    fetch("/api/projets?lite=1").then((r) => r.json()).then((tous: any[]) => {
      const dispo = (Array.isArray(tous) ? tous : []).filter((p) => p.statut !== "annule");
      setProjets(dispo);
      if (!projet_id && dispo.length > 0) setProjetId(projetIdInitial || dispo[0].id);
    }).catch(() => {});
  }, [ouvert]);

  const ajouterPhoto = async (f: File) => {
    if (f.size > 20 * 1024 * 1024) { toast("Photo > 20 Mo", "warning"); return; }
    try {
      const data = await compresserImage(f);
      const thumb = await genererVignette(f).catch(() => null);
      setPhoto({ data, thumb });
    } catch (e: any) { toast("Erreur image : " + (e?.message || ""), "error"); }
  };

  // Verrou par référence (lib/verrou.ts) : deux clics du même instant créaient deux extras.
  const enCours = useRef(false);
  const enregistrer = async () => {
    if (enCours.current) return;
    enCours.current = true;
    try { await enregistrerReel(); } finally { enCours.current = false; }
  };
  const enregistrerReel = async () => {
    if (!description.trim()) { toast("Ajoute une description de l'extra", "warning"); return; }
    // Nombres envoyés comme NOMBRES (ou null si le champ est vide), jamais comme chaînes.
    // nombreSaisi accepte « 250 », « 250,50 », « 1 250 $ » ; une saisie illisible est
    // refusée avec message au lieu d'être convertie en silence.
    let montantNum: number | null = null, heuresNum: number | null = null;
    if (nature === "montant" && montant.trim()) {
      montantNum = nombreSaisi(montant);
      if (!Number.isFinite(montantNum)) { toast(`Montant illisible : « ${montant} » — écris par exemple 250,50`, "warning"); return; }
    }
    if (nature === "heures" && heures.trim()) {
      heuresNum = nombreSaisi(heures);
      if (!Number.isFinite(heuresNum)) { toast(`Heures illisibles : « ${heures} » — écris par exemple 3,5`, "warning"); return; }
    }
    setBusy(true);
    try {
      // postOuFile (lib/fileOffline.ts) : clé d'idempotence dès le premier essai ; réseau
      // coupé = mise en file locale, rejouée au retour du réseau avec la même clé.
      const r = await postOuFile("/api/extras", {
        projet_id: projet_id || null, date, nature, description,
        montant: montantNum,
        heures: heuresNum,
        photo_data: photo?.data || null, thumb_data: photo?.thumb || null,
        projet_nom: projets.find((p) => p.id === projet_id)?.nom,
      });
      if (r.ok) {
        if (r.offline) toast("📴 Hors ligne — extra gardé sur l'appareil, il partira au retour du réseau", "warning");
        else toast("✓ Extra enregistré — la gestion sera notifiée pour le facturer", "success");
        setDescription(""); setMontant(""); setHeures(""); setPhoto(null); setNature("montant");
        if (!r.offline) onSuccess?.();
        onClose();
      } else {
        // Échec explicite (avant : « Erreur » sans détail) — modal gardé ouvert pour réessayer.
        toast("❌ " + (/non authentifi|HTTP 401/i.test(r.erreur || "") ? "Session expirée — reconnecte-toi." : (r.data?.message || r.erreur || "Échec. Réessaie.")), "error");
      }
    } catch {
      toast("❌ Problème de connexion — réessaie.", "error");
    } finally { setBusy(false); }
  };

  return (
    <BottomSheet
      ouvert={ouvert}
      onClose={onClose}
      titre="💲 Extra à facturer"
      soustitre="Travaux, heures ou matériaux supplémentaires (hors soumission)"
      couleurHeader="from-amber-600 to-orange-600"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-3 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-semibold">Annuler</button>
          <button onClick={enregistrer} disabled={busy || !description.trim()} className="px-5 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-bold disabled:opacity-50">
            {busy ? "⏳…" : "💾 Enregistrer l'extra"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Projet</label>
          <ProjetPicker value={projet_id} onChange={(pid) => setProjetId(pid)} projets={projets} aucunLabel="— Sans projet —" />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Nature de l'extra</label>
          <div className="grid grid-cols-3 gap-2">
            {NATURES.map((n) => (
              <button key={n.cle} type="button" onClick={() => setNature(n.cle)}
                className={`p-2 rounded-lg border-2 text-sm font-semibold transition ${nature === n.cle ? "bg-amber-50 border-amber-500 text-amber-900" : "bg-white border-slate-200 hover:border-amber-300"}`}>
                <div className="text-xl">{n.icone}</div>{n.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Description {nature === "materiaux" ? "(liste des matériaux)" : ""}</label>
          <div className="flex gap-2 items-start">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
              placeholder={nature === "materiaux" ? "Ex: 2 boîtes de clous, 1 fascia 12'… ou micro →" : "Ex: imprévu, travaux supplémentaires… ou micro →"}
              className="flex-1 px-3 py-2 border rounded-lg text-sm resize-y min-h-[4.5rem]" />
            <MicVocal taille="sm" onTranscript={(t) => setDescription((d) => (d ? d + " " : "") + t)} titre="Dicter l'extra" />
          </div>
        </div>

        {nature === "montant" && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Montant ($) <span className="text-slate-400">— optionnel, la gestion peut le fixer</span></label>
            {/* type="text" : un <input type="number"> refuse la virgule du clavier québécois (valeur vidée en silence). */}
            <input type="text" inputMode="decimal" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="ex. : 250,50 (ou laisse vide)" className="w-full px-3 py-3 border rounded-lg text-sm text-right font-bold" />
          </div>
        )}
        {nature === "heures" && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Heures supplémentaires <span className="text-slate-400">— optionnel</span></label>
            <input type="text" inputMode="decimal" value={heures} onChange={(e) => setHeures(e.target.value)} placeholder="ex. : 3,5" className="w-full px-3 py-3 border rounded-lg text-sm text-right font-bold" />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Photo justificative <span className="text-slate-400">— optionnel</span></label>
          {photo ? (
            <div className="relative inline-block">
              <img src={photo.thumb || photo.data} alt="Extra" className="w-24 h-24 object-cover rounded border" />
              {/* Cible tactile 44 px (la pastille visible reste petite) */}
              <button type="button" onClick={() => setPhoto(null)} aria-label="Retirer la photo" className="absolute -top-3 -right-3 w-11 h-11 flex items-center justify-center">
                <span aria-hidden="true" className="bg-red-500 text-white rounded-full w-6 h-6 text-xs font-bold flex items-center justify-center shadow">✕</span>
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-sm font-bold">
                📷 Photo
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && ajouterPhoto(e.target.files[0])} />
              </label>
              <label className="cursor-pointer bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-sm font-bold">
                📁 Galerie
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && ajouterPhoto(e.target.files[0])} />
              </label>
            </div>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}

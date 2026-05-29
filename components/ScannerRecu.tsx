"use client";

import { useEffect, useState } from "react";
import { autoCadrer, filtreDocument, ocrRecu } from "@/lib/imgScanner";

interface Props {
  imageOriginale: string;
  onClose: () => void;
  onConfirmer: (image: string, type: string, donneesOcr?: { montant?: number; date?: string; fournisseur?: string }) => void;
}

/** Modal de traitement d'un reçu : cadrage auto, filtre "scan", OCR optionnel. */
export default function ScannerRecu({ imageOriginale, onClose, onConfirmer }: Props) {
  const [traitee, setTraitee] = useState<string | null>(null);
  const [montre, setMontre] = useState<"scan" | "original">("scan");
  const [busy, setBusy] = useState(false);
  const [ocr, setOcr] = useState<{ montant?: number; date?: string; fournisseur?: string; texte?: string } | null>(null);
  const [ocrProgress, setOcrProgress] = useState<number>(0);
  const [erreur, setErreur] = useState("");

  // Au montage : cadrer + filtrer automatiquement
  useEffect(() => {
    let alive = true;
    (async () => {
      setBusy(true); setErreur("");
      try {
        const cadree = await autoCadrer(imageOriginale);
        const filtree = await filtreDocument(cadree, 1);
        if (alive) setTraitee(filtree);
      } catch (e: any) {
        if (alive) setErreur("Filtre échoué : " + (e?.message || ""));
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [imageOriginale]);

  const lancerOcr = async () => {
    const cible = traitee || imageOriginale;
    setBusy(true); setOcrProgress(0); setErreur("");
    try {
      const r = await ocrRecu(cible, (p) => setOcrProgress(p));
      setOcr(r);
    } catch (e: any) {
      setErreur("OCR échoué : " + (e?.message || ""));
    } finally { setBusy(false); }
  };

  const confirmer = () => {
    const img = montre === "scan" && traitee ? traitee : imageOriginale;
    onConfirmer(img, "image/jpeg", ocr ? { montant: ocr.montant, date: ocr.date, fournisseur: ocr.fournisseur } : undefined);
  };

  const apercu = montre === "scan" && traitee ? traitee : imageOriginale;

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl md:rounded-lg max-w-2xl w-full max-h-[95vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 bg-gradient-to-r from-blue-700 to-indigo-700 text-white p-4 flex justify-between items-center">
          <div>
            <h2 className="font-bold text-lg">📄 Scanner le reçu</h2>
            <p className="text-xs opacity-80">Cadrage auto · Filtre document · OCR</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-xl leading-none">✕</button>
        </header>

        <div className="p-4 space-y-3">
          {/* Bascule original / scan */}
          <div className="flex gap-1 bg-slate-100 rounded p-1 w-fit">
            <button onClick={() => setMontre("scan")} className={`px-3 py-1.5 rounded text-xs font-semibold ${montre === "scan" ? "bg-white shadow text-slate-900" : "text-slate-500"}`}>📄 Scan filtré</button>
            <button onClick={() => setMontre("original")} className={`px-3 py-1.5 rounded text-xs font-semibold ${montre === "original" ? "bg-white shadow text-slate-900" : "text-slate-500"}`}>🖼️ Original</button>
          </div>

          {/* Aperçu */}
          <div className="bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center" style={{ minHeight: 200 }}>
            {busy && !traitee ? (
              <div className="text-white text-sm py-12">⏳ Traitement en cours…</div>
            ) : (
              <img src={apercu} alt="Reçu" className="max-w-full max-h-[55vh] object-contain" />
            )}
          </div>

          {/* OCR */}
          <div className="bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold">🔍 OCR (extraction du texte)</span>
              <button onClick={lancerOcr} disabled={busy} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white rounded text-xs font-bold">
                {busy && ocrProgress > 0 ? `Analyse… ${Math.round(ocrProgress * 100)}%` : "🔎 Scanner le texte"}
              </button>
            </div>
            {ocr ? (
              <div className="text-xs space-y-1 bg-white border border-slate-200 rounded p-2">
                <div>💰 Montant détecté : <strong>{ocr.montant !== undefined ? `${ocr.montant.toFixed(2)} $` : <em className="text-slate-400">non trouvé</em>}</strong></div>
                <div>📅 Date détectée : <strong>{ocr.date || <em className="text-slate-400">non trouvée</em>}</strong></div>
                <div>🏷️ Fournisseur : <strong className="truncate inline-block max-w-full">{ocr.fournisseur || <em className="text-slate-400">non trouvé</em>}</strong></div>
                <p className="text-[10px] text-slate-500 italic mt-1">Les valeurs détectées rempliront automatiquement le formulaire si tu confirmes.</p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 italic">Clique pour extraire montant, date et fournisseur depuis le reçu. ~5-15 s.</p>
            )}
          </div>

          {erreur && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{erreur}</div>}
        </div>

        <footer className="sticky bottom-0 bg-white border-t p-3 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
          <button onClick={confirmer} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">
            ✓ Utiliser cette image
          </button>
        </footer>
      </div>
    </div>
  );
}

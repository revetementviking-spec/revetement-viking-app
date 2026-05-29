"use client";

import { useEffect, useRef, useState } from "react";

export interface PhotoLightbox { id: number; description?: string; date?: string; }

/** Visualiseur plein écran : swipe gauche/droite, flèches, clavier, bouton retour. */
export default function Lightbox({
  photos, index, onClose, onIndexChange,
}: {
  photos: PhotoLightbox[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const [dragX, setDragX] = useState(0);
  const startX = useRef<number | null>(null);
  const photo = photos[index];

  const prec = () => onIndexChange((index - 1 + photos.length) % photos.length);
  const suiv = () => onIndexChange((index + 1) % photos.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prec();
      else if (e.key === "ArrowRight") suiv();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow; };
  }, [index, photos.length]);

  if (!photo) return null;

  const onTouchStart = (e: React.TouchEvent) => { startX.current = e.touches[0].clientX; };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startX.current !== null) setDragX(e.touches[0].clientX - startX.current);
  };
  const onTouchEnd = () => {
    if (Math.abs(dragX) > 60) { dragX < 0 ? suiv() : prec(); }
    setDragX(0); startX.current = null;
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/95 flex flex-col select-none"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Barre haut : retour + compteur + télécharger */}
      <div className="flex items-center justify-between p-3 text-white safe-top">
        <button onClick={onClose} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 font-semibold text-sm">
          ← Retour
        </button>
        <span className="text-sm opacity-80">{index + 1} / {photos.length}</span>
        <a href={`/api/photos/${photo.id}`} target="_blank" rel="noreferrer" download className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">⬇</a>
      </div>

      {/* Image */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden" onClick={onClose}>
        <img
          src={`/api/photos/${photo.id}`}
          alt={photo.description || ""}
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain"
          style={{ transform: `translateX(${dragX}px)`, transition: dragX === 0 ? "transform 0.2s" : "none" }}
        />

        {/* Flèches (desktop / clic) */}
        {photos.length > 1 && (
          <>
            <button onClick={(e) => { e.stopPropagation(); prec(); }} aria-label="Précédente"
              className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl flex items-center justify-center">‹</button>
            <button onClick={(e) => { e.stopPropagation(); suiv(); }} aria-label="Suivante"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl flex items-center justify-center">›</button>
          </>
        )}
      </div>

      {/* Légende bas */}
      {(photo.description || photo.date) && (
        <div className="p-3 text-center text-white/80 text-sm safe-bottom">
          {photo.date && <span className="opacity-60">{photo.date} · </span>}{photo.description}
        </div>
      )}
    </div>
  );
}

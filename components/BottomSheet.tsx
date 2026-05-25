"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  ouvert: boolean;
  onClose: () => void;
  titre?: string;
  soustitre?: string;
  couleurHeader?: string; // ex: "from-emerald-600 to-teal-600"
  children: ReactNode;
  footer?: ReactNode; // boutons d'action en bas
  taille?: "auto" | "full"; // hauteur sheet
}

export default function BottomSheet({
  ouvert, onClose, titre, soustitre, couleurHeader = "from-slate-800 to-slate-900",
  children, footer, taille = "auto",
}: Props) {
  const contenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ouvert) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    // Auto-focus du premier champ texte/select visible (après mount)
    const t = setTimeout(() => {
      const root = contenuRef.current;
      if (!root) return;
      const cible = root.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), select:not([disabled]), textarea:not([disabled])'
      );
      cible?.focus();
    }, 80);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [ouvert, onClose]);

  if (!ouvert) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex md:items-center md:justify-center items-end animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-white w-full md:max-w-2xl md:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col animate-in slide-in-from-bottom md:zoom-in-95 duration-200 ${
          taille === "full" ? "h-[95vh]" : "max-h-[92vh]"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle visible only on mobile */}
        <div className="md:hidden flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 bg-slate-300 rounded-full" />
        </div>

        {titre && (
          <div className={`bg-gradient-to-r ${couleurHeader} text-white p-4 md:rounded-t-2xl flex justify-between items-start gap-2`}>
            <div className="min-w-0 flex-1">
              <h3 className="text-base md:text-lg font-bold">{titre}</h3>
              {soustitre && <p className="text-xs opacity-90 mt-0.5">{soustitre}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Fermer"
              className="w-9 h-9 rounded-full hover:bg-white/20 flex items-center justify-center text-xl shrink-0"
            >
              ×
            </button>
          </div>
        )}

        <div ref={contenuRef} className="overflow-y-auto flex-1 p-4">
          {children}
        </div>

        {footer && (
          <div className="border-t bg-slate-50 p-3 flex gap-2 justify-end" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

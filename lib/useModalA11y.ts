"use client";
import { useEffect, useRef } from "react";

/** Hook a11y pour modals :
 * - Auto-focus le premier champ visible à l'ouverture
 * - Esc ferme la modal
 * - Body scroll lock pendant que la modal est ouverte
 *
 * Usage :
 *   const ref = useModalA11y(ouvert, onClose);
 *   <div ref={ref} role="dialog" aria-modal="true">…</div>
 */
export function useModalA11y(ouvert: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ouvert) return;

    // Auto-focus le premier champ après un tick (laisser le DOM se monter)
    const t = setTimeout(() => {
      const root = containerRef.current;
      if (!root) return;
      const cible = root.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
      );
      cible?.focus();
    }, 50);

    // Esc ferme
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);

    // Scroll lock
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [ouvert, onClose]);

  return containerRef;
}

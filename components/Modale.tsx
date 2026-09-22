"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useModalA11y } from "@/lib/useModalA11y";

/**
 * Surcouche de modale accessible : `role="dialog"`, `aria-modal`, fermeture par Échap,
 * focus initial sur le premier champ, verrou du défilement, et RETOUR du focus sur
 * l'élément qui a ouvert la modale à la fermeture.
 *
 * Remplace le motif inline `<div className="fixed inset-0 …" onClick={fermer}>…</div>`
 * qui n'annonçait rien aux lecteurs d'écran, ne se fermait pas au clavier et laissait
 * le focus perdu au fond de la page une fois refermé. Les classes de la surcouche sont
 * passées telles quelles (`className`) : chaque écran garde son apparence.
 *
 * Usage :
 *   <Modale onClose={() => setOuvert(false)} titre="Nouveau client" className="fixed inset-0 …">
 *     <div onClick={(e) => e.stopPropagation()}>…</div>
 *   </Modale>
 */
export default function Modale({ onClose, titre, className, children, fermerAuClicFond = true }: {
  onClose: () => void;
  /** Nom annoncé par les lecteurs d'écran (aria-label). */
  titre: string;
  className?: string;
  children: ReactNode;
  /** Un clic sur le fond ferme la modale (comportement historique des écrans). */
  fermerAuClicFond?: boolean;
}) {
  // `onClose` est presque toujours une fonction fléchée recréée à chaque rendu : passée
  // directement au hook, elle relancerait l'effet (et le focus initial) à CHAQUE frappe
  // dans un champ. On la garde dans une ref et on donne au hook une fonction stable.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fermer = useCallback(() => onCloseRef.current(), []);
  const ref = useModalA11y(true, fermer);

  // Retour du focus : à l'ouverture on note l'élément actif (le bouton cliqué), à la
  // fermeture on le lui rend, s'il est toujours dans la page.
  useEffect(() => {
    const precedent = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
    return () => {
      if (precedent && typeof precedent.focus === "function" && document.contains(precedent)) {
        try { precedent.focus(); } catch { /* élément non focalisable */ }
      }
    };
  }, []);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={titre}
      className={className}
      onClick={fermerAuClicFond ? fermer : undefined}
    >
      {children}
    </div>
  );
}

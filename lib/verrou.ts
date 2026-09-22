import { useRef, useState, useCallback } from "react";

/** Verrou anti-double-soumission pour un bouton qui écrit.
 *
 *  Pourquoi un ref et pas seulement un état : `if (busy) return` avec un `useState` ne
 *  protège PAS de deux clics dans le même instant. Les deux gestionnaires s'exécutent
 *  avant que React n'ait re-rendu avec `busy = true`, et avant que l'attribut `disabled`
 *  du bouton ne s'applique — les deux passent donc la garde. Mesuré en direct : un
 *  double-clic sur « Ajouter la note » créait bien DEUX notes identiques en base.
 *  Un ref change tout de suite : le second clic est bloqué.
 *
 *  L'état `occupe` reste utile pour l'affichage (bouton grisé, libellé « … »).
 *
 *  Usage :
 *    const verrou = useVerrou();
 *    const envoyerFormulaire = () => verrou.executer(async () => { … });
 *    <button disabled={verrou.occupe}>…</button>
 */

/** Cœur du verrou, sans React : testable en isolation (lib/verrou.test.ts).
 *  `executer` retourne `false` si l'action a été ignorée parce qu'une autre tournait. */
export function creerVerrou(onChange?: (occupe: boolean) => void) {
  let enCours = false;
  return {
    estOccupe: () => enCours,
    executer: async (action: () => Promise<void> | void): Promise<boolean> => {
      if (enCours) return false;
      enCours = true;
      onChange?.(true);
      try {
        await action();
        return true;
      } finally {
        enCours = false;
        onChange?.(false);
      }
    },
  };
}

export function useVerrou() {
  const [occupe, setOccupe] = useState(false);
  // Le verrou vit dans un ref : il ne dépend d'aucun rendu, donc il bloque le second
  // clic même quand React n'a pas encore appliqué `disabled`.
  const verrou = useRef<ReturnType<typeof creerVerrou> | null>(null);
  if (!verrou.current) verrou.current = creerVerrou(setOccupe);

  /** Lance `action` si rien n'est déjà en cours. Retourne `false` si le geste a été
   *  ignoré parce qu'un envoi tournait déjà. */
  const executer = useCallback((action: () => Promise<void> | void): Promise<boolean> => verrou.current!.executer(action), []);

  return { occupe, executer };
}

"use client";

/**
 * État d'erreur d'une lecture, avec bouton « Réessayer ».
 *
 * Avant, une lecture qui échouait (500, réseau coupé, session expirée) laissait l'écran
 * sur « Chargement... » pour toujours ou sur une liste vide qui ressemblait à « rien à
 * afficher ». Ici on dit ce qui s'est passé et on offre de recommencer.
 *
 * Sur un 401, Garde401 redirige déjà vers /login : le composant s'affiche le temps de
 * la redirection, sans toast supplémentaire.
 */
export default function ErreurChargement({ erreur, onReessayer, compact }: { erreur: string; onReessayer?: () => void; compact?: boolean }) {
  return (
    <div role="alert" className={`bg-red-50 border border-red-200 text-red-800 rounded-lg ${compact ? "p-3 text-xs" : "p-6 text-sm"} flex flex-col sm:flex-row items-center justify-center gap-3 text-center`}>
      <span>Impossible de charger les données : {erreur}</span>
      {onReessayer && (
        <button type="button" onClick={onReessayer} className="px-4 py-2 min-h-11 bg-white border border-red-300 hover:bg-red-100 rounded font-semibold text-red-800">
          Réessayer
        </button>
      )}
    </div>
  );
}

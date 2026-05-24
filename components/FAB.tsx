"use client";

import { useState, lazy, Suspense } from "react";

const ModalHeuresJour = lazy(() => import("@/components/ModalHeuresJour"));
const ModalDepense = lazy(() => import("@/components/ModalDepense"));
const ModalPhotos = lazy(() => import("@/components/ModalPhotos"));

interface Props { onSuccess?: () => void; }

/**
 * FAB (Floating Action Button) avec menu expansible.
 * Visible sur toutes les pages, bottom-right au-dessus du bottom nav mobile.
 */
export default function FAB({ onSuccess }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [modalHeures, setModalHeures] = useState(false);
  const [modalDepense, setModalDepense] = useState(false);
  const [modalPhotos, setModalPhotos] = useState(false);

  const fermer = () => setOuvert(false);

  return (
    <>
      {/* Overlay pour fermer en cliquant ailleurs */}
      {ouvert && (
        <div className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={fermer} />
      )}

      {/* Container FAB - bottom right, au-dessus du bottom nav mobile */}
      <div className="fixed right-4 z-40 flex flex-col items-end gap-2" style={{ bottom: "calc(env(safe-area-inset-bottom) + 5rem)" }}>
        {/* Sous-actions */}
        {ouvert && (
          <>
            <button
              onClick={() => { fermer(); setModalHeures(true); }}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-3 rounded-full shadow-lg font-semibold text-sm animate-in slide-in-from-right duration-150"
            >
              ⏱️ Saisir heures
            </button>
            <button
              onClick={() => { fermer(); setModalDepense(true); }}
              className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white px-4 py-3 rounded-full shadow-lg font-semibold text-sm animate-in slide-in-from-right duration-150"
            >
              💸 Dépense
            </button>
            <button
              onClick={() => { fermer(); setModalPhotos(true); }}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-3 rounded-full shadow-lg font-semibold text-sm animate-in slide-in-from-right duration-150"
            >
              📸 Photos / Vidéo
            </button>
            <a
              href="/soumissions/nouveau"
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-3 rounded-full shadow-lg font-semibold text-sm animate-in slide-in-from-right duration-150"
            >
              📄 Soumission
            </a>
          </>
        )}

        {/* FAB principal */}
        <button
          onClick={() => setOuvert(!ouvert)}
          aria-label={ouvert ? "Fermer menu" : "Ouvrir menu actions"}
          className={`w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-2xl transition-all ${
            ouvert ? "bg-red-500 hover:bg-red-400 rotate-45" : "bg-slate-900 hover:bg-slate-800"
          } text-white`}
        >
          {ouvert ? "✕" : "＋"}
        </button>
      </div>

      <Suspense fallback={null}>
        {modalHeures && <ModalHeuresJour ouvert={modalHeures} onClose={() => setModalHeures(false)} onSuccess={onSuccess} />}
        {modalDepense && <ModalDepense ouvert={modalDepense} onClose={() => setModalDepense(false)} onSuccess={onSuccess} />}
        {modalPhotos && <ModalPhotos ouvert={modalPhotos} onClose={() => setModalPhotos(false)} onSuccess={onSuccess} />}
      </Suspense>
    </>
  );
}

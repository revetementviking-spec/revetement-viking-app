"use client";

/**
 * Pagination côté client pour les longues listes (dépenses, soumissions…).
 *
 * Pourquoi côté client : les pages font le filtrage, les totaux/KPIs et l'export
 * CSV sur l'ENSEMBLE du jeu filtré. On ne pagine donc que l'AFFICHAGE des lignes
 * (fenêtrage), pas les données — les calculs restent corrects sur tout le set.
 *
 * Usage :
 *   const { page, pageSize, setPage, setPageSize, debut, fin } = usePagination(filtrees.length);
 *   const visibles = filtrees.slice(debut, fin);
 *   ...rendre `visibles`...
 *   <Pagination total={filtrees.length} page={page} pageSize={pageSize}
 *               onPage={setPage} onPageSize={setPageSize} />
 */

import { useEffect, useMemo, useState } from "react";

export const TAILLES_PAGE = [25, 50, 100, 200] as const;

/** Hook compagnon : gère page + taille et borne la fenêtre. Remet à la page 1
 * quand le total change (ex. l'utilisateur modifie un filtre). */
export function usePagination(total: number, tailleInitiale: number = 50) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(tailleInitiale);

  const nbPages = Math.max(1, Math.ceil(total / pageSize));
  // Garde la page dans les bornes si le total ou la taille rétrécit.
  const pageSure = Math.min(page, nbPages);
  useEffect(() => { if (page !== pageSure) setPage(pageSure); }, [page, pageSure]);

  const debut = (pageSure - 1) * pageSize;
  const fin = debut + pageSize;

  return {
    page: pageSure,
    pageSize,
    setPage,
    setPageSize: (n: number) => { setPageSize(n); setPage(1); },
    /** À appeler quand les filtres changent pour revenir au début. */
    reset: () => setPage(1),
    debut,
    fin,
    nbPages,
  };
}

export default function Pagination({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  label = "entrées",
}: {
  total: number;
  page: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (n: number) => void;
  /** Nom des éléments listés, ex. "dépenses", "soumissions". */
  label?: string;
}) {
  const nbPages = Math.max(1, Math.ceil(total / pageSize));
  const debut = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const fin = Math.min(page * pageSize, total);

  // Numéros de page affichés : 1 … (page-1, page, page+1) … nbPages
  const numeros = useMemo(() => {
    const s = new Set<number>([1, nbPages, page, page - 1, page + 1]);
    return Array.from(s).filter((n) => n >= 1 && n <= nbPages).sort((a, b) => a - b);
  }, [page, nbPages]);

  // Inutile d'afficher la barre s'il n'y a qu'une page et la taille par défaut.
  if (total <= pageSize && page === 1 && nbPages === 1) {
    return (
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-slate-500">
        <span>{total} {label}</span>
        <TailleSelect pageSize={pageSize} onPageSize={onPageSize} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t bg-slate-50 text-xs">
      <span className="text-slate-600 font-medium">
        {debut.toLocaleString("fr-CA")}–{fin.toLocaleString("fr-CA")} sur {total.toLocaleString("fr-CA")} {label}
      </span>

      <div className="flex items-center gap-1">
        <BtnPage onClick={() => onPage(1)} disabled={page <= 1} aria="Première page">«</BtnPage>
        <BtnPage onClick={() => onPage(page - 1)} disabled={page <= 1} aria="Page précédente">‹</BtnPage>
        {numeros.map((n, i) => {
          const trou = i > 0 && n - numeros[i - 1] > 1;
          return (
            <span key={n} className="flex items-center">
              {trou && <span className="px-1 text-slate-400">…</span>}
              <button
                onClick={() => onPage(n)}
                aria-current={n === page ? "page" : undefined}
                className={`min-w-[28px] px-2 py-1 rounded font-semibold ${
                  n === page ? "bg-slate-900 text-white" : "bg-white border hover:bg-slate-100 text-slate-700"
                }`}
              >
                {n}
              </button>
            </span>
          );
        })}
        <BtnPage onClick={() => onPage(page + 1)} disabled={page >= nbPages} aria="Page suivante">›</BtnPage>
        <BtnPage onClick={() => onPage(nbPages)} disabled={page >= nbPages} aria="Dernière page">»</BtnPage>
      </div>

      <TailleSelect pageSize={pageSize} onPageSize={onPageSize} />
    </div>
  );
}

function TailleSelect({ pageSize, onPageSize }: { pageSize: number; onPageSize: (n: number) => void }) {
  return (
    <label className="flex items-center gap-1 text-slate-500">
      <span className="hidden sm:inline">Par page</span>
      <select
        value={pageSize}
        onChange={(e) => onPageSize(+e.target.value)}
        className="px-2 py-1 border rounded bg-white text-slate-700"
        aria-label="Nombre d'éléments par page"
      >
        {TAILLES_PAGE.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </label>
  );
}

function BtnPage({ onClick, disabled, aria, children }: { onClick: () => void; disabled: boolean; aria: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={aria}
      className="min-w-[28px] px-2 py-1 rounded bg-white border text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed font-bold"
    >
      {children}
    </button>
  );
}

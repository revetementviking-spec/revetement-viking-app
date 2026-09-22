"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { enregistrerToast } from "@/lib/toast-bus";

type ToastType = "success" | "error" | "info" | "warning";
interface Toast {
  id: number;
  type: ToastType;
  msg: string;
  action?: { label: string; onClick: () => void };
}

interface ToastOptions {
  duration?: number; // ms
  action?: { label: string; onClick: () => void };
}

interface ToastCtx {
  toast: (msg: string, type?: ToastType, options?: ToastOptions) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Minuteries en cours : nettoyées à la fermeture manuelle et au démontage (avant, un
  // setTimeout orphelin appelait setState sur un fournisseur démonté).
  const minuteries = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const retire = useCallback((id: number) => {
    const t = minuteries.current.get(id);
    if (t) { clearTimeout(t); minuteries.current.delete(id); }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback((msg: string, type: ToastType = "info", options?: ToastOptions) => {
    const id = Date.now() + Math.random();
    const duree = options?.duration ?? (options?.action ? 8000 : type === "error" ? 6000 : 3500);
    setToasts((prev) => [...prev, { id, msg, type, action: options?.action }]);
    minuteries.current.set(id, setTimeout(() => retire(id), duree));
  }, [retire]);

  useEffect(() => {
    const m = minuteries.current;
    return () => { for (const t of m.values()) clearTimeout(t); m.clear(); };
  }, []);

  // Rend `toast` joignable hors React (lib/toast-bus.ts) : les helpers d'écriture
  // partagés signalent leurs échecs par là, sans passer par le hook.
  useEffect(() => enregistrerToast(toast), [toast]);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      {/* Mobile : ancrés en BAS, au-dessus du bouton flottant et de la barre de navigation
          (le pouce est là, et l'en-tête collant les cachait à moitié) ; desktop : en haut à droite. */}
      <div
        className="fixed left-4 right-4 md:left-auto md:right-4 md:top-20 md:bottom-auto z-50 space-y-2 md:max-w-sm pointer-events-none"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 10rem)" }}
        role="status"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-lg shadow-lg border-l-4 text-sm font-medium pointer-events-auto animate-in slide-in-from-right ${
              t.type === "success" ? "bg-emerald-50 border-emerald-500 text-emerald-900" :
              t.type === "error" ? "bg-red-50 border-red-500 text-red-900" :
              t.type === "warning" ? "bg-amber-50 border-amber-500 text-amber-900" :
              "bg-blue-50 border-blue-500 text-blue-900"
            }`}
          >
            <div className="flex items-start gap-2">
              <span className="text-lg leading-none" aria-hidden="true">
                {t.type === "success" ? "✅" : t.type === "error" ? "❌" : t.type === "warning" ? "⚠️" : "ℹ️"}
              </span>
              <span className="flex-1 whitespace-pre-wrap">{t.msg}</span>
              {t.action && (
                <button
                  onClick={() => { t.action!.onClick(); retire(t.id); }}
                  className="text-xs font-bold uppercase px-2 py-1 rounded bg-white/80 hover:bg-white border border-current/20 ml-2 flex-shrink-0"
                >
                  {t.action.label}
                </button>
              )}
              <button
                onClick={() => retire(t.id)}
                aria-label="Fermer"
                className="text-current/60 hover:text-current text-lg leading-none ml-1 min-w-11 min-h-11 -my-2 -mr-2 flex items-center justify-center"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return { toast: (msg: string) => alert(msg) } as unknown as ToastCtx;
  }
  return ctx;
}

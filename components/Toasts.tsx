"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

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

  const retire = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));

  const toast = useCallback((msg: string, type: ToastType = "info", options?: ToastOptions) => {
    const id = Date.now() + Math.random();
    const duree = options?.duration ?? (options?.action ? 8000 : type === "error" ? 6000 : 3500);
    setToasts((prev) => [...prev, { id, msg, type, action: options?.action }]);
    setTimeout(() => retire(id), duree);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div
        className="fixed top-20 right-4 z-50 space-y-2 max-w-sm pointer-events-none"
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
                className="text-current/60 hover:text-current text-lg leading-none ml-1"
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

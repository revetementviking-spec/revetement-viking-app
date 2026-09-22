"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { envoyer } from "@/lib/envoi";

function LoginForm() {
  const params = useSearchParams();
  // Redirection interne UNIQUEMENT. `redirect` vient de l'URL, donc de n'importe qui :
  // sans ce filtre, un lien /login?redirect=https://faux-viking.example renvoyait
  // l'utilisateur sur un site tiers juste après avoir saisi son mot de passe.
  // On refuse aussi « //ailleurs.com » (URL protocole-relative).
  const brut = params.get("redirect") || "/";
  const redirect = brut.startsWith("/") && !brut.startsWith("//") ? brut : "/";
  // Gabriel est le président et l'usager principal : c'est lui qui doit être pré-choisi.
  const [user, setUser] = useState<"Gabriel" | "Francis">("Gabriel");
  const [password, setPassword] = useState("");
  const [erreur, setErreur] = useState("");
  const [loading, setLoading] = useState(false);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErreur("");
    try {
      // envoyer() : réponse lue même si elle n'est pas du JSON (429 du rate-limit, page
      // HTML de la plateforme) — avant, `r.json()` échouait et le message était vide.
      const r = await envoyer("/api/login", { corps: { user, password } });
      if (r.ok) {
        window.location.href = redirect;
      } else {
        // Sur cette page, un 401 est un mauvais mot de passe, pas une session expirée.
        setErreur(r.data?.error || (r.statut === 401 ? "Mot de passe incorrect" : r.erreur || "Erreur de connexion"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-sm w-full p-8 space-y-5">
        <div className="text-center">
          <img src="/logo-viking.svg" alt="Revêtement Viking" className="h-24 w-24 mx-auto mb-2" />
          <h1 className="text-2xl font-bold text-slate-900">Revêtement Viking</h1>
          <p className="text-sm text-slate-500">Revêtement Viking Inc. · RBQ 5811-4299-01</p>
        </div>
        <form onSubmit={login} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Utilisateur</label>
            <div className="grid grid-cols-2 gap-2">
              {(["Gabriel", "Francis"] as const).map((u) => (
                <button key={u} type="button" onClick={() => setUser(u)} className={`px-3 py-3 rounded-lg font-bold border-2 transition ${user === u ? "bg-emerald-600 text-white border-emerald-700" : "bg-white text-slate-700 border-slate-200 hover:border-emerald-300"}`}>
                  👤 {u}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Mot de passe</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
              autoComplete="current-password"
              name="password"
              className="w-full px-3 py-3 border-2 border-slate-200 focus:border-emerald-500 rounded text-base"
            />
          </div>
          {erreur && <div className="text-sm text-red-600 bg-red-50 p-2 rounded">{erreur}</div>}
          <button type="submit" disabled={loading} className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold disabled:opacity-50">
            {loading ? "Connexion..." : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Chargement...</div>}><LoginForm /></Suspense>;
}

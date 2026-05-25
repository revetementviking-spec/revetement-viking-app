import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 p-6 max-w-md w-full text-center">
        <div className="text-7xl mb-2">🏚️</div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Page introuvable</h1>
        <p className="text-sm text-slate-600 mb-5">
          On dirait que cette adresse n'existe pas — ou plus.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Link href="/" className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold">
            🏠 Tableau de bord
          </Link>
          <Link href="/projets" className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg font-bold">
            🏗️ Mes projets
          </Link>
        </div>
        <p className="text-[10px] text-slate-400 mt-4">Astuce : Ctrl+K pour rechercher</p>
      </div>
    </div>
  );
}

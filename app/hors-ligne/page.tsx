// Page de repli hors ligne, servie par le service worker (public/sw.js) quand une
// navigation échoue sans copie en cache. STATIQUE et SANS DONNÉES : avant, le repli
// était le HTML du tableau de bord (« / »), qui affichait des chiffres périmés comme
// s'ils étaient à jour — ou la page de connexion si c'est elle qui avait été mise en cache.
// Mise en cache à l'installation du service worker.

export const dynamic = "force-static";

export const metadata = { title: "Hors ligne — Revêtement Viking" };

export default function HorsLignePage() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white rounded-xl shadow p-6 text-center space-y-4">
        <div className="text-5xl" aria-hidden="true">📡</div>
        <h1 className="text-2xl font-bold text-slate-900">Hors ligne</h1>
        <p className="text-slate-600">
          Cette page n&apos;est pas disponible sans connexion. Les heures, dépenses et extras
          saisis pendant la coupure sont gardés sur cet appareil et partiront d&apos;eux-mêmes
          au retour du réseau. Les photos, elles, doivent être reprises une fois connecté.
        </p>
        {/* Un vrai <a>, pas <Link> : hors ligne, la navigation client (charge utile RSC)
            échoue ; un rechargement complet repasse par le service worker. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="inline-flex items-center justify-center min-h-11 px-5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
        >
          Réessayer
        </a>
      </div>
    </main>
  );
}

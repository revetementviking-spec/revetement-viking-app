"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import { Suspense } from "react";
import { ecrire, envoyer } from "@/lib/envoi";

function SyncContent() {
  const [drive, setDrive] = useState<any>(null);
  const [driveConfig, setDriveConfig] = useState<any>(null);
  const [asana, setAsana] = useState<any>(null);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const params = useSearchParams();

  const charger = async () => {
    const [d, dc, a] = await Promise.all([
      fetch("/api/drive").then((r) => r.json()).catch(() => ({ ok: false })),
      fetch("/api/drive?action=config").then((r) => r.json()).catch(() => ({})),
      fetch("/api/asana/sync").then((r) => r.json()).catch(() => ({ configure: false })),
    ]);
    setDrive(d);
    setDriveConfig(dc);
    setAsana(a);
  };

  useEffect(() => {
    charger();
    // Feedback callback OAuth
    const driveStatus = params.get("drive");
    if (driveStatus === "connected") toast("✓ Google Drive connecté !", "success");
    if (driveStatus === "error") toast("Erreur Drive : " + (params.get("msg") || "inconnue"), "error");
  }, []);

  const syncAsana = async () => {
    setLoading(true);
    try {
      const res = await envoyer<any>("/api/asana/sync");
      if (!res.ok) { toast("Erreur : " + res.erreur, "error"); return; }
      const d = res.data || {};
      setSyncResult(d);
      toast(`✓ ${d.crees} créés · ${d.majs} MAJ`, "success");
    } finally { setLoading(false); }
  };

  const deconnecterDrive = async () => {
    if (!confirm("Déconnecter Google Drive ? Tu devras réauthoriser après.")) return;
    if (!(await ecrire("/api/drive/auth/disconnect", "POST", undefined, "Enregistrement"))) return;
    toast("Drive déconnecté", "info");
    charger();
  };

  const [resyncBusy, setResyncBusy] = useState(false);
  const resyncDrive = async () => {
    setResyncBusy(true);
    try {
      // envoyer() : `x.json()` sur un 401/500 non-JSON levait et le bouton restait
      // « en cours » sans un mot ; `r.ok` est vérifié au niveau HTTP ET du corps.
      const res = await envoyer<any>("/api/drive/resync");
      if (res.ok) {
        const r = res.data || {};
        const msg = `✓ ${r.synced} resynchronisée(s)${r.ignores ? `, ${r.ignores} nettoyée(s)` : ""}${r.restants ? ` · ${r.restants} encore en échec` : ""}`;
        toast(msg, r.restants ? "warning" : "success");
        if (r.restants && r.dernierErreur) toast("Détail : " + r.dernierErreur, "info");
      } else {
        toast(res.erreur || "Échec de la resynchro", "error");
      }
      charger();
    } finally { setResyncBusy(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="🔄 Synchronisations" soustitre="Google Drive · Asana" />

      <main className="max-w-3xl mx-auto p-4 md:p-6 space-y-4">
        {/* DRIVE */}
        <section className={`rounded-lg shadow p-5 border-2 ${drive?.ok ? "bg-emerald-50 border-emerald-300" : driveConfig?.oauth_client_configure ? "bg-blue-50 border-blue-300" : "bg-amber-50 border-amber-300"}`}>
          <h2 className="font-bold text-lg mb-2 flex items-center gap-2">
            <span>📁 Google Drive</span>
            {drive?.ok && <span className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded">Connecté ({drive.mode === "oauth_user" ? "OAuth user" : "Service Account"})</span>}
          </h2>

          {drive?.ok ? (
            <div className="text-sm text-emerald-900 space-y-2">
              <div>✅ Dossier : <strong>{drive.folder}</strong></div>
              {drive.email && <div>📧 Compte : <code className="text-xs bg-white px-2 py-0.5 rounded">{drive.email}</code></div>}
              <p className="text-xs text-slate-700">Chaque photo ajoutée dans l'app est automatiquement copiée dans Drive. Sous-dossier par projet créé auto.</p>
              {drive.erreurs_photos > 0 && (
                <div className="bg-red-50 border border-red-300 rounded p-2 text-xs text-red-800 space-y-2">
                  <div>⚠️ {drive.erreurs_photos} photo(s) n'ont pas pu être synchronisées dans Drive.</div>
                  <button onClick={resyncDrive} disabled={resyncBusy} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded font-bold">
                    {resyncBusy ? "⏳ Resynchronisation…" : "🔄 Réessayer la synchro Drive"}
                  </button>
                </div>
              )}
              <BackupBouton />
              {drive.mode === "oauth_user" && (
                <button onClick={deconnecterDrive} className="text-xs text-red-600 hover:underline">Déconnecter Drive</button>
              )}
            </div>
          ) : driveConfig?.oauth_client_configure ? (
            <div className="text-sm text-blue-900 space-y-3">
              <p className="font-semibold">✅ OAuth Client configuré — clique pour connecter ton Drive personnel :</p>
              <a href="/api/drive/auth/start" className="block w-full px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-center">
                🔗 Connecter Google Drive
              </a>
              <p className="text-xs">Tu seras redirigé vers Google pour autoriser l'app à uploader dans le dossier "Viking". Utilise tes 15 GB Drive personnels.</p>
            </div>
          ) : (
            <div className="text-sm text-amber-900 space-y-2">
              <p>⚠️ OAuth Client non configuré dans Vercel</p>
              <details className="text-xs">
                <summary className="cursor-pointer font-bold">Configuration OAuth (10 min)</summary>
                <ol className="list-decimal list-inside mt-2 space-y-1 ml-2">
                  <li>Google Cloud Console → projet "Revetement Viking App" → APIs et services → Identifiants</li>
                  <li>+ Créer des identifiants → ID client OAuth → Type : Application Web</li>
                  <li>Nom : Revetement Viking App</li>
                  <li>URI de redirection autorisée : <code className="bg-amber-100 px-1">https://app.revetementviking.com/api/drive/auth/callback</code></li>
                  <li>Créer → copie Client ID et Client Secret</li>
                  <li>Vercel env vars : ajouter <code>GOOGLE_OAUTH_CLIENT_ID</code> et <code>GOOGLE_OAUTH_CLIENT_SECRET</code></li>
                  <li>Redeploy → recharger cette page → cliquer "Connecter Drive"</li>
                </ol>
              </details>
            </div>
          )}
        </section>

        {/* ASANA */}
        <section className={`rounded-lg shadow p-5 border-2 ${asana?.configure ? "bg-emerald-50 border-emerald-300" : "bg-amber-50 border-amber-300"}`}>
          <h2 className="font-bold text-lg mb-2 flex items-center gap-2">
            <span>📋 Asana</span>
            {asana?.configure && <span className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded">Connecté</span>}
          </h2>
          {asana?.configure ? (
            <div className="text-sm text-emerald-900 space-y-2">
              <p>✅ ASANA_PAT configuré</p>
              <button onClick={syncAsana} disabled={loading} className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold disabled:opacity-50">
                {loading ? "⏳ Synchronisation..." : "🔄 Pull Asana → CRM"}
              </button>
              {syncResult?.ok && (
                <div className="bg-white rounded p-2 text-xs">
                  Total : <strong>{syncResult.total_taches_asana}</strong> · Créés : <strong>{syncResult.crees}</strong> · MAJ : <strong>{syncResult.majs}</strong>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-amber-900 space-y-2">
              <p>⚠️ ASANA_PAT non configuré dans Vercel</p>
              <ol className="list-decimal list-inside text-xs space-y-1 ml-2">
                <li><a href="https://app.asana.com/0/my-apps" target="_blank" rel="noreferrer" className="underline font-bold">app.asana.com/0/my-apps</a> → + Create new token → copie</li>
                <li>Vercel env vars : ajouter <code>ASANA_PAT</code> + Redeploy</li>
              </ol>
            </div>
          )}
        </section>

        {/* Statut tableau */}
        <section className="bg-white rounded-lg shadow p-5">
          <h3 className="font-bold mb-3">📊 État des sauvegardes auto</h3>
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr><th className="p-2 text-left">Données</th><th className="p-2 text-center">DB Turso</th><th className="p-2 text-center">Drive</th><th className="p-2 text-center">Asana</th></tr>
            </thead>
            <tbody>
              <tr className="border-t"><td className="p-2">📸 Photos chantier</td><td className="p-2 text-center">✅</td><td className="p-2 text-center">{drive?.ok ? "✅ Auto" : "—"}</td><td className="p-2 text-center">—</td></tr>
              <tr className="border-t"><td className="p-2">💸 Dépenses (reçus)</td><td className="p-2 text-center">✅</td><td className="p-2 text-center">{drive?.ok ? "🚧 À venir" : "—"}</td><td className="p-2 text-center">—</td></tr>
              <tr className="border-t"><td className="p-2">📝 Contrats PDF</td><td className="p-2 text-center">✅</td><td className="p-2 text-center">{drive?.ok ? "🚧 À venir" : "—"}</td><td className="p-2 text-center">—</td></tr>
              <tr className="border-t"><td className="p-2">👥 Clients / CRM</td><td className="p-2 text-center">✅</td><td className="p-2 text-center">—</td><td className="p-2 text-center">{asana?.configure ? "✅ Bi-directionnel" : "—"}</td></tr>
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

function BackupBouton() {
  const [loading, setLoading] = useState(false);
  const [dernier, setDernier] = useState<{ nom: string; counts: any } | null>(null);
  const [historique, setHistorique] = useState<any>(null);
  const { toast } = useToast();

  const chargerHistorique = () => {
    fetch("/api/backup/liste", { cache: "no-store" }).then((r) => r.json()).then(setHistorique).catch(() => {});
  };
  useEffect(() => { chargerHistorique(); }, []);

  const lancer = async () => {
    setLoading(true);
    try {
      const res = await envoyer<any>("/api/backup");
      const d = res.ok ? res.data || {} : { error: res.erreur };
      if (res.ok) {
        setDernier({ nom: d.nom, counts: d.tailles });
        toast(`✓ Backup créé : ${d.nom}`, "success");
        chargerHistorique();
      } else {
        toast("Erreur backup : " + (d.error || "inconnue"), "error");
      }
    } finally { setLoading(false); }
  };

  // Couleur selon fraîcheur du dernier backup auto
  const couleurEtat = historique?.etat === "frais" ? "bg-emerald-100 text-emerald-900 border-emerald-300"
    : historique?.etat === "vieux" ? "bg-amber-100 text-amber-900 border-amber-300"
    : historique?.etat === "tres_vieux" ? "bg-red-100 text-red-900 border-red-300"
    : "bg-slate-100 text-slate-700 border-slate-300";
  const labelEtat = historique?.etat === "frais" ? "✅ Autobackup à jour"
    : historique?.etat === "vieux" ? "⚠️ Autobackup en retard"
    : historique?.etat === "tres_vieux" ? "🔴 Autobackup ne tourne plus !"
    : "❓ Aucun backup encore créé";

  return (
    <div className="bg-white rounded p-3 border border-emerald-200 space-y-3">
      {/* Statut autobackup */}
      {historique?.ok && (
        <div className={`rounded p-2 border ${couleurEtat}`}>
          <div className="font-bold text-sm">{labelEtat}</div>
          <div className="text-xs mt-1">
            {historique.total > 0 ? (
              <>
                <strong>{historique.total}</strong> backup(s) dans Drive · Dernier : <strong>{historique.dernier?.nom}</strong>
                {historique.heures_depuis_dernier !== null && (
                  <> · il y a <strong>{historique.heures_depuis_dernier} h</strong></>
                )}
              </>
            ) : (
              <>Aucun fichier backup-*.json trouvé dans Drive/Viking/Backups. Lance un backup manuel ci-dessous.</>
            )}
          </div>
          <div className="text-[10px] text-slate-600 mt-1">⏰ Cron Vercel programmé tous les jours à <strong>8h UTC</strong> (4h du matin heure Montréal)</div>
        </div>
      )}

      <button onClick={lancer} disabled={loading} className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-semibold disabled:opacity-50">
        {loading ? "⏳ Backup en cours..." : "💾 Lancer un backup maintenant"}
      </button>
      {dernier && (
        <div className="text-xs text-slate-600">
          ✓ <code className="bg-slate-100 px-1 rounded">{dernier.nom}</code> · {dernier.counts.soumissions} soum · {dernier.counts.projets} projets · {dernier.counts.clients} clients
        </div>
      )}

      {/* Historique des 5 derniers backups */}
      {historique?.backups?.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-bold text-slate-700">📜 Historique ({historique.total} backup(s))</summary>
          <ul className="mt-2 space-y-1">
            {historique.backups.slice(0, 10).map((b: any) => (
              <li key={b.id} className="flex justify-between items-center bg-slate-50 rounded px-2 py-1">
                <span className="font-mono">{b.nom}</span>
                <span className="flex gap-2 items-center text-slate-500">
                  <span>{b.taille_ko ? `${b.taille_ko} Ko` : ""}</span>
                  <span>{b.date ? new Date(b.date).toLocaleString("fr-CA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                  {b.lien && <a href={b.lien} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">↗ Drive</a>}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function SyncPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-slate-500">Chargement...</div>}>
      <SyncContent />
    </Suspense>
  );
}

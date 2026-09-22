"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import ZoneDepot from "@/components/ZoneDepot";
import { envoyer } from "@/lib/envoi";

// Enveloppe minimale exigée par /api/restore pour juger un fichier valide : chaque envoi
// partiel la fournit vide, seule la table du morceau porte des données.
const ENVELOPPE_VIDE = {
  soumissions: [], clients: [], projets: [], employes: [], heures: [],
  depenses: [], contrats: [], paies: [], biblio: [],
};
// Champs exigés pour juger une sauvegarde valide (ceux de la v1 : les fichiers plus
// anciens doivent rester restaurables). Miroir de CHAMPS_REQUIS de /api/restore.
const CHAMPS_REQUIS = Object.keys(ENVELOPPE_VIDE);

function ValiderBackup() {
  const [texteBackup, setTexteBackup] = useState<string | null>(null);
  const [resultat, setResultat] = useState<any>(null);
  const [chargement, setChargement] = useState(false);
  const [progression, setProgression] = useState("");
  const [restaure, setRestaure] = useState(false);

  const traiterFichier = async (file?: File) => {
    if (!file) return;
    setChargement(true);
    setRestaure(false);
    try {
      const txt = await file.text();
      setTexteBackup(txt);
      // VALIDATION DANS LE NAVIGATEUR, sans envoyer le fichier : une vraie sauvegarde
      // dépasse la limite de taille d'une requête (~4,5 Mo) — la valider côté serveur
      // renvoyait un 413 non-JSON, et le bouton « Restaurer réellement » n'apparaissait
      // JAMAIS. La restauration elle-même part ensuite table par table.
      const dump = JSON.parse(txt);
      const erreurs: string[] = [];
      const compte: Record<string, number> = {};
      for (const c of CHAMPS_REQUIS) {
        if (!Array.isArray(dump[c])) erreurs.push(`Champ manquant ou non-array : ${c}`);
        else compte[c] = dump[c].length;
      }
      for (const k of Object.keys(dump)) {
        if (!CHAMPS_REQUIS.includes(k) && Array.isArray(dump[k]) && dump[k].length) compte[k] = dump[k].length;
      }
      const total = Object.values(compte).reduce((s, n) => s + n, 0);
      const mo = (txt.length / 1024 / 1024).toFixed(1);
      setResultat({
        ok: erreurs.length === 0,
        mode: "validation-seulement",
        meta: { date_backup: dump.date_backup || "—", version: dump.version || 0 },
        compte, total, erreurs,
        message: erreurs.length
          ? `⚠ Structure incomplète — ${erreurs.length} erreur(s).`
          : `✓ Sauvegarde valide — ${total} enregistrements sur ${Object.keys(compte).length} tables (${mo} Mo).`,
      });
    } catch (err: any) {
      setResultat({ ok: false, error: `Fichier illisible : ${err.message}` });
    } finally { setChargement(false); }
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => traiterFichier(e.target.files?.[0]);

  const restaurerReellement = async () => {
    if (!texteBackup || chargement) return;
    const n = resultat?.total ?? "?";
    if (!window.confirm(`Restaurer réellement ce backup (${n} enregistrements) ? Aucune donnée existante ne sera modifiée ou supprimée — seules les lignes manquantes seront ajoutées.`)) return;
    setChargement(true);
    try {
      const dump = JSON.parse(texteBackup);
      // Restauration UNE TABLE À LA FOIS : l'hébergeur plafonne la taille d'une requête
      // (~4,5 Mo), donc envoyer le fichier entier échouait sur une vraie sauvegarde. Chaque
      // table part dans sa propre requête ; la restauration étant additive et rejouable,
      // un découpage ne change rien au résultat.
      const champs = Object.keys(dump).filter((k) => Array.isArray(dump[k]) && dump[k].length > 0);
      const cumul: any = {};
      const echecs: string[] = [];
      // …ET par PAQUETS à l'intérieur d'une table : `contrats_signes` embarque les PDF
      // signés en base64, donc une seule table peut à elle seule dépasser la limite.
      const MAX_PAQUET = 2_500_000; // ~2,5 Mo de JSON par envoi, sous le plafond de ~4,5 Mo
      const enPaquets = (lignes: any[]): any[][] => {
        const paquets: any[][] = []; let cur: any[] = []; let taille = 0;
        for (const l of lignes) {
          const t = JSON.stringify(l).length;
          // Une ligne seule trop grosse part quand même : le serveur tranchera.
          if (cur.length && taille + t > MAX_PAQUET) { paquets.push(cur); cur = []; taille = 0; }
          cur.push(l); taille += t;
        }
        if (cur.length) paquets.push(cur);
        return paquets;
      };
      for (const champ of champs) {
        const paquets = enPaquets(dump[champ]);
        let inseres = 0, ignores = 0, total = 0, erreur: string | undefined;
        for (let i = 0; i < paquets.length; i++) {
          setProgression(paquets.length > 1 ? `${champ} (${i + 1}/${paquets.length})…` : `${champ}…`);
          const morceau: any = { ...ENVELOPPE_VIDE, confirmer: true, [champ]: paquets[i] };
          // envoyer() : ne lève jamais (réseau coupé = message lisible), lit la réponse
          // même si elle n'est pas du JSON (413 sur un paquet trop gros).
          const r = await envoyer<any>("/api/restore", { corps: morceau });
          if (!r.ok) { erreur = r.erreur || "erreur"; break; }
          const res = r.data?.resultat?.[champ];
          if (res) { inseres += res.inseres || 0; ignores += res.ignores || 0; total += res.total || 0; }
        }
        cumul[champ] = { inseres, ignores, total, ...(erreur ? { erreur } : {}) };
        if (erreur) echecs.push(`${champ} : ${erreur}`);
      }
      const inseres = Object.values(cumul).reduce((s: number, v: any) => s + (v?.inseres || 0), 0);
      setResultat({
        ok: echecs.length === 0,
        mode: "restauration",
        meta: { date_backup: dump.date_backup, version: dump.version },
        resultat: cumul,
        message: echecs.length
          ? `⚠ Restauration partielle — ${inseres} ligne(s) insérée(s). Échecs : ${echecs.join(" · ")}`
          : `✓ Restauration terminée — ${inseres} nouvelle(s) ligne(s) insérée(s). Aucune donnée existante n'a été modifiée ou supprimée.`,
      });
      setRestaure(true);
    } catch (err: any) { setResultat({ ok: false, error: err.message }); }
    finally { setChargement(false); setProgression(""); }
  };

  return (
    <div className="text-sm">
      <p className="text-slate-700 mb-2">Vérifier la validité d'un fichier de backup (.json) avant restauration éventuelle — clic ou glisse-dépose :</p>
      <ZoneDepot onFichiers={(files) => traiterFichier(files[0])} accept="application/json,.json" multiple={false} messageSurvol="📂 Dépose le fichier de backup" className="inline-block">
        <input type="file" accept="application/json,.json" onChange={onFile} className="text-xs border rounded p-1.5" />
      </ZoneDepot>
      {chargement && <div className="text-slate-500 mt-2 text-xs">⏳ {progression ? `Restauration — ${progression}` : "Analyse…"}</div>}
      {resultat && (
        <div className={`mt-2 p-3 rounded text-xs ${resultat.ok ? "bg-emerald-50 border border-emerald-300 text-emerald-900" : "bg-red-50 border border-red-300 text-red-900"}`}>
          <div className="font-bold mb-1">{resultat.message || resultat.error}</div>
          {resultat.meta && <div className="text-[10px]">Date backup : {resultat.meta.date_backup} · v{resultat.meta.version}</div>}
          {resultat.compte && (
            <ul className="text-[10px] mt-1 grid grid-cols-3 gap-x-2">
              {Object.entries(resultat.compte).map(([k, v]: any) => <li key={k}>{k}: <strong>{v as number}</strong></li>)}
            </ul>
          )}
          {resultat.resultat && (
            <ul className="text-[10px] mt-1 grid grid-cols-3 gap-x-2">
              {Object.entries(resultat.resultat).map(([k, v]: any) => (
                <li key={k}>{k}: <strong className="text-emerald-700">+{v.inseres}</strong> · {v.ignores} déjà présent(s){v.erreur ? <span className="text-red-700"> · erreur</span> : ""}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {resultat?.mode === "validation-seulement" && resultat.ok && !restaure && (
        <button onClick={restaurerReellement} disabled={chargement} className="mt-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded text-xs font-bold">
          ⚠️ Restaurer réellement
        </button>
      )}
      <p className="text-[10px] text-slate-500 mt-2">📋 Restauration additive et idempotente : seules les lignes manquantes (id absent en base) sont ajoutées, rien n'est jamais écrasé ni supprimé.</p>
    </div>
  );
}

export default function Diagnostic() {
  const [drive, setDrive] = useState<any>(null);
  const [notifs, setNotifs] = useState<any>(null);
  const [erreurs, setErreurs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [d, n, e] = await Promise.all([
          fetch("/api/drive").then((r) => r.json()).catch(() => ({})),
          fetch("/api/notifications").then((r) => r.json()).catch(() => ({})),
          fetch("/api/log-erreur").then((r) => r.json()).catch(() => []),
        ]);
        setDrive(d); setNotifs(n); setErreurs(e);
      } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="🛠️ Diagnostic" soustitre="État système · debug" />
      <main className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">

        {loading && <div className="text-center text-slate-500 py-8">Chargement...</div>}

        {!loading && (
          <>
            {/* ÉTAT DES SERVICES */}
            <section className="bg-white rounded-lg shadow p-5">
              <h2 className="font-bold mb-3">🔌 Services</h2>
              <ul className="text-sm space-y-2">
                <li className="flex justify-between border-b pb-2">
                  <span>Google Drive</span>
                  <span className={drive?.ok ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>
                    {drive?.ok ? `✓ ${drive.mode} · ${drive.folder}` : `❌ ${drive?.message || "déconnecté"}`}
                  </span>
                </li>
                <li className="flex justify-between border-b pb-2">
                  <span>Photos en erreur Drive</span>
                  <span className={(drive?.erreurs_photos || 0) > 0 ? "text-amber-600 font-bold" : "text-emerald-600"}>
                    {drive?.erreurs_photos || 0}
                  </span>
                </li>
                <li className="flex justify-between border-b pb-2">
                  <span>Relances à faire</span>
                  <span className={notifs?.relances > 0 ? "text-amber-600 font-bold" : "text-slate-600"}>{notifs?.relances || 0}</span>
                </li>
                <li className="flex justify-between border-b pb-2">
                  <span>Tâches CRM ouvertes</span>
                  <span className="text-slate-700">{notifs?.taches_ouvertes || 0}</span>
                </li>
                <li className="flex justify-between">
                  <span>Erreurs client (boundary)</span>
                  <span className={erreurs.length > 0 ? "text-amber-600 font-bold" : "text-emerald-600"}>{erreurs.length}</span>
                </li>
              </ul>
            </section>

            {/* ERREURS RÉCENTES */}
            {erreurs.length > 0 && (
              <section className="bg-white rounded-lg shadow p-5">
                <h2 className="font-bold mb-3">⚠️ 50 dernières erreurs client</h2>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {erreurs.map((e: any) => (
                    <div key={e.id} className="border-l-4 border-red-400 bg-red-50 p-2 text-xs">
                      <div className="font-semibold">{e.message?.slice(0, 120)}</div>
                      <div className="text-slate-600 mt-0.5">{e.path} · {new Date(e.date).toLocaleString("fr-CA")}</div>
                      {e.digest && <code className="text-[10px] text-slate-500">#{e.digest}</code>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* INFOS BUILD */}
            <section className="bg-white rounded-lg shadow p-5">
              <h2 className="font-bold mb-3">📦 Build</h2>
              <ul className="text-xs space-y-1 font-mono">
                <li>User-Agent: <span className="text-slate-600">{typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : "n/a"}</span></li>
                <li>Online: <span className="text-slate-600">{typeof navigator !== "undefined" && navigator.onLine ? "✓" : "✗"}</span></li>
                <li>Cookies activés: <span className="text-slate-600">{typeof navigator !== "undefined" && navigator.cookieEnabled ? "✓" : "✗"}</span></li>
                <li>Service Worker: <span className="text-slate-600">{typeof navigator !== "undefined" && "serviceWorker" in navigator ? "supporté" : "non"}</span></li>
              </ul>
            </section>

            {/* OUTILS */}
            <section className="bg-white rounded-lg shadow p-5">
              <h2 className="font-bold mb-3">🧰 Outils</h2>
              <ValiderBackup />
            </section>

            <div className="text-center">
              <button onClick={() => location.reload()} className="text-sm text-blue-600 hover:underline">🔄 Rafraîchir</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

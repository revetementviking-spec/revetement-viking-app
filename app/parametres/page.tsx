"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import { compresserImage, genererVignette } from "@/lib/img";

export default function ParametresPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [profil, setProfil] = useState<any>(null);
  const [chargement, setChargement] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/profil").then((r) => r.ok ? r.json() : null).then((p) => { setProfil(p || { username: "" }); setChargement(false); });
  }, []);

  const sauver = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/auth/profil", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profil) });
      if ((await r.json()).ok) toast("✓ Profil mis à jour", "success");
      else toast("Erreur de sauvegarde", "error");
    } finally { setBusy(false); }
  };

  const choisirPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast("Image seulement", "warning"); return; }
    if (f.size > 8 * 1024 * 1024) { toast("Image > 8 MB", "warning"); return; }
    try {
      // Vignette ~400px pour l'avatar (léger)
      const vignette = await genererVignette(f, 400, 0.8);
      setProfil({ ...profil, photo_data: vignette || (await compresserImage(f)), photo_type: "image/jpeg" });
    } catch (err: any) {
      toast("Erreur image : " + (err?.message || ""), "error");
    }
  };

  const deconnexion = async () => {
    if (!confirm("Te déconnecter de l'application ?")) return;
    await fetch("/api/login", { method: "DELETE" });
    router.replace("/login");
  };

  if (chargement) return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="⚙️ Paramètres" />
      <main className="max-w-2xl mx-auto p-4 text-center text-slate-500">Chargement…</main>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="⚙️ Paramètres" soustitre={profil?.username ? `Connecté en tant que ${profil.username}` : ""} />
      <main className="max-w-2xl mx-auto p-4 md:p-6 space-y-4">

        {/* Profil */}
        <section className="bg-white rounded-lg shadow p-5 space-y-4">
          <h2 className="font-bold text-lg">👤 Mon profil</h2>

          <div className="flex items-center gap-4">
            <div className="relative">
              {profil.photo_data ? (
                <img src={profil.photo_data} alt="Photo de profil" className="w-20 h-20 rounded-full object-cover border-2 border-emerald-200" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white text-2xl font-bold border-2 border-emerald-200">
                  {(profil.nom_affichage || profil.username || "?").trim()[0]}
                </div>
              )}
            </div>
            <div className="flex-1">
              <label className="cursor-pointer inline-block bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-xs font-bold">
                📷 Changer la photo
                <input type="file" accept="image/*" capture="user" className="hidden" onChange={choisirPhoto} />
              </label>
              {profil.photo_data && (
                <button onClick={() => setProfil({ ...profil, photo_data: null, photo_type: null })} className="ml-2 text-xs text-red-600 hover:underline">Retirer</button>
              )}
            </div>
          </div>

          <Field label="Utilisateur (login)" value={profil.username || ""} readOnly />
          <Field label="Nom d'affichage" value={profil.nom_affichage || ""} onChange={(v) => setProfil({ ...profil, nom_affichage: v })} placeholder="Ex: Francis Quinchon" />
          <Field label="Rôle" value={profil.role || ""} onChange={(v) => setProfil({ ...profil, role: v })} placeholder="Ex: Co-propriétaire" />
          <Field label="Courriel" value={profil.courriel || ""} onChange={(v) => setProfil({ ...profil, courriel: v })} placeholder="ex: revetementviking@gmail.com" />
          <Field label="Téléphone" value={profil.telephone || ""} onChange={(v) => setProfil({ ...profil, telephone: v })} placeholder="(438) 493-2041" />

          <button onClick={sauver} disabled={busy} className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-bold">
            {busy ? "Enregistrement…" : "💾 Enregistrer le profil"}
          </button>
        </section>

        {/* Mot de passe */}
        <section className="bg-white rounded-lg shadow p-5 space-y-2">
          <h2 className="font-bold text-lg">🔐 Mot de passe</h2>
          <p className="text-sm text-slate-600">
            Le mot de passe est stocké comme variable d'environnement Vercel pour des raisons de sécurité (pas modifiable directement depuis l'app).
            Pour le changer, va dans Vercel → <strong>revetement-viking-app</strong> → Settings → Environment Variables, et édite <code className="bg-slate-100 px-1 rounded">{profil.username === "Francis" ? "FRANCIS_PASSWORD" : "GABRIEL_PASSWORD"}</code> (ou <code className="bg-slate-100 px-1 rounded">APP_PASSWORD</code> si pas défini), puis redéploie.
          </p>
          <a href="https://vercel.com/revetementviking-specs-projects/revetement-viking-app/settings/environment-variables" target="_blank" rel="noreferrer" className="inline-block text-sm text-emerald-700 hover:underline">→ Ouvrir Vercel</a>
        </section>

        {/* Communications */}
        <section className="bg-white rounded-lg shadow p-5 space-y-1">
          <h2 className="font-bold text-lg">📧 Courriels sortants</h2>
          <p className="text-sm text-slate-600">Toutes les communications envoyées par l'app partent du compte <strong>revetementviking@gmail.com</strong> (variable Vercel <code className="bg-slate-100 px-1 rounded">GMAIL_USER</code>).</p>
        </section>

        {/* Notifications push */}
        <PushSection />

        {/* Mode maintenance */}
        <MaintenanceSection />

        {/* Déconnexion */}
        <section className="bg-white rounded-lg shadow p-5">
          <button onClick={deconnexion} className="w-full px-4 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold">
            🚪 Se déconnecter
          </button>
        </section>
      </main>
    </div>
  );
}

function MaintenanceSection() {
  const [actif, setActif] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/maintenance").then((r) => (r.ok ? r.json() : null)).then((d) => setActif(!!d?.actif)).catch(() => setActif(false));
  }, []);

  const basculer = async (valeur: boolean) => {
    setBusy(true);
    try {
      const r = await fetch("/api/maintenance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actif: valeur }) });
      if ((await r.json()).ok) {
        setActif(valeur);
        toast(valeur ? "🛠️ Mode maintenance ACTIVÉ — les autres voient une page d'attente, toi tu continues." : "✅ Mode maintenance désactivé — l'app est de nouveau accessible à tous.", valeur ? "warning" : "success");
      } else toast("Erreur", "error");
    } finally { setBusy(false); }
  };

  return (
    <section className={`bg-white rounded-lg shadow p-5 space-y-3 border-l-4 ${actif ? "border-amber-500" : "border-slate-200"}`}>
      <h2 className="font-bold text-lg">🛠️ Mode maintenance</h2>
      <p className="text-sm text-slate-600">
        Quand tu fais des modifications, active ce mode : tout le monde voit une page
        « mise à jour en cours », sauf <strong>ton navigateur</strong> qui continue à
        fonctionner normalement. Désactive-le quand tu as terminé.
      </p>
      {actif === null ? (
        <p className="text-sm text-slate-400">Chargement…</p>
      ) : actif ? (
        <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded p-3">
          <span className="text-sm font-bold text-amber-900">🔴 Maintenance ACTIVE</span>
          <button onClick={() => basculer(false)} disabled={busy} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-bold text-sm">
            {busy ? "…" : "Désactiver"}
          </button>
        </div>
      ) : (
        <button onClick={() => basculer(true)} disabled={busy} className="w-full px-4 py-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white rounded-lg font-bold">
          {busy ? "…" : "🛠️ Activer le mode maintenance"}
        </button>
      )}
    </section>
  );
}

function PushSection() {
  const [supporte, setSupporte] = useState(false);
  const [actif, setActif] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupporte(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => setActif(!!sub)).catch(() => {});
  }, []);

  const urlBase64ToUint8Array = (b64: string) => {
    const padding = "=".repeat((4 - (b64.length % 4)) % 4);
    const base64 = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };

  const activer = async () => {
    if (!supporte) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") { toast("Permission refusée", "warning"); return; }
      const { publicKey } = await fetch("/api/push/subscribe").then((r) => r.json());
      if (!publicKey) { toast("Push pas configuré côté serveur (VAPID_PUBLIC_KEY manquant)", "warning"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
      if ((await r.json()).ok) { setActif(true); toast("🔔 Notifications activées sur cet appareil", "success"); }
      else toast("Échec activation", "error");
    } catch (e: any) {
      toast("Erreur : " + (e?.message || ""), "error");
    } finally { setBusy(false); }
  };

  const desactiver = async () => {
    if (!supporte) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setActif(false);
      toast("Notifications désactivées sur cet appareil", "info");
    } finally { setBusy(false); }
  };

  const tester = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/push/test", { method: "POST" });
      const d = await r.json();
      if (d.ok && d.envoyes > 0) toast(`✅ Notification envoyée (${d.envoyes} appareil)`, "success");
      else if (d.raison === "push_non_configure") toast("Push non configuré côté serveur", "warning");
      else toast("Aucun appareil abonné", "warning");
    } finally { setBusy(false); }
  };

  return (
    <section className="bg-white rounded-lg shadow p-5 space-y-3">
      <h2 className="font-bold text-lg">🔔 Notifications push</h2>
      {!supporte ? (
        <p className="text-sm text-slate-600">Ton navigateur ne supporte pas les notifications push. Sur iOS, ouvre l'app depuis l'écran d'accueil (PWA installée).</p>
      ) : (
        <>
          <p className="text-sm text-slate-600">Reçois les @mentions et les relances dues directement sur ton téléphone, même quand l'app est fermée.</p>
          <div className="text-xs text-slate-500">
            État : {actif ? <strong className="text-emerald-700">✓ activé sur cet appareil</strong> : <strong className="text-slate-500">Désactivé</strong>}
            {permission === "denied" && <span className="text-red-600 ml-2">· permission bloquée dans les réglages du navigateur</span>}
          </div>
          <div className="flex gap-2 flex-wrap">
            {!actif ? (
              <button onClick={activer} disabled={busy || permission === "denied"} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-bold text-sm">🔔 Activer les notifications</button>
            ) : (
              <>
                <button onClick={tester} disabled={busy} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded font-bold text-sm">🧪 Envoyer un test</button>
                <button onClick={desactiver} disabled={busy} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 rounded text-sm">Désactiver</button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Field({ label, value, onChange, placeholder, readOnly }: { label: string; value: string; onChange?: (v: string) => void; placeholder?: string; readOnly?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full px-3 py-2 border rounded text-sm ${readOnly ? "bg-slate-50 text-slate-500" : ""}`}
      />
    </div>
  );
}

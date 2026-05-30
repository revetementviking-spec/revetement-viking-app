"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";

export default function CamerasPage() {
  const [cams, setCams] = useState<any[]>([]);
  const [creerOuvert, setCreerOuvert] = useState(false);
  const [form, setForm] = useState({ nom: "", emplacement: "Shop", url_embed: "", type: "iframe" });
  const [editId, setEditId] = useState<number | null>(null);
  const [pleinEcran, setPleinEcran] = useState<any>(null);
  const { toast } = useToast();

  const charger = () => fetch("/api/cameras", { cache: "no-store" }).then((r) => r.json()).then((d) => setCams(Array.isArray(d) ? d : []));
  useEffect(() => { charger(); }, []);

  const sauvegarder = async () => {
    if (!form.nom.trim()) { toast("Nom requis", "warning"); return; }
    const body: any = { ...form };
    if (editId) body.id = editId;
    const r = await fetch("/api/cameras", { method: editId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) { toast(editId ? "Modifiée" : "Caméra ajoutée", "success"); setCreerOuvert(false); setEditId(null); setForm({ nom: "", emplacement: "Shop", url_embed: "", type: "iframe" }); charger(); }
  };

  const supprimer = async (c: any) => {
    if (!confirm(`Supprimer la caméra "${c.nom}" ?`)) return;
    await fetch(`/api/cameras?id=${c.id}`, { method: "DELETE" });
    charger();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📹 Caméras" soustitre={`${cams.length} caméra(s)`} />
      <main className="max-w-7xl mx-auto p-3 md:p-4 space-y-3">
        <div className="flex justify-between items-center">
          <p className="text-sm text-slate-600">Feed live des caméras de sécurité (shop, chantiers, entrepôts)</p>
          <button onClick={() => { setEditId(null); setForm({ nom: "", emplacement: "Shop", url_embed: "", type: "iframe" }); setCreerOuvert(true); }} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold">➕ Ajouter une caméra</button>
        </div>

        {cams.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="text-5xl mb-3">📹</div>
            <p className="text-slate-600 mb-2">Aucune caméra configurée.</p>
            <p className="text-xs text-slate-500">Pour ajouter une caméra : récupère son URL d'embed (RTSP HTTP/HTTPS, YouTube live, ou interface web du DVR) et colle-la ici.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {cams.map((cam) => (
              <div key={cam.id} className="bg-white rounded-lg shadow overflow-hidden">
                <div className="bg-slate-900 aspect-video relative cursor-pointer" onClick={() => setPleinEcran(cam)}>
                  {cam.url_embed ? (
                    cam.type === "img" ? (
                      <img src={cam.url_embed} alt={cam.nom} className="w-full h-full object-cover" data-no-invert />
                    ) : (
                      <iframe src={cam.url_embed} className="w-full h-full" allow="autoplay; fullscreen" data-no-invert title={cam.nom} />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400">⚠️ URL manquante</div>
                  )}
                  <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold animate-pulse">🔴 LIVE</div>
                  <div className="absolute bottom-2 left-2 right-2 bg-black/60 text-white text-xs p-1.5 rounded flex justify-between items-center">
                    <span>📍 {cam.emplacement || "—"}</span>
                    <span className="text-[10px]">Cliquer pour agrandir</span>
                  </div>
                </div>
                <div className="p-2 flex justify-between items-center">
                  <span className="font-bold text-sm">{cam.nom}</span>
                  <div className="flex gap-1">
                    <button onClick={(e) => { e.stopPropagation(); setEditId(cam.id); setForm({ nom: cam.nom, emplacement: cam.emplacement || "", url_embed: cam.url_embed || "", type: cam.type || "iframe" }); setCreerOuvert(true); }} className="text-xs px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded">✏️</button>
                    <button onClick={(e) => { e.stopPropagation(); supprimer(cam); }} className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded">🗑</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs text-blue-900">
          <p className="font-bold mb-1">💡 Comment obtenir l'URL d'une caméra :</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><strong>Reolink/Hikvision/Dahua</strong> : interface web du NVR → snapshot ou stream MJPEG/HLS</li>
            <li><strong>Caméra IP avec MJPEG</strong> : <code className="bg-white px-1 rounded">http://IP:port/mjpeg.cgi</code> (type "img" pour auto-refresh)</li>
            <li><strong>YouTube Live</strong> : utiliser l'URL d'embed YouTube (type "iframe")</li>
            <li><strong>Ring/Nest</strong> : exiger un service tiers (RTSP-to-HLS) — me demander pour brancher</li>
          </ul>
        </div>
      </main>

      {/* Modal création / édition */}
      {creerOuvert && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setCreerOuvert(false)}>
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{editId ? "✏️ Modifier" : "➕ Nouvelle caméra"}</h3>
            <In label="Nom *" v={form.nom} o={(v) => setForm({ ...form, nom: v })} />
            <In label="Emplacement" v={form.emplacement} o={(v) => setForm({ ...form, emplacement: v })} />
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                <option value="iframe">iframe (URL web / HLS player / YouTube)</option>
                <option value="img">img MJPEG (auto-refresh)</option>
              </select>
            </div>
            <In label="URL d'embed *" v={form.url_embed} o={(v) => setForm({ ...form, url_embed: v })} />
            <div className="flex gap-2 justify-end pt-2">
              <button onClick={() => setCreerOuvert(false)} className="px-4 py-2 bg-slate-200 rounded text-sm">Annuler</button>
              <button onClick={sauvegarder} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">{editId ? "Sauver" : "Ajouter"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Vue plein écran d'une caméra */}
      {pleinEcran && (
        <div className="fixed inset-0 bg-black z-50 flex items-center justify-center" onClick={() => setPleinEcran(null)}>
          <button onClick={() => setPleinEcran(null)} className="absolute top-4 right-4 text-white text-3xl z-10" aria-label="Fermer">✕</button>
          <div className="absolute top-4 left-4 text-white font-bold text-lg z-10">{pleinEcran.nom} — 📍 {pleinEcran.emplacement}</div>
          {pleinEcran.type === "img" ? (
            <img src={pleinEcran.url_embed} alt={pleinEcran.nom} className="max-w-full max-h-full" data-no-invert />
          ) : (
            <iframe src={pleinEcran.url_embed} className="w-full h-full" allow="autoplay; fullscreen" data-no-invert title={pleinEcran.nom} />
          )}
        </div>
      )}
    </div>
  );
}

function In({ label, v, o }: { label: string; v: string; o: (v: string) => void }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="text" value={v} onChange={(e) => o(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}

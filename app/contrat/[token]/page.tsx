"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

export default function SignatureContratPage() {
  const params = useParams();
  const token = params?.token as string;
  const [meta, setMeta] = useState<any>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [nom, setNom] = useState("");
  const [busy, setBusy] = useState(false);
  const [signe, setSigne] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dernierePos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    fetch(`/api/contrats-pipeline/${token}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((d) => { setMeta(d); setNom(d?.data?.client_nom || ""); if (d.statut === "signe") setSigne(true); })
      .catch(() => setErreur("Contrat introuvable ou lien expiré."))
      .finally(() => setChargement(false));
  }, [token]);

  // ===== Pad de signature (canvas pointer events) =====
  const posCanvas = (e: PointerEvent): { x: number; y: number } => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 2.5; ctx.strokeStyle = "#0f172a";
    const onDown = (e: PointerEvent) => { e.preventDefault(); drawing.current = true; dernierePos.current = posCanvas(e); };
    const onMove = (e: PointerEvent) => {
      if (!drawing.current) return;
      const p = posCanvas(e), last = dernierePos.current!;
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      dernierePos.current = p;
    };
    const onUp = () => { drawing.current = false; dernierePos.current = null; };
    c.addEventListener("pointerdown", onDown); c.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
    return () => { c.removeEventListener("pointerdown", onDown); c.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp); };
  }, [meta]);

  const effacer = () => {
    const c = canvasRef.current; if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
  };

  const signatureVide = (): boolean => {
    const c = canvasRef.current; if (!c) return true;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
    return true;
  };

  const signer = async () => {
    if (signatureVide()) { alert("Veuillez signer dans la zone prévue."); return; }
    if (!nom.trim()) { alert("Veuillez saisir votre nom complet."); return; }
    setBusy(true);
    try {
      const signatureUrl = canvasRef.current!.toDataURL("image/png");
      // Régénère le PDF côté navigateur avec la signature embarquée
      const { genererContratBlob } = await import("@/lib/pdf-contrat");
      const data = { ...meta.data, signature_client: { nom: nom.trim(), date: new Date().toLocaleDateString("fr-CA") }, signature_client_image: signatureUrl };
      const blob = await genererContratBlob(data);
      const pdfSigne = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result as string);
        reader.onerror = rej;
        reader.readAsDataURL(blob);
      });
      const r = await fetch(`/api/contrats-pipeline/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature_dataurl: signatureUrl, signature_nom: nom.trim(), pdf_signe: pdfSigne }),
      });
      const d = await r.json();
      if (d.ok) setSigne(true);
      else alert(d.error || "Échec de la signature");
    } catch (e: any) {
      alert("Erreur : " + (e?.message || ""));
    } finally { setBusy(false); }
  };

  if (chargement) return <main className="min-h-screen flex items-center justify-center text-slate-500 text-sm">Chargement…</main>;
  if (erreur) return <main className="min-h-screen flex items-center justify-center bg-slate-50"><div className="bg-white border border-red-200 text-red-700 rounded p-6 max-w-md text-center">{erreur}</div></main>;

  if (signe) return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow p-6 max-w-md text-center space-y-3">
        <div className="text-6xl">✅</div>
        <h1 className="text-xl font-bold text-emerald-700">Contrat signé !</h1>
        <p className="text-sm text-slate-700">Merci {meta?.signature_nom || nom}. Une copie du contrat signé est conservée par Revêtement Viking Inc.</p>
        <a href={`/api/contrats-pipeline/${token}/pdf?signe=1`} target="_blank" rel="noreferrer" className="inline-block px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-sm">📄 Télécharger ma copie signée</a>
        <p className="text-xs text-slate-500 pt-3">Revêtement Viking Inc. · RBQ 5811-4299-01 · revetementviking@gmail.com · (438) 493-2041</p>
      </div>
    </main>
  );

  return (
    <main className="min-h-screen bg-slate-50 py-4 px-3">
      <div className="max-w-3xl mx-auto space-y-4">
        <header className="bg-slate-900 text-white rounded-lg p-4 flex items-center gap-3">
          <img src="/logo-viking.svg" alt="Viking" className="h-10 w-10 brightness-0 invert" />
          <div>
            <h1 className="font-bold text-lg">Signature du contrat</h1>
            <div className="text-xs opacity-80">Revêtement Viking Inc. · Contrat n° {meta?.numero}</div>
          </div>
        </header>

        <section className="bg-white rounded-lg shadow">
          <div className="p-3 border-b text-sm">
            <strong className="text-slate-900">Aperçu du contrat</strong>
            <span className="text-xs text-slate-500 ml-2">Prends ton temps pour le lire avant de signer.</span>
          </div>
          <iframe
            src={`/api/contrats-pipeline/${token}/pdf#view=FitH&toolbar=1`}
            title="Contrat à signer"
            className="w-full border-0"
            style={{ height: "70vh", minHeight: 500 }}
          />
        </section>

        <section className="bg-white rounded-lg shadow p-4 space-y-3">
          <h2 className="font-bold text-base">✍️ Ta signature</h2>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Nom complet (tel qu'écrit sur la signature)</span>
            <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Prénom Nom" className="w-full mt-1 px-3 py-2 border rounded text-sm" />
          </label>

          <div>
            <span className="text-xs font-semibold text-slate-600">Dessine ta signature</span>
            <div className="mt-1 border-2 border-slate-300 bg-white rounded-lg" style={{ touchAction: "none" }}>
              <canvas ref={canvasRef} width={800} height={250} style={{ width: "100%", height: "180px", display: "block" }} />
            </div>
            <div className="mt-1 flex justify-between text-xs">
              <button onClick={effacer} className="text-slate-600 hover:text-red-700">↺ Effacer</button>
              <span className="text-slate-400">Utilise ta souris, ton doigt ou un stylet.</span>
            </div>
          </div>

          <p className="text-[10px] text-slate-500">
            En cliquant sur « Signer le contrat », tu acceptes les conditions du contrat ci-dessus. Une copie PDF signée te sera fournie immédiatement et conservée par Revêtement Viking Inc.
          </p>

          <button onClick={signer} disabled={busy} className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-bold">
            {busy ? "⏳ Signature en cours…" : "✍️ Signer le contrat"}
          </button>
        </section>

        <footer className="text-center text-[10px] text-slate-500 py-4">
          Revêtement Viking Inc. · RBQ 5811-4299-01 · revetementviking@gmail.com · (438) 493-2041
        </footer>
      </div>
    </main>
  );
}

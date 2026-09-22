"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { envoyer } from "@/lib/envoi";

export default function SignatureContratPage() {
  const params = useParams();
  const token = params?.token as string;
  const [meta, setMeta] = useState<any>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState("");
  const [nom, setNom] = useState("");
  const [busy, setBusy] = useState(false);
  const [signe, setSigne] = useState(false);
  // Acceptation explicite : le consentement ne se déduit plus d'un clic sur un bouton.
  // C'est ce que fait DocuSign, et c'est ce que le certificat d'authentification atteste.
  const [accepte, setAccepte] = useState(false);
  const [devisVu, setDevisVu] = useState(false);
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
    // `busy` en tête : deux taps sur mobile envoyaient deux signatures. La seconde
    // recevait 409 « déjà signé » et affichait une erreur alors que tout s'était bien
    // passé — le client croyait que sa signature avait échoué.
    if (busy) return;
    if (!accepte) { alert("Coche la case d'acceptation avant de signer."); return; }
    if (!nom.trim()) { alert("Veuillez saisir votre nom complet."); return; }
    if (signatureVide()) { alert("Veuillez signer dans la zone prévue."); return; }
    setBusy(true);
    try {
      // Le PDF signé est régénéré côté serveur à partir du contrat autoritaire en base
      // (voir app/api/contrats-pipeline/[token]/route.ts) — le navigateur envoie seulement
      // la signature dessinée, jamais un PDF déjà composé.
      const signatureUrl = canvasRef.current!.toDataURL("image/png");
      // envoyer() : ne lève jamais et lit la réponse même si elle n'est pas du JSON
      // (413 si la signature dessinée est trop lourde).
      const r = await envoyer(`/api/contrats-pipeline/${token}`, { corps: { signature_dataurl: signatureUrl, signature_nom: nom.trim() } });
      // 409 = le contrat était déjà signé (double envoi, retour arrière du navigateur).
      // C'est un succès du point de vue du client, pas une erreur à lui montrer.
      if (r.ok || r.statut === 409) setSigne(true);
      else alert(`Échec de la signature : ${r.erreur}`);
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
        <div className="flex flex-col gap-2">
          <a href={`/api/contrats-pipeline/${token}/pdf?signe=1`} target="_blank" rel="noreferrer" className="inline-block px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold text-sm">📄 Télécharger ma copie signée</a>
          <a href={`/api/contrats-pipeline/${token}/certificat`} target="_blank" rel="noreferrer" className="inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded font-bold text-sm">🔏 Certificat d'authentification</a>
          {/* Le devis reste accessible après signature : il fait partie du dossier que le
              client vient d'accepter, il doit pouvoir le retrouver. */}
          {meta?.annexe && (
            <a href={`/api/contrats-pipeline/${token}/annexe`} target="_blank" rel="noreferrer" className="inline-block px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-bold text-sm">📎 Devis joint</a>
          )}
        </div>
        <p className="text-[11px] text-slate-500">Le certificat atteste de l'historique et de l'intégrité de votre signature. Conservez les deux documents.</p>
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

        {/* Devis joint — pièce du dossier contractuel. Le client doit pouvoir le lire
            AVANT de signer, pas le découvrir dans le courriel de confirmation. */}
        {meta?.annexe && (
          <section className="bg-white rounded-lg shadow p-4">
            <h2 className="font-bold text-base">📎 Devis joint au contrat</h2>
            <p className="text-xs text-slate-600 mt-1">
              Ce document fait partie du contrat. Consulte-le avant de signer — il te sera renvoyé avec ta copie signée.
            </p>
            <a
              href={`/api/contrats-pipeline/${token}/annexe`}
              target="_blank"
              rel="noreferrer"
              onClick={() => setDevisVu(true)}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-bold text-sm min-h-[44px]"
            >
              📄 Ouvrir le devis — {meta.annexe.nom}
            </a>
            {devisVu && <span className="ml-2 text-xs text-emerald-700 font-semibold">✓ ouvert</span>}
          </section>
        )}

        <section className="bg-white rounded-lg shadow p-4 space-y-3">
          <h2 className="font-bold text-base">✍️ Ta signature</h2>

          {/* Rappel du montant : le client ne devrait pas avoir à rouvrir le PDF pour
              vérifier ce qu'il s'apprête à accepter. */}
          {meta?.data?.prix_total != null && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Montant du contrat</span>
                <strong className="text-slate-900">
                  {Number(meta.data.prix_total).toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}
                </strong>
              </div>
              {meta.data.depot_pct ? (
                <div className="flex justify-between mt-1 text-xs text-slate-600">
                  <span>Dépôt à la signature ({meta.data.depot_pct} %)</span>
                  <span>{(Number(meta.data.prix_total) * Number(meta.data.depot_pct) / 100).toLocaleString("fr-CA", { style: "currency", currency: "CAD" })}</span>
                </div>
              ) : null}
              {meta.data.date_debut_travaux ? (
                <div className="flex justify-between mt-1 text-xs text-slate-600">
                  <span>Début des travaux</span><span>{meta.data.date_debut_travaux}</span>
                </div>
              ) : null}
            </div>
          )}
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

          {/* Consentement explicite. Il est daté, horodaté et repris dans le certificat
              d'authentification : c'est lui qui rend la signature opposable, pas le clic
              sur le bouton vert. */}
          <label className="flex items-start gap-3 p-3 bg-amber-50 border-2 border-amber-200 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={accepte}
              onChange={(e) => setAccepte(e.target.checked)}
              className="mt-0.5 w-5 h-5 flex-shrink-0 accent-emerald-600"
            />
            <span className="text-xs text-slate-800">
              J'ai lu et j'accepte les conditions du contrat n° <strong>{meta?.numero}</strong>
              {meta?.annexe ? <> ainsi que le <strong>devis joint</strong></> : null}. Je consens à signer
              électroniquement, et je comprends que cette signature a la même valeur qu'une signature manuscrite
              (Loi concernant le cadre juridique des technologies de l'information, RLRQ c. C-1.1).
            </span>
          </label>

          <p className="text-[10px] text-slate-500">
            Une copie PDF signée et un certificat d'authentification te seront fournis immédiatement, et conservés par Revêtement Viking Inc.
          </p>

          <button
            onClick={signer}
            disabled={busy || !accepte}
            className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-bold min-h-[48px]"
          >
            {busy ? "⏳ Signature en cours…" : accepte ? "✍️ Signer le contrat" : "Coche la case pour signer"}
          </button>
        </section>

        <footer className="text-center text-[10px] text-slate-500 py-4">
          Revêtement Viking Inc. · RBQ 5811-4299-01 · revetementviking@gmail.com · (438) 493-2041
        </footer>
      </div>
    </main>
  );
}

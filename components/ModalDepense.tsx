"use client";

import { useEffect, useState, lazy, Suspense } from "react";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import BottomSheet from "@/components/BottomSheet";
import { compresserImage } from "@/lib/img";

const ScannerRecu = lazy(() => import("@/components/ScannerRecu"));
import MicVocal from "@/components/MicVocal";
import ProjetPicker from "@/components/ProjetPicker";

interface Props { ouvert: boolean; onClose: () => void; onSuccess?: () => void; projetIdInitial?: number; }
const CATEGORIES_FALLBACK = ["matériaux", "outils", "location", "sous-traitant", "transport", "permis", "essence", "autre"];

export default function ModalDepense({ ouvert, onClose, onSuccess, projetIdInitial }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [projets, setProjets] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>(CATEGORIES_FALLBACK);
  const [fournisseursConnus, setFournisseursConnus] = useState<string[]>([]);
  const [catParFournisseur, setCatParFournisseur] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ projet_id: 0, date: today, montant: "", fournisseur: "", description: "", categorie: CATEGORIES_FALLBACK[0], detaxe: false });
  const [recu, setRecu] = useState<{ data: string; type: string; nom: string } | null>(null); // PDF téléversé directement
  const [pagesRecu, setPagesRecu] = useState<string[]>([]); // photos d'une même facture → combinées en PDF
  const [scannerOuvert, setScannerOuvert] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const traiterFichier = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) { toast("Fichier > 20 MB", "warning"); return; }
    try {
      const data = await compresserImage(file);
      // PDF téléversé : on le garde tel quel (remplace les photos éventuelles).
      if (file.type === "application/pdf") {
        setRecu({ data, type: file.type, nom: file.name });
        setPagesRecu([]);
        return;
      }
      // IMAGE : scan document (cadrage + filtre) puis AJOUT comme page de la facture.
      let img = data;
      try {
        const { autoCadrer, filtreDocument } = await import("@/lib/imgScanner");
        img = await filtreDocument(await autoCadrer(data), 1);
      } catch { /* scan échoué → image originale */ }
      setRecu(null);
      setPagesRecu((prev) => [...prev, img]);
    } catch (e: any) {
      toast("Erreur : " + e.message, "error");
    }
  };

  const retirerPage = (i: number) => setPagesRecu((prev) => prev.filter((_, idx) => idx !== i));

  // Traite 1 ou plusieurs fichiers puis RÉINITIALISE l'input (sinon iOS/Android ne
  // redéclenche pas onChange au 2e ajout → impossible d'ajouter plusieurs photos).
  const ajouterFichiers = async (input: HTMLInputElement) => {
    const files = Array.from(input.files || []);
    input.value = "";
    for (const f of files) await traiterFichier(f);
  };

  const confirmerScan = (image: string, _type: string, donnees?: { montant?: number; date?: string; fournisseur?: string }) => {
    // Met à jour la 1re page (celle scannée) et pré-remplit le formulaire.
    setPagesRecu((prev) => (prev.length ? [image, ...prev.slice(1)] : [image]));
    setScannerOuvert(false);
    if (donnees) {
      setForm((f) => ({
        ...f,
        montant: donnees.montant !== undefined && !f.montant ? String(donnees.montant.toFixed(2)) : f.montant,
        date: donnees.date && !f.date ? donnees.date : f.date,
        fournisseur: donnees.fournisseur && !f.fournisseur ? donnees.fournisseur : f.fournisseur,
      }));
      if (donnees.montant || donnees.date || donnees.fournisseur) toast("✓ Formulaire pré-rempli depuis l'OCR", "success");
    }
  };

  useEffect(() => {
    if (!ouvert) return;
    fetch("/api/projets?lite=1").then((r) => r.json()).then((tous: any[]) => {
      const DELAI = 14 * 86400000; // 2 semaines après la complétion : factures fournisseurs en retard
      const dispo = (Array.isArray(tous) ? tous : [])
        .filter((p) => {
          if (p.statut === "annule") return false;
          if (p.statut !== "complete") return true; // actifs / à venir / en cours
          // Complété : on le garde 2 semaines après la date de fin (pour les dépenses tardives).
          const fin = p.date_fin_reelle || p.date_fin_prevue;
          return fin ? (Date.now() - new Date(fin).getTime()) <= DELAI : false;
        })
        .sort((a, b) => (a.statut === "actif" ? -1 : 1) - (b.statut === "actif" ? -1 : 1));
      setProjets(dispo);
      if (dispo.length > 0 && !form.projet_id) setForm((f) => ({ ...f, projet_id: projetIdInitial || 0 }));
    });
    fetch("/api/depenses?fournisseurs=1").then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) setFournisseursConnus(d);
    }).catch(() => {});
    fetch("/api/depenses?categories_par_fournisseur=1").then((r) => r.json()).then((m) => {
      if (m && typeof m === "object") setCatParFournisseur(m);
    }).catch(() => {});
    fetch("/api/categories-depense").then((r) => r.json()).then((cats: any[]) => {
      if (Array.isArray(cats) && cats.length > 0) {
        const noms = cats.map((c) => c.nom);
        setCategories(noms);
        setForm((f) => (noms.includes(f.categorie) ? f : { ...f, categorie: noms[0] }));
      }
    }).catch(() => {});
  }, [ouvert]);

  const projet = projets.find((p) => p.id === form.projet_id);

  const enregistrer = async () => {
    if (!form.montant || +form.montant <= 0) { toast("Montant requis", "warning"); return; }
    // Normaliser le fournisseur en cherchant un match case-insensitive parmi les connus
    let fournisseurNormalise = form.fournisseur.trim();
    if (fournisseurNormalise) {
      const match = fournisseursConnus.find(f => f.toLowerCase() === fournisseurNormalise.toLowerCase());
      if (match) fournisseurNormalise = match;
    }
    setLoading(true);
    try {
      // Assemble le reçu : PDF téléversé, sinon les photos (≥2 → 1 seul PDF, 1 → image).
      let recu_data = recu?.data || null;
      let recu_type = recu?.type || null;
      if (pagesRecu.length === 1) {
        recu_data = pagesRecu[0]; recu_type = "image/jpeg";
      } else if (pagesRecu.length >= 2) {
        const { imagesVersPdfDataUrl } = await import("@/lib/pdf-images");
        recu_data = await imagesVersPdfDataUrl(pagesRecu); recu_type = "application/pdf";
      }
      const aRecu = !!recu_data;
      const r = await fetch("/api/depenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, fournisseur: fournisseurNormalise, projet_id: form.projet_id || null, montant: +form.montant, recu_data, recu_type }),
      });
      if ((await r.json()).ok) {
        toast(`✓ Dépense ${formatCAD(+form.montant)} ajoutée${aRecu ? (pagesRecu.length >= 2 ? ` (facture ${pagesRecu.length} pages → PDF)` : " (reçu joint)") : ""}`, "success");
        setForm({ projet_id: form.projet_id, date: today, montant: "", fournisseur: "", description: "", categorie: "matériaux", detaxe: false });
        setRecu(null); setPagesRecu([]);
        onSuccess?.();
        onClose();
      }
    } catch (e: any) {
      toast("Erreur : " + (e?.message || ""), "error");
    } finally { setLoading(false); }
  };

  return (
    <BottomSheet
      ouvert={ouvert}
      onClose={onClose}
      titre="💸 Ajouter une dépense"
      soustitre="Projet optionnel"
      couleurHeader="from-orange-600 to-amber-600"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-3 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-semibold">Annuler</button>
          <button onClick={enregistrer} disabled={loading} className="px-5 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-bold disabled:opacity-50">
            {loading ? "⏳..." : "💾 Enregistrer"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Projet (optionnel)</label>
            <ProjetPicker value={form.projet_id || 0} onChange={(pid) => setForm({ ...form, projet_id: pid })} projets={projets} aucunLabel="— Aucun (dépense générale, ex: outils)" />
            {projet && (
              <div className="text-xs text-slate-500 mt-1 flex justify-between">
                <span>Budget : <strong>{formatCAD(projet.budget_estime || 0)}</strong></span>
                <span>Dépenses : <strong className="text-orange-700">{formatCAD(projet.total_depenses)}</strong></span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full px-3 py-3 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Montant $ *</label>
              <input type="number" inputMode="decimal" step={0.01} value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} placeholder="0.00" className="w-full px-3 py-3 border rounded-lg text-base text-right font-bold" autoFocus />
            </div>
          </div>

          {/* Facture détaxée : montant sans TPS/TVQ (on ne retire pas les taxes dans les calculs avant-taxes). */}
          <button
            type="button"
            onClick={() => setForm((f) => ({ ...f, detaxe: !f.detaxe }))}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border-2 text-sm font-semibold transition ${form.detaxe ? "bg-emerald-50 border-emerald-500 text-emerald-900" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"}`}
          >
            <span className="flex items-center gap-2">🧾 Facture détaxée <span className="font-normal text-xs text-slate-500">(sans TPS/TVQ)</span></span>
            <span className={`w-10 h-6 rounded-full flex items-center transition ${form.detaxe ? "bg-emerald-500 justify-end" : "bg-slate-300 justify-start"} px-0.5`}>
              <span className="w-5 h-5 bg-white rounded-full shadow" />
            </span>
          </button>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Fournisseur</label>
            <input
              type="text"
              autoCapitalize="words"
              list="fournisseurs-connus"
              value={form.fournisseur}
              onChange={(e) => {
                const v = e.target.value;
                // Auto-catégorie : si on a déjà vu ce fournisseur, propose sa catégorie habituelle
                const catSuggeree = catParFournisseur[v.toLowerCase().trim()];
                setForm((f) => ({ ...f, fournisseur: v, ...(catSuggeree && categories.includes(catSuggeree) ? { categorie: catSuggeree } : {}) }));
              }}
              placeholder="Gentek, MAC, Maibec..."
              className="w-full px-3 py-3 border rounded-lg text-sm"
            />
            <datalist id="fournisseurs-connus">
              {fournisseursConnus.map((f) => <option key={f} value={f} />)}
            </datalist>
            {form.fournisseur && fournisseursConnus.length > 0 && (() => {
              const exact = fournisseursConnus.find(f => f.toLowerCase() === form.fournisseur.toLowerCase());
              const similar = fournisseursConnus.find(f => f.toLowerCase().includes(form.fournisseur.toLowerCase()) || form.fournisseur.toLowerCase().includes(f.toLowerCase()));
              if (exact && exact !== form.fournisseur) return <div className="text-[10px] text-amber-700 mt-1">⚠️ Existe déjà sous "{exact}" — sera normalisé</div>;
              if (!exact && similar) return <div className="text-[10px] text-blue-700 mt-1">💡 Similaire : "{similar}" ?</div>;
              return null;
            })()}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Catégorie</label>
            <div className="grid grid-cols-3 gap-1.5">
              {categories.map((c) => (
                <button key={c} onClick={() => setForm({ ...form, categorie: c })} className={`px-2 py-2.5 rounded-lg text-xs font-medium ${form.categorie === c ? "bg-orange-600 text-white" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <div className="flex gap-2">
              <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Détails… ou utilise le micro →" className="flex-1 px-3 py-3 border rounded-lg text-sm" />
              <MicVocal taille="sm" onTranscript={(t) => setForm((f) => ({ ...f, description: (f.description ? f.description + " " : "") + t }))} titre="Dicter la description" />
            </div>
          </div>

          {/* Reçu : photo caméra ou fichier galerie/PDF */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">📎 Reçu (optionnel)</label>
            {recu ? (
              <div className="border-2 border-emerald-300 bg-emerald-50 rounded-lg p-2 flex items-center gap-2">
                <div className="w-16 h-16 bg-slate-200 rounded flex items-center justify-center text-2xl">📄</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{recu.nom}</div>
                  <div className="text-[10px] text-slate-500">PDF · {(recu.data.length * 0.75 / 1024).toFixed(0)} ko</div>
                </div>
                <button onClick={() => setRecu(null)} className="text-red-600 hover:bg-red-100 px-2 py-1 rounded text-sm">✕</button>
              </div>
            ) : pagesRecu.length > 0 ? (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  {pagesRecu.map((p, i) => (
                    <div key={i} className="relative aspect-square">
                      <img src={p} alt={`Page ${i + 1}`} className="w-full h-full object-cover rounded border" />
                      <span className="absolute top-0 left-0 bg-black/60 text-white text-[9px] px-1 rounded-br">P{i + 1}</span>
                      <button onClick={() => retirerPage(i)} className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-[10px] flex items-center justify-center shadow">✕</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 flex-wrap items-center">
                  <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded-lg text-xs font-bold">
                    📷 Ajouter une page
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => ajouterFichiers(e.target)} />
                  </label>
                  <label className="cursor-pointer bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded-lg text-xs font-bold">
                    📁 Galerie
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => ajouterFichiers(e.target)} />
                  </label>
                  {pagesRecu.length === 1 && (
                    <button onClick={() => setScannerOuvert(true)} className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-2 rounded font-bold" title="OCR pour pré-remplir le formulaire">🔎 OCR</button>
                  )}
                </div>
                <p className="text-[10px] text-slate-500">
                  {pagesRecu.length >= 2
                    ? `${pagesRecu.length} pages → combinées en 1 seul PDF à l'enregistrement.`
                    : "Facture trop grande ? Ajoute d'autres photos — elles seront combinées en un seul PDF."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="cursor-pointer bg-white border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 rounded-lg p-3 text-center transition">
                  <div className="text-2xl mb-1">📷</div>
                  <div className="text-xs font-semibold text-slate-700">Prendre photo</div>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => ajouterFichiers(e.target)} />
                </label>
                <label className="cursor-pointer bg-white border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 rounded-lg p-3 text-center transition">
                  <div className="text-2xl mb-1">📁</div>
                  <div className="text-xs font-semibold text-slate-700">Galerie / PDF</div>
                  <input type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => ajouterFichiers(e.target)} />
                </label>
              </div>
            )}
          </div>
        </div>

        {scannerOuvert && pagesRecu[0] && (
          <Suspense fallback={null}>
            <ScannerRecu
              imageOriginale={pagesRecu[0]}
              onClose={() => setScannerOuvert(false)}
              onConfirmer={confirmerScan}
            />
          </Suspense>
        )}
    </BottomSheet>
  );
}

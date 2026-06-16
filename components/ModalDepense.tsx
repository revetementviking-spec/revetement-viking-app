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
  const [form, setForm] = useState({ projet_id: 0, date: today, montant: "", fournisseur: "", description: "", categorie: CATEGORIES_FALLBACK[0] });
  const [recu, setRecu] = useState<{ data: string; type: string; nom: string } | null>(null);
  const [scannerOuvert, setScannerOuvert] = useState(false);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const traiterFichier = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) { toast("Fichier > 20 MB", "warning"); return; }
    try {
      const data = await compresserImage(file);
      const type = file.type === "application/pdf" ? file.type : "image/jpeg";
      // PDF : on garde tel quel, pas de scan
      if (type === "application/pdf") {
        setRecu({ data, type, nom: file.name });
        return;
      }
      // IMAGE : on applique automatiquement le scan document (cadrage + filtre) — comme Drive
      // Affiche immédiatement l'original puis remplace par la version scannée quand prête.
      setRecu({ data, type, nom: file.name });
      try {
        const { autoCadrer, filtreDocument } = await import("@/lib/imgScanner");
        const cadree = await autoCadrer(data);
        const filtree = await filtreDocument(cadree, 1);
        setRecu({ data: filtree, type: "image/jpeg", nom: file.name + " (scan)" });
        toast("✨ Photo scannée automatiquement (cadrée + nette)", "success");
      } catch {
        // Si le scan échoue, on garde l'image originale (déjà affichée)
      }
    } catch (e: any) {
      toast("Erreur : " + e.message, "error");
    }
  };

  const confirmerScan = (image: string, type: string, donnees?: { montant?: number; date?: string; fournisseur?: string }) => {
    setRecu({ data: image, type, nom: recu?.nom || "recu-scan.jpg" });
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
      const r = await fetch("/api/depenses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, fournisseur: fournisseurNormalise, projet_id: form.projet_id || null, montant: +form.montant, recu_data: recu?.data || null, recu_type: recu?.type || null }),
      });
      if ((await r.json()).ok) {
        toast(`✓ Dépense ${formatCAD(+form.montant)} ajoutée${recu ? " (reçu joint)" : ""}`, "success");
        setForm({ projet_id: form.projet_id, date: today, montant: "", fournisseur: "", description: "", categorie: "matériaux" });
        setRecu(null);
        onSuccess?.();
        onClose();
      }
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
                {recu.type.startsWith("image/") ? (
                  <img src={recu.data} alt="Reçu" className="w-16 h-16 object-cover rounded" />
                ) : (
                  <div className="w-16 h-16 bg-slate-200 rounded flex items-center justify-center text-2xl">📄</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{recu.nom}</div>
                  <div className="text-[10px] text-slate-500">{(recu.data.length * 0.75 / 1024).toFixed(0)} ko</div>
                </div>
                {recu.type.startsWith("image/") && (
                  <button onClick={() => setScannerOuvert(true)} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded font-bold" title="Réajuster le cadrage / Lancer l'OCR pour pré-remplir le formulaire">🔎 OCR</button>
                )}
                <button onClick={() => setRecu(null)} className="text-red-600 hover:bg-red-100 px-2 py-1 rounded text-sm">✕</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="cursor-pointer bg-white border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 rounded-lg p-3 text-center transition">
                  <div className="text-2xl mb-1">📷</div>
                  <div className="text-xs font-semibold text-slate-700">Prendre photo</div>
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && traiterFichier(e.target.files[0])} />
                </label>
                <label className="cursor-pointer bg-white border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 rounded-lg p-3 text-center transition">
                  <div className="text-2xl mb-1">📁</div>
                  <div className="text-xs font-semibold text-slate-700">Galerie / PDF</div>
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && traiterFichier(e.target.files[0])} />
                </label>
              </div>
            )}
          </div>
        </div>

        {scannerOuvert && recu && recu.type.startsWith("image/") && (
          <Suspense fallback={null}>
            <ScannerRecu
              imageOriginale={recu.data}
              onClose={() => setScannerOuvert(false)}
              onConfirmer={confirmerScan}
            />
          </Suspense>
        )}
    </BottomSheet>
  );
}

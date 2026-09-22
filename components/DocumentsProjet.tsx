"use client";

// Espace documents d'un chantier : permis, plans, garanties, fiches techniques, rapports
// d'inspection. Distinct des photos de chantier (galerie datée), du contrat signé et de la
// facture finale, qui ont chacun leur emplacement dédié sur la fiche.

import { useEffect, useRef, useState } from "react";
import ZoneDepot from "@/components/ZoneDepot";
import { useToast } from "@/components/Toasts";
import { envoyer } from "@/lib/envoi";
import { jourMontreal } from "@/lib/date";
import Modale from "@/components/Modale";
import { LIMITE_FICHIER_OCTETS, LIMITE_FICHIER_TEXTE } from "@/lib/limites-fichiers";

// 4 Mo : au-delà, la requête encodée en base64 dépasse la limite de la plateforme.
const TAILLE_MAX = LIMITE_FICHIER_OCTETS;

const CATEGORIES = ["Permis", "Plan / devis technique", "Garantie", "Fiche technique", "Inspection", "Assurance", "Facture fournisseur", "Autre"];

const ICONE = (type: string, nom: string) => {
  if (/^image\//.test(type)) return "🖼️";
  if (type === "application/pdf" || /\.pdf$/i.test(nom)) return "📄";
  if (/sheet|excel|csv/i.test(type) || /\.(xlsx?|csv)$/i.test(nom)) return "📊";
  if (/word|document/i.test(type) || /\.docx?$/i.test(nom)) return "📝";
  return "📎";
};
const poids = (o?: number) => (!o ? "" : o > 1024 * 1024 ? `${(o / 1024 / 1024).toFixed(1)} Mo` : `${Math.round(o / 1024)} Ko`);

export default function DocumentsProjet({ projetId, onChange }: { projetId: number; onChange?: () => void }) {
  const [fichiers, setFichiers] = useState<any[]>([]);
  const [chargement, setChargement] = useState(true);
  const [envoiEnCours, setEnvoiEnCours] = useState<string | null>(null);
  const [categorie, setCategorie] = useState("");
  const [edition, setEdition] = useState<{ id: number; nom: string; categorie: string; description: string } | null>(null);
  const [apercu, setApercu] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const charger = async () => {
    setChargement(true);
    const d = await fetch(`/api/projet-fichiers?projet_id=${projetId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : [])).catch(() => []);
    setFichiers(Array.isArray(d) ? d : []);
    setChargement(false);
  };
  useEffect(() => { charger(); }, [projetId]);

  const deposer = async (liste: File[]) => {
    // Les fichiers partent un par un : une erreur sur le troisième ne doit pas faire
    // perdre les deux premiers, et le compte rendu nomme précisément ce qui a échoué.
    const echecs: string[] = [];
    let reussis = 0;
    for (const f of liste) {
      if (f.size > TAILLE_MAX) { echecs.push(`${f.name} (${poids(f.size)}, max ${LIMITE_FICHIER_TEXTE})`); continue; }
      setEnvoiEnCours(f.name);
      const data = await new Promise<string | null>((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => res(null);
        r.readAsDataURL(f);
      });
      if (!data) { echecs.push(`${f.name} (lecture impossible)`); continue; }
      const rep = await envoyer("/api/projet-fichiers", {
        corps: { projet_id: projetId, nom: f.name, type: f.type || "application/octet-stream", taille: f.size, data, categorie: categorie || null },
      });
      if (!rep.ok) echecs.push(`${f.name} — ${rep.erreur}`);
      else reussis++;
    }
    setEnvoiEnCours(null);
    if (reussis) toast(`${reussis} document(s) déposé(s)`, "success");
    if (echecs.length) toast(`Non déposé(s) : ${echecs.join(" · ")}`, "error");
    if (reussis) { charger(); onChange?.(); }
  };

  const supprimer = async (f: any) => {
    if (!confirm(`Supprimer « ${f.nom} » ? Le fichier sera définitivement effacé.`)) return;
    const r = await envoyer(`/api/projet-fichiers?id=${f.id}`, { methode: "DELETE" });
    if (!r.ok) { toast(`Échec de la suppression : ${r.erreur}`, "error"); return; }
    toast("Document supprimé", "info");
    setFichiers((arr) => arr.filter((x) => x.id !== f.id));
    onChange?.();
  };

  const enregistrer = async () => {
    if (!edition) return;
    if (!edition.nom.trim()) { toast("Le nom ne peut pas être vide", "warning"); return; }
    const r = await envoyer("/api/projet-fichiers", {
      methode: "PATCH",
      corps: { id: edition.id, nom: edition.nom.trim(), categorie: edition.categorie || null, description: edition.description || null },
    });
    if (!r.ok) { toast(`Modification refusée : ${r.erreur}`, "error"); return; }
    toast("Document mis à jour", "success");
    setEdition(null);
    charger();
  };

  // Regroupement par catégorie, « Sans catégorie » en dernier.
  const groupes = (() => {
    const m = new Map<string, any[]>();
    for (const f of fichiers) {
      const k = f.categorie || "Sans catégorie";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(f);
    }
    return [...m.entries()].sort((a, b) => (a[0] === "Sans catégorie" ? 1 : b[0] === "Sans catégorie" ? -1 : a[0].localeCompare(b[0])));
  })();

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-lg shadow p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block flex-1 min-w-[200px]">
            <span className="block text-xs font-medium text-slate-600 mb-1">Classer le prochain dépôt dans</span>
            <select value={categorie} onChange={(e) => setCategorie(e.target.value)} className="w-full px-3 py-2 border rounded text-sm bg-white min-h-[44px]">
              <option value="">— Sans catégorie —</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        <ZoneDepot onFichiers={deposer} multiple messageSurvol="📂 Dépose les documents ici">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={!!envoiEnCours}
            className="w-full border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 disabled:opacity-60 rounded-lg p-6 text-sm text-slate-600 min-h-[96px] transition"
          >
            {envoiEnCours ? (
              <span className="animate-pulse">⏳ Envoi de {envoiEnCours}…</span>
            ) : (
              <>
                📂 Glisse tes documents ici, ou clique pour les choisir
                <br />
                <span className="text-xs text-slate-400">PDF, images, Word, Excel — plusieurs à la fois, 4 Mo chacun</span>
              </>
            )}
          </button>
        </ZoneDepot>
        <input
          ref={inputRef} type="file" multiple className="hidden"
          onChange={(e) => { deposer(Array.from(e.target.files || [])); e.target.value = ""; }}
        />
      </div>

      {chargement ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">Chargement…</div>
      ) : fichiers.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-10 text-center text-slate-500">
          Aucun document sur ce chantier.
          <div className="text-xs mt-1">Permis, plans, garanties, fiches techniques, rapports d'inspection…</div>
        </div>
      ) : (
        groupes.map(([cat, liste]) => (
          <div key={cat} className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-2 bg-slate-50 border-b text-xs font-bold text-slate-700 uppercase tracking-wide">
              {cat} <span className="font-normal text-slate-400">({liste.length})</span>
            </div>
            <div className="divide-y">
              {liste.map((f) => {
              // `ed` (const local) : TypeScript ne peut pas garantir qu'un état lu dans
              // une fermeture reste non-null au moment du rendu.
              const ed = edition && edition.id === f.id ? edition : null;
              return ed ? (
                <div key={f.id} className="p-4 space-y-2 bg-amber-50">
                  <label className="block">
                    <span className="block text-xs font-medium text-slate-600 mb-1">Nom du document</span>
                    <input value={ed.nom} onChange={(e) => setEdition({ ...ed, nom: e.target.value })} className="w-full px-3 py-2 border rounded text-sm min-h-[44px]" />
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="block">
                      <span className="block text-xs font-medium text-slate-600 mb-1">Catégorie</span>
                      <select value={ed.categorie} onChange={(e) => setEdition({ ...ed, categorie: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white min-h-[44px]">
                        <option value="">— Sans catégorie —</option>
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="block text-xs font-medium text-slate-600 mb-1">Note</span>
                      <input value={ed.description} onChange={(e) => setEdition({ ...ed, description: e.target.value })} placeholder="Ex. : valide jusqu'au 30 juin" className="w-full px-3 py-2 border rounded text-sm min-h-[44px]" />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={enregistrer} className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold min-h-[44px]">✓ Enregistrer</button>
                    <button onClick={() => setEdition(null)} className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-semibold min-h-[44px]">Annuler</button>
                  </div>
                </div>
              ) : (
                <div key={f.id} className="p-3 flex items-center gap-3 hover:bg-slate-50">
                  <div className="text-2xl flex-shrink-0">{ICONE(f.type, f.nom)}</div>
                  <button onClick={() => setApercu(f)} className="min-w-0 flex-1 text-left">
                    <div className="font-semibold text-sm text-slate-900 truncate">{f.nom}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {poids(f.taille)}{f.taille ? " · " : ""}{jourMontreal(f.date_ajout)}
                      {f.ajoute_par ? ` · ${f.ajoute_par}` : ""}
                      {f.description ? ` · ${f.description}` : ""}
                    </div>
                  </button>
                  <div className="flex gap-1 flex-shrink-0">
                    <a href={`/api/projet-fichiers/${f.id}`} target="_blank" rel="noreferrer" className="px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 rounded min-h-[44px] flex items-center" title="Ouvrir dans un onglet">↗</a>
                    <button onClick={() => setEdition({ id: f.id, nom: f.nom || "", categorie: f.categorie || "", description: f.description || "" })} aria-label={`Modifier ${f.nom}`} className="px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded min-h-[44px] min-w-[44px]">✏️</button>
                    <button onClick={() => supprimer(f)} aria-label={`Supprimer ${f.nom}`} className="px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 rounded min-h-[44px] min-w-[44px]">🗑</button>
                  </div>
                </div>
              );
              })}
            </div>
          </div>
        ))
      )}

      {/* Aperçu plein écran — même geste que pour le contrat signé et la facture */}
      {apercu && (
        <Modale onClose={() => setApercu(null)} titre={`Aperçu — ${apercu.nom}`} fermerAuClicFond={false} className="fixed inset-0 z-[80] bg-black/95 flex flex-col">
          <div className="flex items-center justify-between p-3 text-white safe-top gap-2">
            <button onClick={() => setApercu(null)} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 font-semibold text-sm">← Retour</button>
            <span className="text-sm opacity-80 truncate">{apercu.nom}</span>
            <a href={`/api/projet-fichiers/${apercu.id}`} target="_blank" rel="noreferrer" aria-label="Télécharger le document" className="px-3 py-2 min-w-11 min-h-11 inline-flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-sm">⬇</a>
          </div>
          <div className="flex-1 bg-white">
            {/^image\//.test(apercu.type) ? (
              <img src={`/api/projet-fichiers/${apercu.id}`} alt={apercu.nom} className="w-full h-full object-contain bg-black" />
            ) : (
              <iframe src={`/api/projet-fichiers/${apercu.id}`} title={apercu.nom} className="w-full h-full border-0" />
            )}
          </div>
        </Modale>
      )}
    </div>
  );
}

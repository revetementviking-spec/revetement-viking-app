"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import { compresserImage } from "@/lib/img";
import { ecrire, envoyer, nombreSaisi, lireListe } from "@/lib/envoi";
import { useVerrou } from "@/lib/verrou";
import ErreurChargement from "@/components/ErreurChargement";
import Modale from "@/components/Modale";

const EMPLACEMENTS = ["Cabanon", "Sous le tempo", "Chez Vincent", "Chez Goulet", "Autre"];
const CATEGORIES = ["Revêtement", "Moulures", "Quincaillerie", "Isolation", "Membrane", "Outils", "Consommables", "Autre"];

export default function InventairePage() {
  const [items, setItems] = useState<any[]>([]);
  const [filtreEmpl, setFiltreEmpl] = useState<string>("");
  const [recherche, setRecherche] = useState("");
  const [creerOuvert, setCreerOuvert] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  // Quantité au moment où la fiche a été ouverte — sert de témoin au verrou optimiste
  // côté serveur (voir /api/inventaire PATCH).
  const [quantiteConnue, setQuantiteConnue] = useState<number | null>(null);
  const [form, setForm] = useState({ nom: "", categorie: "", quantite: "0", unite: "u", emplacement: "Cabanon", notes: "", cout_unit: "", photo: null as null | { data: string; type: string } });
  const { toast } = useToast();

  const [erreur, setErreur] = useState<string | null>(null);
  // ?photos=1 : la liste porte les vignettes (sans ce paramètre, l'API n'envoie plus les blobs).
  const charger = () => lireListe("/api/inventaire?photos=1").then((r) => { if (r.ok) { setErreur(null); setItems(r.data); } else setErreur(r.erreur); });
  useEffect(() => { charger(); }, []);

  const reset = () => { setForm({ nom: "", categorie: "", quantite: "0", unite: "u", emplacement: "Cabanon", notes: "", cout_unit: "", photo: null }); setEditId(null); setQuantiteConnue(null); };

  // Verrou par ref (lib/verrou.ts) : deux clics du même instant créaient deux items.
  const verrou = useVerrou();
  const sauvegarder = () => verrou.executer(async () => {
    if (!form.nom.trim()) { toast("Nom requis", "warning"); return; }
    // Virgule décimale : « 2,5 » (boîtes) ou « 12,50 » ($) donnaient NaN → 0 / null en
    // silence. Un nombre illisible est maintenant REFUSÉ avec un message.
    const quantite = form.quantite.trim() ? nombreSaisi(form.quantite) : 0;
    if (!Number.isFinite(quantite)) { toast("Quantité illisible (ex. : 2,5)", "warning"); return; }
    const coutUnit = form.cout_unit.trim() ? nombreSaisi(form.cout_unit) : null;
    if (coutUnit !== null && !Number.isFinite(coutUnit)) { toast("Coût unitaire illisible (ex. : 12,50)", "warning"); return; }
    const body: any = {
      nom: form.nom, categorie: form.categorie || null,
      quantite, unite: form.unite,
      emplacement: form.emplacement, notes: form.notes || null,
      cout_unit: coutUnit,
    };
    if (form.photo) { body.photo_data = form.photo.data; body.photo_type = form.photo.type; }
    if (editId) {
      body.id = editId;
      // Quantité telle qu'elle était à l'ouverture de la fiche : le serveur refuse
      // l'enregistrement si quelqu'un l'a changée entre-temps, au lieu de l'écraser.
      body.quantite_connue = quantiteConnue;
    }
    // envoyer() : réponse lue même si elle n'est pas du JSON (413 photo trop lourde),
    // et le 409 du verrou optimiste reconnu par son statut.
    const r = await envoyer("/api/inventaire", { methode: editId ? "PATCH" : "POST", corps: body });
    if (r.ok) { toast(editId ? "Item modifié" : "Item ajouté", "success"); setCreerOuvert(false); reset(); charger(); return; }
    const d = r.data || {};
    if (r.statut === 409 && d?.conflit) {
      toast(d.error, "warning");
      setForm((x) => ({ ...x, quantite: String(d.quantite_actuelle) }));
      setQuantiteConnue(d.quantite_actuelle);
      charger();
    } else {
      toast(`Échec de l'enregistrement : ${r.erreur}`, "error");
    }
  });

  const ajusterQte = async (item: any, delta: number) => {
    const note = prompt(`${delta > 0 ? "Ajouter" : "Retirer"} ${Math.abs(delta)} ${item.unite} de "${item.nom}" — note (optionnel)`);
    if (note === null) return;
    // La réponse DOIT être lue : sinon un refus « Stock insuffisant » (400) affichait
    // quand même un toast vert et l'utilisateur croyait que sa saisie était perdue.
    const r = await envoyer("/api/inventaire", { methode: "PATCH", corps: { id: item.id, delta, note: note || null } });
    if (r.ok) toast(`${delta > 0 ? "+" : ""}${delta} ${item.unite}`, "success");
    else toast(`Mouvement refusé : ${r.erreur}`, r.statut === 0 ? "error" : "warning");
    charger();
  };

  /** Lit un nombre tapé dans un `prompt` (« 2,5 » accepté) ; null si illisible ou ≤ 0. */
  const quantiteDemandee = (question: string): number | null => {
    const n = prompt(question, "1");
    if (n === null) return null;
    const v = nombreSaisi(n);
    if (!Number.isFinite(v) || v <= 0) { toast("Quantité illisible (ex. : 2,5)", "warning"); return null; }
    return v;
  };

  const supprimer = async (item: any) => {
    if (!confirm(`Supprimer "${item.nom}" de l'inventaire ?`)) return;
    if (!(await ecrire(`/api/inventaire?id=${item.id}`, "DELETE", undefined, "Suppression"))) return;
    toast(`« ${item.nom} » retiré de l'inventaire`, "info");
    charger();
  };

  const onPhoto = async (f: File) => {
    if (!f) return;
    if (f.type.startsWith("image/")) {
      const data = await compresserImage(f);
      setForm((x) => ({ ...x, photo: { data, type: "image/jpeg" } }));
    }
  };

  const filtres = items.filter((i: any) => {
    if (filtreEmpl && i.emplacement !== filtreEmpl) return false;
    if (recherche.trim()) {
      const q = recherche.toLowerCase();
      return [i.nom, i.categorie, i.notes].filter(Boolean).some((x: string) => x.toLowerCase().includes(q));
    }
    return true;
  });

  const stats = items.reduce((s: Record<string, number>, i: any) => { s[i.emplacement || "—"] = (s[i.emplacement || "—"] || 0) + 1; return s; }, {});

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="📦 Inventaire" soustitre={`${items.length} item(s)`} />
      <main className="max-w-7xl mx-auto p-3 md:p-4 space-y-3">
        {/* Filtres + ajout */}
        <div className="flex flex-wrap gap-2 items-center">
          <button onClick={() => { reset(); setCreerOuvert(true); }} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold">➕ Nouvel item</button>
          {/* text-base (16 px) : en dessous, iOS zoome automatiquement à la mise au point
              et l'écran reste décalé après la saisie. */}
          <input value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="🔎 Rechercher..." className="flex-1 min-w-[200px] px-3 py-2 border rounded text-base" />
          <select value={filtreEmpl} onChange={(e) => setFiltreEmpl(e.target.value)} className="px-3 py-2 border rounded text-sm bg-white">
            <option value="">📍 Tous les emplacements</option>
            {EMPLACEMENTS.map((e) => <option key={e} value={e}>{e}{stats[e] ? ` (${stats[e]})` : ""}</option>)}
          </select>
        </div>

        {/* Tuiles par emplacement (vue d'ensemble) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          {EMPLACEMENTS.map((e) => (
            <button key={e} onClick={() => setFiltreEmpl(filtreEmpl === e ? "" : e)} className={`p-2 rounded border text-xs font-bold ${filtreEmpl === e ? "bg-emerald-100 border-emerald-400 text-emerald-900" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
              📍 {e}<br /><span className="text-base font-bold">{stats[e] || 0}</span>
            </button>
          ))}
        </div>

        {/* Grille items */}
        {erreur ? (
          <ErreurChargement erreur={erreur} onReessayer={charger} />
        ) : filtres.length === 0 ? (
          <div className="bg-white rounded shadow p-12 text-center text-slate-400 italic">Aucun item.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtres.map((i: any) => (
              <div key={i.id} className="bg-white rounded-lg shadow p-3 space-y-2">
                <div className="flex gap-3">
                  {i.photo_data ? (
                    <img src={i.photo_data} alt={i.nom} className="w-20 h-20 object-cover rounded border" />
                  ) : (
                    <div className="w-20 h-20 bg-slate-100 rounded border flex items-center justify-center text-3xl">📦</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-slate-900 truncate">{i.nom}</div>
                    {i.categorie && <div className="text-[10px] uppercase font-bold text-slate-500">{i.categorie}</div>}
                    <div className="text-xs text-slate-600 mt-1">📍 {i.emplacement || "—"}</div>
                    <div className="text-2xl font-bold text-emerald-700">{(+i.quantite).toFixed(i.unite === "u" ? 0 : 1)} <span className="text-sm font-normal text-slate-500">{i.unite}</span></div>
                  </div>
                </div>
                {i.notes && <div className="text-[11px] text-slate-600 italic line-clamp-2">{i.notes}</div>}
                <div className="flex gap-1">
                  <button onClick={() => ajusterQte(i, -1)} className="flex-1 px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs font-bold">−1</button>
                  <button onClick={() => {
                    const n = quantiteDemandee(`Retirer combien de ${i.nom} ?`);
                    if (n) ajusterQte(i, -n);
                  }} className="flex-1 px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded text-xs">− N</button>
                  <button onClick={() => ajusterQte(i, +1)} className="flex-1 px-2 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded text-xs font-bold">+1</button>
                  <button onClick={() => {
                    const n = quantiteDemandee(`Ajouter combien de ${i.nom} ?`);
                    if (n) ajusterQte(i, n);
                  }} className="flex-1 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-xs">+ N</button>
                </div>
                <div className="flex gap-1 text-xs">
                  <button onClick={() => {
                    setEditId(i.id);
                    setQuantiteConnue(Number(i.quantite || 0));
                    setForm({ nom: i.nom, categorie: i.categorie || "", quantite: String(i.quantite || 0), unite: i.unite || "u", emplacement: i.emplacement || "Cabanon", notes: i.notes || "", cout_unit: i.cout_unit ? String(i.cout_unit) : "", photo: i.photo_data ? { data: i.photo_data, type: i.photo_type || "image/jpeg" } : null });
                    setCreerOuvert(true);
                  }} className="flex-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded">✏️ Modifier</button>
                  {/* Supprimer un item : cible d'au moins 44 px, elle était à 24 px
                      juste à côté d'un bouton « Modifier » de 299 px. */}
                  <button onClick={() => supprimer(i)} aria-label="Supprimer l'item" className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-700 rounded">🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal création / édition */}
      {creerOuvert && (
        <Modale onClose={() => { setCreerOuvert(false); reset(); }} titre={editId ? "Modifier l'item" : "Nouvel item"} className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white rounded-t-2xl md:rounded-lg max-w-md w-full p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">{editId ? "✏️ Modifier" : "➕ Nouvel item"}</h3>
            <In label="Nom *" v={form.nom} o={(v) => setForm({ ...form, nom: v })} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Catégorie</label>
                <select value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  <option value="">—</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">📍 Emplacement</label>
                <select value={form.emplacement} onChange={(e) => setForm({ ...form, emplacement: e.target.value })} className="w-full px-3 py-2 border rounded text-sm bg-white">
                  {EMPLACEMENTS.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Quantité</label>
                {/* type="text" + inputMode : un champ number refuse « 2,5 » (virgule du clavier québécois). */}
                <input type="text" inputMode="decimal" value={form.quantite} onChange={(e) => setForm({ ...form, quantite: e.target.value })} placeholder="Ex. : 2,5" className="w-full px-3 py-2 border rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Unité</label>
                <input value={form.unite} onChange={(e) => setForm({ ...form, unite: e.target.value })} placeholder="u, pi², lb, ..." className="w-full px-3 py-2 border rounded text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Coût $/u</label>
                <input type="text" inputMode="decimal" value={form.cout_unit} onChange={(e) => setForm({ ...form, cout_unit: e.target.value })} placeholder="Ex. : 12,50" className="w-full px-3 py-2 border rounded text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">📸 Photo</label>
              <input type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); }} className="w-full text-xs" />
              {form.photo && <img src={form.photo.data} alt="" className="mt-2 w-32 h-32 object-cover rounded border" />}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border rounded text-sm" />
            </div>
            <div className="flex gap-2 justify-end pt-2 sticky bottom-0 bg-white">
              <button onClick={() => { setCreerOuvert(false); reset(); }} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm">Annuler</button>
              <button onClick={sauvegarder} disabled={verrou.occupe} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded text-sm font-bold">{verrou.occupe ? "…" : editId ? "Sauver" : "Créer"}</button>
            </div>
          </div>
        </Modale>
      )}
    </div>
  );
}

function In({ label, v, o }: { label: string; v: string; o: (v: string) => void }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="text" value={v} onChange={(e) => o(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}

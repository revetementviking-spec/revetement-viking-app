"use client";

import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";

export default function ParametresIaPage() {
  const [params, setParams] = useState<any[]>([]);
  const [modifies, setModifies] = useState<Record<string, string>>({});
  const [docs, setDocs] = useState<any[]>([]);
  const [uploadStatus, setUploadStatus] = useState("");
  const [onglet, setOnglet] = useState<"params" | "docs">("params");
  const { toast } = useToast();

  const chargerParams = () => fetch("/api/parametres-ia", { cache: "no-store" }).then((r) => r.json()).then(setParams);
  const chargerDocs = () => fetch("/api/documents-ia", { cache: "no-store" }).then((r) => r.json()).then(setDocs);
  useEffect(() => { chargerParams(); chargerDocs(); }, []);

  const sauvegarder = async () => {
    const items = Object.entries(modifies).map(([cle, valeur]) => ({ cle, valeur }));
    if (items.length === 0) { toast("Aucun changement", "info"); return; }
    const r = await fetch("/api/parametres-ia", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parametres: items }) });
    if (r.ok) { toast(`${items.length} paramètre(s) sauvé(s)`, "success"); setModifies({}); chargerParams(); }
  };

  const restaurerDefaut = async (cle: string) => {
    if (!confirm("Restaurer la valeur par défaut Viking pour ce paramètre ?")) return;
    await fetch(`/api/parametres-ia?reset=${cle}`, { method: "DELETE" }).catch(() => {});
    chargerParams();
  };

  const uploadDoc = async (file: File) => {
    setUploadStatus(`📤 Lecture de ${file.name}...`);
    const reader = new FileReader();
    reader.onload = async () => {
      const data = reader.result as string;
      setUploadStatus(`📤 Envoi de ${file.name} (${Math.round(file.size / 1024)} KB)...`);
      const r = await fetch("/api/documents-ia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom: file.name, type_mime: file.type, taille: file.size, data_b64: data }),
      });
      if (r.ok) { toast(`✓ ${file.name} ajouté`, "success"); chargerDocs(); }
      else toast("Erreur upload", "error");
      setUploadStatus("");
    };
    reader.readAsDataURL(file);
  };

  const supprimerDoc = async (id: number, nom: string) => {
    if (!confirm(`Supprimer "${nom}" ? L'IA ne s'en servira plus.`)) return;
    await fetch(`/api/documents-ia?id=${id}`, { method: "DELETE" });
    chargerDocs();
  };

  const toggleActif = async (d: any) => {
    await fetch("/api/documents-ia", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: d.id, actif: d.actif ? 0 : 1 }) });
    chargerDocs();
  };

  // Groupement des paramètres pour affichage
  const groupes: Record<string, string[]> = {
    "💰 Marges et profit": ["marge_plancher_pct", "frais_fixes_pct", "conditions_generales_pct", "profit_admin_pct"],
    "📦 Majorations matériaux (%)": ["majoration_maibec", "majoration_canexel", "majoration_vinyle", "majoration_quincaillerie", "majoration_membrane"],
    "⏱️ Main-d'œuvre & rendements": ["taux_mo_interne", "rendement_demolition", "rendement_pose_maibec", "rendement_pose_canexel", "rendement_soffite_fascia", "rendement_habillage"],
    "📋 Conditions soumission": ["acompte_signature_pct", "acompte_mi_projet_pct", "acompte_livraison_pct", "validite_soumission_jours"],
    "✏️ Règles libres": ["regles_libres"],
  };

  const paramParCle = new Map<string, any>();
  for (const p of params) paramParCle.set(p.cle, p);

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="🤖 Paramètres IA" soustitre="Règles métier + documents de référence pour les soumissions automatiques" actions={
        onglet === "params" && Object.keys(modifies).length > 0 ? (
          <button onClick={sauvegarder} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">💾 Sauver ({Object.keys(modifies).length})</button>
        ) : undefined
      } />

      <main className="max-w-4xl mx-auto p-3 md:p-4 space-y-4">

        <div className="bg-indigo-50 border border-indigo-200 rounded p-3 text-xs text-indigo-900">
          🤖 Ces paramètres sont injectés dans les prompts de l'auto-estimateur IA. Toutes les futures soumissions générées par IA respectent ces règles. Modifie-les ici pour ajuster le comportement sans toucher au code.
        </div>

        {/* Onglets */}
        <div className="flex gap-2 border-b">
          <button onClick={() => setOnglet("params")} className={`px-4 py-2 text-sm font-bold border-b-2 ${onglet === "params" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`}>⚙️ Paramètres ({params.length})</button>
          <button onClick={() => setOnglet("docs")} className={`px-4 py-2 text-sm font-bold border-b-2 ${onglet === "docs" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`}>📄 Documents de référence ({docs.length})</button>
        </div>

        {onglet === "params" && (
          <>
            {Object.entries(groupes).map(([titre, cles]) => (
              <section key={titre} className="bg-white rounded-lg shadow p-4 space-y-3">
                <h2 className="font-bold text-slate-900">{titre}</h2>
                <div className="space-y-3">
                  {cles.map((cle) => {
                    const p = paramParCle.get(cle);
                    if (!p) return null;
                    const valeur = modifies[cle] !== undefined ? modifies[cle] : p.valeur;
                    return (
                      <div key={cle} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start border-l-2 border-slate-100 pl-3">
                        <div className="md:col-span-1">
                          <label className="block text-sm font-semibold text-slate-800">{p.label}</label>
                          <p className="text-[11px] text-slate-500 mt-0.5">{p.description}</p>
                        </div>
                        <div className="md:col-span-2">
                          {p.type === "textarea" ? (
                            <textarea
                              rows={6}
                              value={valeur}
                              onChange={(e) => setModifies({ ...modifies, [cle]: e.target.value })}
                              placeholder="Ex: Toujours inclure démolition à 0.8 h/100pi². Marge plancher 30%. Maibec couleur premium +5%."
                              className="w-full px-3 py-2 border rounded text-sm"
                            />
                          ) : (
                            <div className="flex gap-2 items-center">
                              <input
                                type={p.type === "number" ? "number" : "text"}
                                step="any"
                                value={valeur}
                                onChange={(e) => setModifies({ ...modifies, [cle]: e.target.value })}
                                className="flex-1 px-3 py-2 border rounded text-sm font-mono"
                              />
                              {modifies[cle] !== undefined && modifies[cle] !== p.valeur && (
                                <span className="text-xs text-amber-700">● modifié</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        )}

        {onglet === "docs" && (
          <section className="space-y-3">
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="font-bold text-slate-900 mb-2">📤 Ajouter un document de référence</h2>
              <p className="text-xs text-slate-600 mb-3">Téléverse des PDF (listes de prix fournisseurs, brochures Maibec/Canexel), Excel (catalogues), photos de référence. L'IA pourra les consulter lors de la génération des soumissions.</p>
              <input
                type="file"
                accept=".pdf,.xlsx,.xls,.csv,image/*"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(f); }}
                className="text-sm"
              />
              {uploadStatus && <p className="text-xs text-indigo-700 mt-2">{uploadStatus}</p>}
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              {docs.length === 0 ? (
                <div className="p-8 text-center text-slate-400 italic">
                  Aucun document. Téléverse ton premier PDF/Excel ci-dessus.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr className="text-left">
                      <th className="p-2">Nom</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Taille</th>
                      <th className="p-2">Ajouté</th>
                      <th className="p-2">Actif</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {docs.map((d) => (
                      <tr key={d.id} className={`border-t ${d.actif ? "" : "opacity-50"}`}>
                        <td className="p-2 font-semibold">
                          <a href={`/api/documents-ia/${d.id}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{d.nom}</a>
                        </td>
                        <td className="p-2 text-xs text-slate-500">{d.type_mime?.split("/")[1] || "—"}</td>
                        <td className="p-2 text-xs">{d.taille ? `${Math.round(d.taille / 1024)} KB` : "—"}</td>
                        <td className="p-2 text-xs text-slate-500">
                          {d.par || "?"} · {new Date(d.date_creation).toLocaleDateString("fr-CA", { day: "numeric", month: "short" })}
                        </td>
                        <td className="p-2">
                          <button onClick={() => toggleActif(d)} className={`text-xs px-2 py-1 rounded font-bold ${d.actif ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                            {d.actif ? "✓ Actif" : "✗ Inactif"}
                          </button>
                        </td>
                        <td className="p-2 text-right">
                          <button onClick={() => supprimerDoc(d.id, d.nom)} className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded">🗑</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
              💡 <strong>Comment l'IA utilise ces documents</strong> : à chaque génération d'auto-estimateur, l'IA voit la liste des documents actifs. Pour les PDF/Excel volumineux, elle ne lit que les passages pertinents (extraits texte). Tu peux désactiver temporairement un document (bouton ✗) sans le supprimer.
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

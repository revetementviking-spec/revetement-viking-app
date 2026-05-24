"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";

const STATUTS_LABEL: Record<string, string> = {
  actif: "Actif",
  en_pause: "En pause",
  complete: "Complété",
  annule: "Annulé",
};

const CAT_DEPENSES = ["matériaux", "outils", "location équipement", "sous-traitant", "transport", "permis", "essence", "autre"];

async function telechargerFeuilleTemps(projet: any) {
  const r = await fetch(`/api/rapports?projet_id=${projet.id}`);
  const lignes = await r.json();
  const { genererFeuilleTempsBlob } = await import("@/lib/pdf-feuille-temps");
  const blob = await genererFeuilleTempsBlob({ projet, lignes });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `Feuille-temps-${projet.nom.replace(/[^a-z0-9]/gi, "_")}.pdf`; a.click();
  URL.revokeObjectURL(url);
}

function envoyerFactureEmail(projet: any, facture: any) {
  const sujet = `Facture ${facture.numero || ""} - ${projet.nom}`;
  const corps = `Bonjour ${projet.client_nom || ""},

Voici la facture pour les travaux ${projet.nom}${projet.adresse_chantier ? ` au ${projet.adresse_chantier}` : ""}.

Montant : ${facture.montant} $
Date : ${facture.date}
${facture.description ? "Description : " + facture.description + "\n" : ""}
Merci de votre confiance.

Cordialement,
Revêtement Viking Inc.
RBQ 5811-4299-01
info@entreprisesxpress.ca`;
  window.location.href = `mailto:?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
}

export default function ProjetDetail() {
  const params = useParams();
  const router = useRouter();
  const id = +(params.id as string);
  const { toast } = useToast();

  const [projet, setProjet] = useState<any>(null);
  const [heures, setHeures] = useState<any[]>([]);
  const [factures, setFactures] = useState<any[]>([]);
  const [depenses, setDepenses] = useState<any[]>([]);
  const [onglet, setOnglet] = useState<"heures" | "factures" | "depenses">("heures");

  // Forms
  const today = new Date().toISOString().slice(0, 10);
  const [hForm, setHForm] = useState({ date: today, heures: "", description: "", employe: "Frédéric", taux_horaire: "90" });
  const [fForm, setFForm] = useState({ numero: "", montant: "", date: today, description: "" });
  const [dForm, setDForm] = useState({ date: today, montant: "", fournisseur: "", description: "", categorie: "matériaux" });

  const charger = async () => {
    const [p, h, f, d] = await Promise.all([
      fetch(`/api/projets?id=${id}`).then((r) => r.json()),
      fetch(`/api/heures?projet_id=${id}`).then((r) => r.json()),
      fetch(`/api/factures?projet_id=${id}`).then((r) => r.json()),
      fetch(`/api/depenses?projet_id=${id}`).then((r) => r.json()),
    ]);
    setProjet(p);
    setHeures(h);
    setFactures(f);
    setDepenses(d);
  };

  useEffect(() => { charger(); }, [id]);

  const ajouterHeures = async () => {
    if (!hForm.heures) { toast("Heures requises", "warning"); return; }
    const r = await fetch("/api/heures", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projet_id: id, date: hForm.date, heures: +hForm.heures, description: hForm.description, employe: hForm.employe, taux_horaire: +hForm.taux_horaire }),
    });
    if ((await r.json()).ok) {
      toast(`${hForm.heures} h ajoutées`, "success");
      setHForm({ ...hForm, heures: "", description: "" });
      charger();
    }
  };

  const ajouterFacture = async () => {
    if (!fForm.montant) { toast("Montant requis", "warning"); return; }
    const r = await fetch("/api/factures", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projet_id: id, numero: fForm.numero, montant: +fForm.montant, date: fForm.date, description: fForm.description }),
    });
    if ((await r.json()).ok) {
      toast(`Facture ${formatCAD(+fForm.montant)} ajoutée`, "success");
      setFForm({ numero: "", montant: "", date: today, description: "" });
      charger();
    }
  };

  const ajouterDepense = async () => {
    if (!dForm.montant) { toast("Montant requis", "warning"); return; }
    const r = await fetch("/api/depenses", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projet_id: id, date: dForm.date, montant: +dForm.montant, fournisseur: dForm.fournisseur, description: dForm.description, categorie: dForm.categorie }),
    });
    if ((await r.json()).ok) {
      toast(`Dépense ${formatCAD(+dForm.montant)} ajoutée`, "success");
      setDForm({ date: today, montant: "", fournisseur: "", description: "", categorie: "matériaux" });
      charger();
    }
  };

  const supprimer = async (type: string, ligneId: number) => {
    if (!confirm("Supprimer cette entrée ?")) return;
    await fetch(`/api/${type}?id=${ligneId}`, { method: "DELETE" });
    charger();
  };

  const marquerPayee = async (factureId: number) => {
    await fetch("/api/factures", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "marquer_payee", id: factureId }) });
    toast("Facture marquée payée", "success");
    charger();
  };

  const changerStatut = async (nouveauStatut: string) => {
    await fetch("/api/projets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, statut: nouveauStatut }) });
    toast(`Statut → ${STATUTS_LABEL[nouveauStatut]}`, "success");
    charger();
  };

  if (!projet) return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre="Projet" />
      <div className="p-12 text-center text-slate-500">Chargement...</div>
    </div>
  );

  const restantBudget = (projet.revenu || projet.budget_estime || 0) - projet.cout_total;
  const aFacturer = projet.budget_estime - projet.total_facture;
  const aRecevoir = projet.total_facture - projet.total_paye;

  return (
    <div className="min-h-screen bg-slate-50">
      <Navigation titre={`🏗️ ${projet.nom}`} soustitre={`${projet.client_nom || "Sans client"}${projet.adresse_chantier ? ` · ${projet.adresse_chantier}` : ""}`} />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">

        {/* Statut + lien soumission */}
        <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm text-slate-600">Statut :</label>
            <select value={projet.statut} onChange={(e) => changerStatut(e.target.value)} className="px-3 py-1 border rounded text-sm">
              {Object.entries(STATUTS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {projet.soumission_numero && (
              <a href={`/soumissions/nouveau?modifier=${projet.soumission_numero}`} className="text-xs px-3 py-1 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded font-semibold">📄 Voir soumission {projet.soumission_numero}</a>
            )}
            <button onClick={() => telechargerFeuilleTemps(projet)} className="text-xs px-3 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded font-semibold">⏱️ Feuille de temps PDF</button>
            <a href={`/api/rapports?projet_id=${id}&format=csv`} className="text-xs px-3 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded font-semibold">📊 Export CSV</a>
          </div>
          {projet.date_debut && <span className="text-xs text-slate-500">Démarré : {new Date(projet.date_debut).toLocaleDateString("fr-CA")}</span>}
        </div>

        {/* RENTABILITÉ TEMPS RÉEL */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-lg p-5 shadow-lg">
          <h2 className="text-sm font-semibold text-slate-300 uppercase mb-3">💰 Rentabilité temps réel</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={projet.prix_contrat ? "Prix contrat" : "Budget initial"} value={formatCAD(projet.revenu || 0)} sub={projet.prix_contrat && projet.budget_estime && projet.prix_contrat !== projet.budget_estime ? `Budget est. : ${formatCAD(projet.budget_estime)}` : ""} />
            <Stat label="Coût réel" value={formatCAD(projet.cout_total)} couleur={projet.cout_total > (projet.revenu || 0) ? "text-red-300" : "text-amber-200"} />
            <Stat label="Marge brute" value={formatCAD(projet.marge)} couleur={projet.marge < 0 ? "text-red-300" : "text-emerald-300"} sub={`${projet.marge_pct.toFixed(0)}%`} />
            <Stat label="Restant" value={formatCAD((projet.revenu || 0) - projet.cout_total)} couleur={(projet.revenu || 0) - projet.cout_total < 0 ? "text-red-300" : "text-slate-200"} />
          </div>

          {projet.budget_estime > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-xs mb-1">
                <span>Budget consommé</span>
                <span className="font-bold">{projet.pct_budget_consomme.toFixed(1)}%</span>
              </div>
              <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
                <div className={`h-full transition-all ${projet.pct_budget_consomme > 100 ? "bg-red-500" : projet.pct_budget_consomme > 90 ? "bg-amber-500" : projet.pct_budget_consomme > 75 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, projet.pct_budget_consomme)}%` }} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-700 text-sm">
            <Stat label="Heures travaillées" value={`${projet.total_heures.toFixed(1)} h`} sub={projet.heures_estimees ? `/ ${projet.heures_estimees.toFixed(0)} h estimées` : ""} />
            <Stat label="MO ($)" value={formatCAD(projet.cout_main_oeuvre)} />
            <Stat label="Dépenses" value={formatCAD(projet.total_depenses)} />
            <Stat label="Facturé / Payé" value={`${formatCAD(projet.total_facture)} / ${formatCAD(projet.total_paye)}`} sub={aRecevoir > 0 ? `À recevoir : ${formatCAD(aRecevoir)}` : ""} />
          </div>
        </div>

        {/* CONTRAT + FACTURE FINALE */}
        <ContratFactureSection projet={projet} onUpdate={charger} />


        {/* Onglets */}
        <div className="flex gap-2 border-b">
          {(["heures", "factures", "depenses"] as const).map((o) => (
            <button key={o} onClick={() => setOnglet(o)} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${onglet === o ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              {o === "heures" ? `⏱️ Heures (${heures.length})` : o === "factures" ? `🧾 Factures (${factures.length})` : `💸 Dépenses (${depenses.length})`}
            </button>
          ))}
        </div>

        {/* ONGLET HEURES */}
        {onglet === "heures" && (
          <div className="space-y-3">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">⏱️ Saisir des heures</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <FieldDate label="Date" value={hForm.date} onChange={(v) => setHForm({ ...hForm, date: v })} />
                <FieldNum label="Heures *" value={hForm.heures} onChange={(v) => setHForm({ ...hForm, heures: v })} step={0.5} />
                <Field label="Employé" value={hForm.employe} onChange={(v) => setHForm({ ...hForm, employe: v })} />
                <FieldNum label="Taux $/h" value={hForm.taux_horaire} onChange={(v) => setHForm({ ...hForm, taux_horaire: v })} />
                <div className="flex items-end"><button onClick={ajouterHeures} className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold">＋ Ajouter</button></div>
              </div>
              <div className="mt-2">
                <Field label="Description" value={hForm.description} onChange={(v) => setHForm({ ...hForm, description: v })} placeholder="Ex: pose soffite côté est" />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              {heures.length === 0 ? (
                <p className="p-6 text-center text-slate-500 text-sm">Aucune heure saisie</p>
              ) : (
                <div className="divide-y">
                  {heures.map((h) => (
                    <div key={h.id} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-semibold">{new Date(h.date).toLocaleDateString("fr-CA")}</span>
                          <span className="text-emerald-700 font-bold">{h.heures} h</span>
                          {h.employe && <span className="text-xs text-slate-500">· {h.employe}</span>}
                          <span className="text-xs text-slate-500">· {h.taux_horaire}$/h</span>
                        </div>
                        {h.description && <div className="text-xs text-slate-600 mt-0.5 truncate">{h.description}</div>}
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{formatCAD(h.heures * h.taux_horaire)}</div>
                        <button onClick={() => supprimer("heures", h.id)} className="text-xs text-red-600 hover:underline">Supprimer</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ONGLET FACTURES */}
        {onglet === "factures" && (
          <div className="space-y-3">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">🧾 Ajouter une facture</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <Field label="N° facture" value={fForm.numero} onChange={(v) => setFForm({ ...fForm, numero: v })} placeholder="auto" />
                <FieldDate label="Date" value={fForm.date} onChange={(v) => setFForm({ ...fForm, date: v })} />
                <FieldNum label="Montant *" value={fForm.montant} onChange={(v) => setFForm({ ...fForm, montant: v })} />
                <div className="md:col-span-2 flex items-end gap-2">
                  <div className="flex-1"><Field label="Description" value={fForm.description} onChange={(v) => setFForm({ ...fForm, description: v })} placeholder="Ex: acompte 30%" /></div>
                  <button onClick={ajouterFacture} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-semibold whitespace-nowrap">＋ Ajouter</button>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              {factures.length === 0 ? (
                <p className="p-6 text-center text-slate-500 text-sm">Aucune facture</p>
              ) : (
                <div className="divide-y">
                  {factures.map((f) => (
                    <div key={f.id} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          <span className="font-mono text-xs text-slate-500">{f.numero || `#${f.id}`}</span>
                          <span className="font-semibold">{new Date(f.date).toLocaleDateString("fr-CA")}</span>
                          {f.payee ? <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">✓ Payée {f.date_paiement ? `(${new Date(f.date_paiement).toLocaleDateString("fr-CA")})` : ""}</span> : <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">À payer</span>}
                        </div>
                        {f.description && <div className="text-xs text-slate-600 mt-0.5 truncate">{f.description}</div>}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className="font-bold text-blue-700">{formatCAD(f.montant)}</div>
                        <div className="flex gap-1">
                          <button onClick={() => envoyerFactureEmail(projet, f)} className="text-xs text-blue-600 hover:underline">✉️ Envoyer</button>
                          {!f.payee && <button onClick={() => marquerPayee(f.id)} className="text-xs text-emerald-600 hover:underline">Payée</button>}
                          <button onClick={() => supprimer("factures", f.id)} className="text-xs text-red-600 hover:underline">✕</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ONGLET DÉPENSES */}
        {onglet === "depenses" && (
          <div className="space-y-3">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">💸 Ajouter une dépense</h3>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <FieldDate label="Date" value={dForm.date} onChange={(v) => setDForm({ ...dForm, date: v })} />
                <FieldNum label="Montant *" value={dForm.montant} onChange={(v) => setDForm({ ...dForm, montant: v })} />
                <Field label="Fournisseur" value={dForm.fournisseur} onChange={(v) => setDForm({ ...dForm, fournisseur: v })} placeholder="Gentek, MAC..." />
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Catégorie</label>
                  <select value={dForm.categorie} onChange={(e) => setDForm({ ...dForm, categorie: e.target.value })} className="w-full px-3 py-2 border rounded text-sm">
                    {CAT_DEPENSES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex items-end"><button onClick={ajouterDepense} className="w-full px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded text-sm font-semibold">＋ Ajouter</button></div>
              </div>
              <div className="mt-2">
                <Field label="Description" value={dForm.description} onChange={(v) => setDForm({ ...dForm, description: v })} placeholder="Détails..." />
              </div>
            </div>

            <div className="bg-white rounded-lg shadow overflow-hidden">
              {depenses.length === 0 ? (
                <p className="p-6 text-center text-slate-500 text-sm">Aucune dépense</p>
              ) : (
                <div className="divide-y">
                  {depenses.map((d) => (
                    <div key={d.id} className="p-3 flex items-center justify-between gap-2 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          <span className="font-semibold">{new Date(d.date).toLocaleDateString("fr-CA")}</span>
                          {d.fournisseur && <span className="text-xs bg-slate-100 px-2 py-0.5 rounded">{d.fournisseur}</span>}
                          {d.categorie && <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded">{d.categorie}</span>}
                          {d.recu_data && (
                            <button onClick={() => {
                              const w = window.open();
                              if (w) {
                                if (d.recu_type?.startsWith("image/")) w.document.write(`<img src="${d.recu_data}" style="max-width:100%" />`);
                                else w.location.href = d.recu_data;
                              }
                            }} className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded hover:bg-emerald-200">📎 Reçu</button>
                          )}
                        </div>
                        {d.description && <div className="text-xs text-slate-600 mt-0.5 truncate">{d.description}</div>}
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-orange-700">{formatCAD(d.montant)}</div>
                        <button onClick={() => supprimer("depenses", d.id)} className="text-xs text-red-600 hover:underline">Supprimer</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ContratFactureSection({ projet, onUpdate }: { projet: any; onUpdate: () => void }) {
  const [edit, setEdit] = useState(false);
  const [prix, setPrix] = useState(projet.prix_contrat ? String(projet.prix_contrat) : "");
  const sauver = async () => {
    const valeur = prix ? +prix : null;
    // Sync les deux champs pour que toutes les pages (liste, détail, finances) reflètent le changement
    await fetch("/api/projets", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projet.id, prix_contrat: valeur, budget_estime: valeur }),
    });
    setEdit(false);
    onUpdate();
  };
  const uploadFacture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Fichier > 5 MB"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      await fetch("/api/projets", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projet.id, facture_finale_data: reader.result, facture_finale_type: file.type }),
      });
      onUpdate();
    };
    reader.readAsDataURL(file);
  };
  return (
    <section className="bg-white rounded-lg shadow p-4 md:p-5 space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="font-bold">📄 Contrat & Facture finale</h2>
        {!edit && <button onClick={() => setEdit(true)} className="text-xs text-emerald-700 hover:underline">✏️ Modifier</button>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Prix total du contrat</div>
          {edit ? (
            <div className="flex gap-2">
              <input type="number" value={prix} onChange={(e) => setPrix(e.target.value)} placeholder="Ex: 51738.75" className="flex-1 px-3 py-2 border rounded text-sm text-right" />
              <button onClick={sauver} className="px-3 py-2 bg-emerald-600 text-white rounded text-sm font-bold">✓</button>
              <button onClick={() => { setEdit(false); setPrix(projet.prix_contrat ? String(projet.prix_contrat) : ""); }} className="px-3 py-2 bg-slate-200 rounded text-sm">✕</button>
            </div>
          ) : (
            <div className="text-2xl font-bold text-emerald-700">{projet.prix_contrat ? formatCAD(projet.prix_contrat) : <span className="text-slate-400 text-sm font-normal italic">Non défini</span>}</div>
          )}
        </div>
        <div>
          <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Facture finale</div>
          {projet.facture_finale_data ? (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded p-2">
              {projet.facture_finale_type?.startsWith("image/") ? (
                <img src={projet.facture_finale_data} alt="Facture" className="w-12 h-12 object-cover rounded" />
              ) : (
                <div className="w-12 h-12 bg-slate-200 rounded flex items-center justify-center text-2xl">📄</div>
              )}
              <button onClick={() => {
                const w = window.open();
                if (w) {
                  if (projet.facture_finale_type?.startsWith("image/")) w.document.write(`<img src="${projet.facture_finale_data}" style="max-width:100%" />`);
                  else w.location.href = projet.facture_finale_data;
                }
              }} className="flex-1 text-left text-sm text-emerald-700 hover:underline font-semibold">📎 Ouvrir la facture</button>
              <label className="cursor-pointer text-xs text-blue-600 hover:underline">
                Remplacer
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={uploadFacture} />
              </label>
            </div>
          ) : (
            <label className="cursor-pointer bg-white border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 rounded p-3 text-center transition flex items-center justify-center gap-2 text-sm font-semibold text-slate-700">
              📎 Joindre PDF ou photo
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={uploadFacture} />
            </label>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub, couleur }: { label: string; value: any; sub?: string; couleur?: string }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400 uppercase tracking-wide">{label}</div>
      <div className={`text-xl md:text-2xl font-bold ${couleur || "text-white"}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}
function FieldNum({ label, value, onChange, step = 1 }: { label: string; value: string; onChange: (v: string) => void; step?: number }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border rounded text-sm text-right" /></div>;
}
function FieldDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}

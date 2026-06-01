"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { formatCAD } from "@/lib/calculateur";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";
import Lightbox from "@/components/Lightbox";
import { getProjetPrefetch, setProjetPrefetch } from "@/lib/prefetchProjet";
import MeteoProjet from "@/components/MeteoProjet";

const STATUTS_LABEL: Record<string, string> = {
  en_cours: "🟢 En cours",
  a_venir: "🟣 À venir",
  actif: "🔵 Actif",
  en_pause: "🟡 En pause",
  complete: "✅ Complété",
  annule: "❌ Annulé",
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

export default function ProjetDetail() {
  const params = useParams();
  const router = useRouter();
  const id = +(params.id as string);
  const { toast } = useToast();

  // Affichage instantané si les données ont été préchargées au survol/toucher de la carte
  const seed = typeof window !== "undefined" ? getProjetPrefetch(id) : null;
  const [projet, setProjet] = useState<any>(seed?.projet || null);
  const [heures, setHeures] = useState<any[]>(seed?.heures || []);
  const [depenses, setDepenses] = useState<any[]>(seed?.depenses || []);
  const [photos, setPhotos] = useState<any[]>(seed?.photos || []);
  const [onglet, setOnglet] = useState<"heures" | "depenses" | "photos" | "description">("heures");

  // Forms
  const today = new Date().toISOString().slice(0, 10);
  const [hForm, setHForm] = useState({ date: today, heures: "", description: "", employe: "", taux_horaire: "" });
  const [employes, setEmployes] = useState<any[]>([]);
  const [hFiltreEmp, setHFiltreEmp] = useState("");
  const [hTri, setHTri] = useState<"date_desc" | "date_asc" | "heures_desc" | "heures_asc" | "employe">("date_desc");
  // === Vue semaine pour onglet heures (style horaire global) ===
  const [vueH, setVueH] = useState<"semaine" | "liste">("semaine");
  const [semaineDebutH, setSemaineDebutH] = useState<Date>(() => {
    const d = new Date(); const jour = d.getDay(); const diff = jour === 0 ? -6 : 1 - jour;
    d.setDate(d.getDate() + diff); d.setHours(0, 0, 0, 0); return d;
  });
  const [selectionH, setSelectionH] = useState<Set<number>>(new Set());
  const [coutDetail, setCoutDetail] = useState(false);
  const [lightboxId, setLightboxId] = useState<number | null>(null);
  const [resumeIa, setResumeIa] = useState<string | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);

  const genererResumeIa = async () => {
    setResumeBusy(true);
    try {
      const r = await fetch(`/api/projets/${id}/resume-ia`, { method: "POST" });
      const d = await r.json();
      if (d.ok) setResumeIa(d.resume);
      else toast("IA : " + (d.error || "erreur"), "error");
    } finally { setResumeBusy(false); }
  };
  const [hRecherche, setHRecherche] = useState("");
  const [hPeriode, setHPeriode] = useState<string>(""); // "" = toutes, ou "YYYY-MM-DD|YYYY-MM-DD"
  const [dForm, setDForm] = useState({ date: today, montant: "", fournisseur: "", description: "", categorie: "matériaux" });

  const charger = async () => {
    // 1 seul aller-retour combiné (projet + heures + dépenses + photos)
    try {
      const r = await fetch(`/api/projets/${id}/full`, { cache: "no-store" });
      const d = await r.json();
      setProjet(d.projet);
      setHeures(d.heures || []);
      setDepenses(d.depenses || []);
      setPhotos(d.photos || []);
      setProjetPrefetch(id, d); // garde le cache à jour pour les retours rapides
    } catch {
      // Repli : anciennes requêtes séparées si l'endpoint combiné échoue
      const noStore = { cache: "no-store" as RequestCache };
      const [p, h, dep, ph] = await Promise.all([
        fetch(`/api/projets?id=${id}`, noStore).then((r) => r.json()),
        fetch(`/api/heures?projet_id=${id}`, noStore).then((r) => r.json()),
        fetch(`/api/depenses?projet_id=${id}`, noStore).then((r) => r.json()),
        fetch(`/api/photos?projet_id=${id}&data=0`, noStore).then((r) => r.json()).catch(() => []),
      ]);
      setProjet(p); setHeures(h); setDepenses(dep); setPhotos(ph);
    }
  };

  useEffect(() => {
    charger();
    fetch("/api/employes").then((r) => r.json()).then(setEmployes);
  }, [id]);

  const ajouterHeures = async () => {
    if (!hForm.heures) { toast("Heures requises", "warning"); return; }
    if (!hForm.employe) { toast("Sélectionne un employé", "warning"); return; }
    if (!hForm.taux_horaire) { toast("Taux horaire manquant", "warning"); return; }
    const r = await fetch("/api/heures", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projet_id: id, date: hForm.date, heures: +hForm.heures, description: hForm.description, employe: hForm.employe, taux_horaire: +hForm.taux_horaire }),
    });
    if ((await r.json()).ok) {
      toast(`${hForm.heures} h ajoutées pour ${hForm.employe}`, "success");
      setHForm({ ...hForm, heures: "", description: "" });
      charger();
      // Suggestion photo : si >2h saisies aujourd'hui et 0 photo du jour → propose
      setTimeout(() => {
        const today = new Date().toISOString().slice(0, 10);
        const totalToday = heures.filter((h: any) => h.date === today).reduce((s: number, h: any) => s + (h.heures || 0), 0) + (+hForm.heures || 0);
        const photosToday = photos.filter((p: any) => p.date === today).length;
        if (totalToday >= 2 && photosToday === 0) {
          toast(`📸 ${totalToday.toFixed(1)}h saisies aujourd'hui sans photo — pense à en prendre quelques-unes du chantier !`, "info");
        }
      }, 600);
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

  const envoyerDemandeReview = (courriel: string, nomClient?: string) => {
    const VIKING_EMAIL = "revetementviking@gmail.com";
    const prenom = (nomClient || "").trim().split(/\s+/)[0]; // premier mot du nom client
    const sujet = "Travaux complétés — Revêtement Viking Inc.";
    const corps = `Bonjour${prenom ? " " + prenom : ""},

Les travaux sont maintenant complets.

Si vous avez apprécié notre service vous pouvez nous laisser un avis sur notre page, c'est toujours grandement apprécié.

Voici le lien : https://g.page/r/CY_Ub0jeQKebEB0/review

Page Google : Revêtement Viking Inc.

Au plaisir de refaire affaire avec vous dans le futur.

Cordialement,

Revêtement Viking Inc.
${VIKING_EMAIL}
(438) 493-2041`;
    // from/reply-to vers le courriel Viking (le client peut répondre directement)
    window.location.href = `mailto:${courriel}?from=${encodeURIComponent(VIKING_EMAIL)}&reply-to=${encodeURIComponent(VIKING_EMAIL)}&subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
  };

  const changerStatut = async (nouveauStatut: string) => {
    await fetch("/api/projets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, statut: nouveauStatut }) });
    toast(`Statut → ${STATUTS_LABEL[nouveauStatut]}`, "success");
    // Projet complété → envoi du courriel de demande d'avis Google
    if (nouveauStatut === "complete") {
      const courriel = projet?.client_courriel;
      if (courriel) {
        if (confirm(`Projet complété ✅\n\nEnvoyer un courriel de demande d'avis Google à ${courriel} ?`)) {
          // 1. Tente l'envoi serveur automatique (Gmail SMTP)
          let envoye = false;
          try {
            const r = await fetch("/api/email/review", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ projet_id: id }),
            }).then((x) => x.json());
            if (r.ok) { toast(`✓ Courriel d'avis envoyé à ${courriel}`, "success"); envoye = true; }
          } catch {}
          // 2. Sinon (SMTP non configuré) → ouvre le client mail pré-rempli
          if (!envoye) envoyerDemandeReview(courriel, projet?.client_nom);
        }
      } else {
        toast("Projet complété. Aucun courriel client enregistré pour la demande d'avis.", "info");
      }
    }
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
      <Navigation titre={`🏗️ ${projet.nom}`} soustitre={`${projet.numero ? projet.numero + " · " : ""}${projet.client_nom || ""}`} />

      <main className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">

        {/* 📌 INFOS PROJET + CLIENT EN TÊTE */}
        <section className="bg-gradient-to-br from-slate-100 to-white border-2 border-slate-200 rounded-lg p-4 md:p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Chantier */}
            <div>
              <div className="text-xs uppercase font-bold text-slate-500 mb-1">📍 Chantier</div>
              <div className="text-lg font-bold text-slate-900">{projet.adresse_chantier || <span className="text-slate-400 italic font-normal">Aucune adresse</span>}</div>
              {projet.adresse_chantier && (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(projet.adresse_chantier)}`} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">📍 Ouvrir dans Google Maps →</a>
              )}
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">📅 Date de début</label>
                  <input
                    type="date"
                    value={projet.date_debut || ""}
                    onChange={async (e) => {
                      const v = e.target.value;
                      const r = await fetch("/api/projets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: projet.id, date_debut: v }) });
                      if (r.ok) { toast("Date de début mise à jour", "success"); charger(); }
                    }}
                    className="w-full px-2 py-1 border rounded text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[10px] uppercase font-bold text-slate-500 mb-0.5">🏁 Fin prévue</label>
                  <input
                    type="date"
                    value={projet.date_fin_prevue || ""}
                    onChange={async (e) => {
                      const v = e.target.value;
                      const r = await fetch("/api/projets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: projet.id, date_fin_prevue: v }) });
                      if (r.ok) { toast("Date de fin mise à jour", "success"); charger(); }
                    }}
                    className="w-full px-2 py-1 border rounded text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Client */}
            <div className="border-t md:border-t-0 md:border-l border-slate-200 md:pl-4 pt-3 md:pt-0">
              <div className="text-xs uppercase font-bold text-slate-500 mb-1">👤 Client</div>
              {projet.client_id ? (
                <a href={`/clients/${projet.client_id}`} className="text-lg font-bold text-slate-900 hover:underline">{projet.client_nom || "—"}</a>
              ) : (
                <div className="text-lg font-bold text-slate-900">{projet.client_nom || "Sans client"}</div>
              )}
              <ClientInfo client_id={projet.client_id} />
            </div>
          </div>
        </section>

        {/* Statut + lien soumission */}
        <div className="bg-white rounded-lg shadow p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm text-slate-600">Statut :</label>
            <select value={projet.statut} onChange={(e) => changerStatut(e.target.value)} className="px-3 py-1 border rounded text-sm">
              {Object.entries(STATUTS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {/* Boutons d'action rapide selon le statut */}
            {projet.statut === "a_venir" && (
              <button onClick={() => changerStatut("en_cours")} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold active:scale-95 transition" title="Démarrer le chantier maintenant">
                🟢 Commencer ce chantier
              </button>
            )}
            {projet.statut === "en_cours" && (
              <>
                <button onClick={() => changerStatut("en_pause")} className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded text-sm font-bold" title="Mettre en pause temporairement">
                  ⏸️ Mettre en pause
                </button>
                <button onClick={() => { if (confirm("Marquer ce chantier comme COMPLÉTÉ ?")) changerStatut("complete"); }} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm font-bold active:scale-95 transition" title="Marquer le chantier comme terminé">
                  ✅ Marquer complété
                </button>
              </>
            )}
            {projet.statut === "en_pause" && (
              <button onClick={() => changerStatut("en_cours")} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold active:scale-95 transition" title="Reprendre le chantier">
                ▶️ Reprendre le chantier
              </button>
            )}
            {projet.soumission_numero && (
              <a href={`/soumissions/nouveau?modifier=${projet.soumission_numero}`} className="text-xs px-3 py-1 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded font-semibold">📄 Voir soumission {projet.soumission_numero}</a>
            )}
            <button onClick={genererResumeIa} disabled={resumeBusy} className="text-xs px-3 py-1 bg-indigo-100 text-indigo-700 hover:bg-indigo-200 disabled:opacity-50 rounded font-semibold" title="Résumé automatique du chantier par IA">🤖 {resumeBusy ? "Analyse…" : "Résumé IA"}</button>
            <button
              onClick={async () => {
                if (!confirm(`Supprimer définitivement le projet « ${projet.nom} » ?\n\n⚠️ Cette action est irréversible. Les heures, dépenses, photos et contrats liés deviendront orphelins.`)) return;
                const r = await fetch(`/api/projets?id=${id}`, { method: "DELETE" });
                if (r.ok) { toast(`Projet « ${projet.nom} » supprimé`, "success"); router.push("/projets"); }
                else toast("Erreur suppression", "error");
              }}
              className="text-xs px-3 py-1 bg-red-100 text-red-700 hover:bg-red-200 rounded font-semibold"
              title="Supprimer le projet définitivement"
            >🗑 Supprimer</button>
            <button onClick={() => telechargerFeuilleTemps(projet)} className="text-xs px-3 py-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded font-semibold">⏱️ Feuille de temps PDF</button>
            <a href={`/api/rapports?projet_id=${id}&format=csv`} className="text-xs px-3 py-1 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded font-semibold">📊 Export CSV</a>
            {projet.reno_assistance ? (
              <span className="text-xs px-3 py-1 rounded-full font-bold bg-amber-100 text-amber-900 border border-amber-300 inline-flex items-center gap-2" title="Dossier subvention / aide à la rénovation">
                🛠️ Reno assistance
                <button
                  onClick={async () => {
                    if (!confirm("Retirer le badge « Reno assistance » de ce projet ?")) return;
                    const r = await fetch("/api/projets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: projet.id, reno_assistance: 0 }) });
                    if (r.ok) { toast("Badge retiré", "success"); charger(); }
                    else toast("Erreur", "error");
                  }}
                  className="ml-1 text-amber-900 hover:text-red-700 font-bold leading-none"
                  title="Retirer le badge Reno assistance"
                  aria-label="Retirer"
                >×</button>
              </span>
            ) : null}
          </div>
          {projet.date_debut && <span className="text-xs text-slate-500">Démarré : {new Date(projet.date_debut).toLocaleDateString("fr-CA")}</span>}
        </div>

        {/* NOTES RAPIDES (vocales) */}
        <NotesRapidesProjet projet_id={projet.id} />

        {/* RÉSUMÉ IA */}
        {resumeIa && (
          <div className="bg-indigo-50 border-2 border-indigo-300 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-indigo-900">🤖 Résumé IA du chantier</h3>
              <div className="flex gap-2">
                <button onClick={() => { navigator.clipboard.writeText(resumeIa).then(() => toast("Copié", "success")); }} className="text-xs text-indigo-700 hover:underline">📋 Copier</button>
                <button onClick={() => setResumeIa(null)} className="text-xs text-slate-500 hover:underline">Fermer</button>
              </div>
            </div>
            <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans">{resumeIa}</pre>
          </div>
        )}

        {/* MÉTÉO 5 JOURS au chantier */}
        {projet.adresse_chantier && projet.statut === "actif" && <MeteoProjet adresse={projet.adresse_chantier} />}

        {/* ALERTE DÉPASSEMENT BUDGET */}
        {projet.budget_estime > 0 && projet.pct_budget_consomme >= 90 && (
          <div className={`rounded-lg p-3 border-2 ${projet.pct_budget_consomme >= 100 ? "bg-red-50 border-red-400 text-red-900" : "bg-amber-50 border-amber-400 text-amber-900"} flex items-center gap-3`}>
            <span className="text-2xl">{projet.pct_budget_consomme >= 100 ? "🚨" : "⚠️"}</span>
            <div className="flex-1 text-sm">
              <strong>{projet.pct_budget_consomme >= 100 ? "Budget DÉPASSÉ" : "Budget presque atteint"}</strong> —
              {" "}<strong>{projet.pct_budget_consomme.toFixed(0)}%</strong> du budget consommé ({formatCAD(projet.cout_total)} sur {formatCAD(projet.budget_estime)})
              {projet.pct_budget_consomme >= 100 && <span> · Déficit : <strong>{formatCAD(projet.cout_total - projet.budget_estime)}</strong></span>}
            </div>
          </div>
        )}

        {/* RENTABILITÉ TEMPS RÉEL — inclut 15% frais fixes structurels (admin/véhicules/assurance/loyer) */}
        {(() => {
          const revenu = projet.revenu || 0;
          const fraisFixes = Math.round(revenu * 0.15);
          const coutTotalAvecFixes = projet.cout_total + fraisFixes;
          const margeReelle = revenu - coutTotalAvecFixes;
          const margeReellePct = revenu > 0 ? (margeReelle / revenu) * 100 : 0;
          return (
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-lg p-5 shadow-lg">
          <h2 className="text-sm font-semibold text-slate-300 uppercase mb-3">💰 Rentabilité temps réel <span className="text-[10px] font-normal text-slate-400">— inclut 15% frais fixes</span></h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={projet.prix_contrat ? "Prix contrat" : "Budget initial"} value={formatCAD(revenu)} sub={projet.prix_contrat && projet.budget_estime && projet.prix_contrat !== projet.budget_estime ? `Budget est. : ${formatCAD(projet.budget_estime)}` : ""} />
            <Stat label="Coût total" value={formatCAD(coutTotalAvecFixes)} couleur={coutTotalAvecFixes > revenu ? "text-red-300" : "text-amber-200"} sub={`Direct ${formatCAD(projet.cout_total)} + Fixes ${formatCAD(fraisFixes)}`} />
            <Stat label="Profit net" value={formatCAD(margeReelle)} couleur={margeReelle < 0 ? "text-red-300" : "text-emerald-300"} sub={`${margeReellePct.toFixed(0)}% net`} />
            <Stat label="Restant" value={formatCAD(revenu - coutTotalAvecFixes)} couleur={revenu - coutTotalAvecFixes < 0 ? "text-red-300" : "text-slate-200"} />
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

          {/* Détail du coût engagé — cliquable */}
          <button onClick={() => setCoutDetail(!coutDetail)} className="mt-3 text-xs text-slate-300 hover:text-white flex items-center gap-1">
            {coutDetail ? "▾" : "▸"} Détail du coût engagé ({formatCAD(projet.cout_total)})
          </button>
          {coutDetail && (
            <div className="mt-2 bg-slate-800/60 rounded-lg p-3 text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-slate-300">👷 Main-d'œuvre ({projet.total_heures.toFixed(1)} h)</span><span className="font-bold text-white">{formatCAD(projet.cout_main_oeuvre)}</span></div>
              {(() => {
                const parCat: Record<string, number> = {};
                for (const d of depenses) { const k = d.categorie || "autre"; parCat[k] = (parCat[k] || 0) + (d.montant || 0); }
                const cats = Object.entries(parCat).sort(([, a], [, b]) => b - a);
                return cats.length === 0
                  ? <div className="text-slate-400 text-xs italic">Aucune dépense matériaux/autres encore.</div>
                  : cats.map(([cat, montant]) => (
                      <div key={cat} className="flex justify-between"><span className="text-slate-300 capitalize">📦 {cat}</span><span className="font-bold text-white">{formatCAD(montant)}</span></div>
                    ));
              })()}
              <div className="flex justify-between"><span className="text-slate-300">🏢 Frais fixes structurels (15%)</span><span className="font-bold text-white">{formatCAD(fraisFixes)}</span></div>
              <div className="text-[10px] text-slate-400 italic pl-5">Admin, véhicules, assurance RBQ, comptable, téléphone, etc.</div>
              <div className="flex justify-between pt-1.5 border-t border-slate-600"><span className="font-bold text-slate-200">Coût total (direct + fixes)</span><span className="font-bold text-amber-300">{formatCAD(coutTotalAvecFixes)}</span></div>
            </div>
          )}
        </div>
          );
        })()}

        {/* CONTRAT + FACTURE FINALE */}
        <ContratFactureSection projet={projet} onUpdate={charger} />


        {/* Onglets */}
        <div className="flex gap-2 border-b overflow-x-auto">
          {(["heures", "depenses", "description"] as const).map((o) => (
            <button key={o} onClick={() => setOnglet(o)} className={`px-4 py-2 text-sm font-semibold border-b-2 transition whitespace-nowrap ${onglet === o ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
              {o === "heures" ? `⏱️ Heures (${heures.length})` : o === "depenses" ? `💸 Dépenses (${depenses.length})` : `📝 Description / Photos`}
            </button>
          ))}
        </div>

        {/* ONGLET DESCRIPTION / PHOTOS */}
        {onglet === "description" && (
          <DescriptionTab
            projet={projet}
            photos={photos}
            heures={heures}
            onUpdate={charger}
            onOpenPhoto={setLightboxId}
          />
        )}

        {/* ONGLET HEURES */}
        {onglet === "heures" && (
          <div className="space-y-3">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-semibold mb-3">⏱️ Saisir des heures</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <FieldDate label="Date" value={hForm.date} onChange={(v) => setHForm({ ...hForm, date: v })} />
                <FieldNum label="Heures *" value={hForm.heures} onChange={(v) => setHForm({ ...hForm, heures: v })} step={0.5} />
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Employé *</label>
                  <select
                    value={hForm.employe}
                    onChange={(e) => {
                      const emp = employes.find((x) => x.nom === e.target.value);
                      setHForm({ ...hForm, employe: e.target.value, taux_horaire: emp ? String(emp.taux_horaire) : hForm.taux_horaire });
                    }}
                    className="w-full px-3 py-2 border rounded text-sm bg-white"
                  >
                    <option value="">— Choisir —</option>
                    {employes.map((e) => <option key={e.id} value={e.nom}>{e.nom}</option>)}
                  </select>
                </div>
                <div className="flex items-end"><button onClick={ajouterHeures} className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold">＋ Ajouter</button></div>
              </div>
              <div className="mt-2">
                <Field label="Description" value={hForm.description} onChange={(v) => setHForm({ ...hForm, description: v })} placeholder="Ex: pose soffite côté est" />
              </div>
            </div>

            {/* === VUE SEMAINE / LISTE — Style Excel/Gantt === */}
            {(() => {
              const JOURS_C = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
              const lundi = new Date(semaineDebutH);
              const dim = new Date(lundi); dim.setDate(lundi.getDate() + 6);
              // ⚠️ utilisateur en heure locale Montréal — toISOString() décale en UTC.
              // On formate manuellement YYYY-MM-DD à partir des composants locaux.
              const fmtLocal = (d: Date) => {
                const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), j = String(d.getDate()).padStart(2, "0");
                return `${y}-${m}-${j}`;
              };
              const debutISO = fmtLocal(lundi);
              const finISO = fmtLocal(dim);
              // Parse 'YYYY-MM-DD' comme MINUIT LOCAL (sinon UTC midnight = jour précédent en EDT/EST)
              const dateLocal = (iso: string) => {
                const [y, m, j] = iso.split("-").map(Number);
                return new Date(y, (m || 1) - 1, j || 1);
              };
              const fmtCt = (d: Date) => d.toLocaleDateString("fr-CA", { day: "numeric", month: "short" });

              const reculer = () => { const d = new Date(semaineDebutH); d.setDate(d.getDate() - 7); setSemaineDebutH(d); };
              const avancer = () => { const d = new Date(semaineDebutH); d.setDate(d.getDate() + 7); setSemaineDebutH(d); };
              const cetteSem = () => {
                const d = new Date(); const j = d.getDay(); const diff = j === 0 ? -6 : 1 - j;
                d.setDate(d.getDate() + diff); d.setHours(0, 0, 0, 0); setSemaineDebutH(d);
              };

              const heuresSemaine = heures.filter((h: any) => h.date >= debutISO && h.date <= finISO);
              const employesPresents = Array.from(new Set(heuresSemaine.map((h: any) => h.employe || "—"))).sort();

              const grille: Record<string, Array<{ total: number; cout: number; lignes: any[] }>> = {};
              employesPresents.forEach((e) => grille[e] = Array.from({ length: 7 }, () => ({ total: 0, cout: 0, lignes: [] })));
              heuresSemaine.forEach((h: any) => {
                const d = dateLocal(h.date);
                const idx = Math.floor((d.getTime() - lundi.getTime()) / 86400000);
                if (idx >= 0 && idx < 7) {
                  const e = h.employe || "—";
                  grille[e][idx].total += h.heures || 0;
                  grille[e][idx].cout += (h.heures || 0) * (h.taux_horaire || 0);
                  grille[e][idx].lignes.push(h);
                }
              });

              const totauxJ = Array.from({ length: 7 }, () => ({ heures: 0, cout: 0 }));
              employesPresents.forEach((e) => grille[e].forEach((c, i) => { totauxJ[i].heures += c.total; totauxJ[i].cout += c.cout; }));
              const totalSem = totauxJ.reduce((s, t) => ({ heures: s.heures + t.heures, cout: s.cout + t.cout }), { heures: 0, cout: 0 });

              const toggleSel = (id: number) => { const ns = new Set(selectionH); ns.has(id) ? ns.delete(id) : ns.add(id); setSelectionH(ns); };
              const supprimerSel = async () => {
                if (selectionH.size === 0) return;
                if (!confirm(`Supprimer ${selectionH.size} entrée(s) sélectionnée(s) ?`)) return;
                await Promise.all(Array.from(selectionH).map((id) => fetch(`/api/heures?id=${id}`, { method: "DELETE" })));
                toast(`${selectionH.size} entrée(s) supprimée(s)`, "success");
                setSelectionH(new Set());
                charger();
              };

              return (
                <>
                  {/* Navigation semaine + toggle vue */}
                  <div className="bg-white rounded-lg shadow p-3 flex flex-wrap items-center gap-2">
                    <button onClick={reculer} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded font-bold" aria-label="Semaine précédente">←</button>
                    <button onClick={cetteSem} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold">Aujourd'hui</button>
                    <button onClick={avancer} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded font-bold" aria-label="Semaine suivante">→</button>
                    <div className="font-bold ml-2">Du {fmtCt(lundi)} au {fmtCt(dim)}</div>
                    <input type="date" value={debutISO} onChange={(e) => {
                      const d = dateLocal(e.target.value); if (isNaN(d.getTime())) return;
                      const j = d.getDay(); const diff = j === 0 ? -6 : 1 - j;
                      d.setDate(d.getDate() + diff); d.setHours(0, 0, 0, 0); setSemaineDebutH(d);
                    }} className="px-2 py-1 border rounded text-sm" title="Aller à une semaine" />
                    <div className="ml-auto flex gap-1 bg-slate-100 rounded p-1">
                      <button onClick={() => setVueH("semaine")} className={`px-3 py-1 rounded text-xs font-semibold ${vueH === "semaine" ? "bg-white shadow" : "text-slate-600"}`}>📅 Grille</button>
                      <button onClick={() => setVueH("liste")} className={`px-3 py-1 rounded text-xs font-semibold ${vueH === "liste" ? "bg-white shadow" : "text-slate-600"}`}>📋 Liste</button>
                    </div>
                  </div>

                  {selectionH.size > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded p-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-blue-900">{selectionH.size} entrée(s) sélectionnée(s)</span>
                      <div className="flex gap-2">
                        <button onClick={() => setSelectionH(new Set())} className="text-xs text-slate-600 hover:underline">Désélectionner</button>
                        <button onClick={supprimerSel} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-bold">🗑 Supprimer</button>
                      </div>
                    </div>
                  )}

                  {/* === VUE GRILLE === */}
                  {vueH === "semaine" && (
                    <div className="bg-white rounded-lg shadow overflow-x-auto">
                      <table className="w-full text-sm min-w-max">
                        <thead>
                          <tr className="bg-slate-900 text-white text-xs">
                            <th className="p-2 text-left sticky left-0 bg-slate-900 z-10 min-w-[120px]">Employé</th>
                            {JOURS_C.map((j, i) => {
                              const jd = new Date(lundi); jd.setDate(jd.getDate() + i);
                              const auj = fmtLocal(jd) === fmtLocal(new Date());
                              return (
                                <th key={j} className={`p-2 text-center min-w-[100px] ${auj ? "bg-emerald-700" : ""}`}>
                                  <div className="font-bold">{j}</div>
                                  <div className="text-[10px] opacity-80">{jd.getDate()}/{jd.getMonth() + 1}</div>
                                </th>
                              );
                            })}
                            <th className="p-2 text-right min-w-[90px] bg-slate-800">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {employesPresents.length === 0 ? (
                            <tr><td colSpan={9} className="p-8 text-center text-slate-500 text-sm">Aucune heure cette semaine sur ce projet.</td></tr>
                          ) : employesPresents.map((emp) => {
                            const totE = grille[emp].reduce((s, c) => s + c.total, 0);
                            const coutE = grille[emp].reduce((s, c) => s + c.cout, 0);
                            return (
                              <tr key={emp} className="border-t hover:bg-slate-50">
                                <td className="p-2 font-bold sticky left-0 bg-white z-10">{emp}</td>
                                {grille[emp].map((c, i) => (
                                  <td key={i} className="p-2 text-center align-top">
                                    {c.total > 0 ? (
                                      <>
                                        <div className="font-bold text-emerald-700">{c.total.toFixed(1)} h</div>
                                        <div className="text-[10px] text-slate-500">{formatCAD(c.cout)}</div>
                                        {c.lignes.length > 1 && <div className="text-[9px] text-slate-400">{c.lignes.length} entrées</div>}
                                      </>
                                    ) : <div className="text-slate-300">—</div>}
                                  </td>
                                ))}
                                <td className="p-2 text-right bg-slate-50">
                                  <div className="font-bold">{totE.toFixed(1)} h</div>
                                  <div className="text-[10px] text-emerald-700">{formatCAD(coutE)}</div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                            <td className="p-2 sticky left-0 bg-slate-100 z-10">TOTAL</td>
                            {totauxJ.map((t, i) => (
                              <td key={i} className="p-2 text-center">
                                <div>{t.heures.toFixed(1)} h</div>
                                <div className="text-[10px] text-slate-600">{formatCAD(t.cout)}</div>
                              </td>
                            ))}
                            <td className="p-2 text-right bg-emerald-100">
                              <div className="text-emerald-900">{totalSem.heures.toFixed(1)} h</div>
                              <div className="text-xs text-emerald-700">{formatCAD(totalSem.cout)}</div>
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}

                  {/* === VUE LISTE === */}
                  {vueH === "liste" && (
                    <div className="bg-white rounded-lg shadow overflow-x-auto">
                      {heuresSemaine.length === 0 ? (
                        <p className="p-6 text-center text-slate-500 text-sm">Aucune heure cette semaine sur ce projet.</p>
                      ) : (
                        <table className="w-full text-sm min-w-max">
                          <thead className="bg-slate-100 text-xs uppercase">
                            <tr>
                              <th className="p-2 w-10">
                                <input type="checkbox"
                                  checked={selectionH.size === heuresSemaine.length && heuresSemaine.length > 0}
                                  onChange={() => setSelectionH(selectionH.size === heuresSemaine.length ? new Set() : new Set(heuresSemaine.map((h: any) => h.id)))}
                                />
                              </th>
                              <th className="p-2 text-left">Date</th>
                              <th className="p-2 text-left">Employé</th>
                              <th className="p-2 text-right">Heures</th>
                              <th className="p-2 text-right">$/h</th>
                              <th className="p-2 text-right">Coût</th>
                              <th className="p-2 text-left">Description</th>
                              <th className="p-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {heuresSemaine.sort((a: any, b: any) => b.date.localeCompare(a.date)).map((h: any) => {
                              const sel = selectionH.has(h.id);
                              const jourCt = JOURS_C[(dateLocal(h.date).getDay() + 6) % 7];
                              return (
                                <tr key={h.id} className={`border-t hover:bg-slate-50 vk-lazy-render ${sel ? "bg-blue-50" : ""}`}>
                                  <td className="p-2"><input type="checkbox" checked={sel} onChange={() => toggleSel(h.id)} /></td>
                                  <td className="p-2 whitespace-nowrap"><span className="text-slate-400 text-[10px] mr-1">{jourCt}</span>{h.date}</td>
                                  <td className="p-2 font-medium">{h.employe || "—"}</td>
                                  <td className="p-2 text-right font-bold">{(h.heures || 0).toFixed(1)} h</td>
                                  <td className="p-2 text-right text-slate-600">{(h.taux_horaire || 0).toFixed(2)} $</td>
                                  <td className="p-2 text-right font-bold text-emerald-700">{formatCAD((h.heures || 0) * (h.taux_horaire || 0))}</td>
                                  <td className="p-2 text-xs text-slate-600 truncate max-w-xs">{h.description || ""}</td>
                                  <td className="p-2 text-right">
                                    <button onClick={() => supprimer("heures", h.id)} className="text-xs text-red-600 hover:underline">🗑</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </>
              );
            })()}

            {/* Code mort retiré (commit 9442fae+) :
                ancien filtre bi-hebdo + ancien rendu liste qui utilisaient
                `new Date(h.date)` (bug timezone). Tout est maintenant géré
                par la vue grille/liste ci-dessus avec dateLocal(). */}
            {false && heures.length > 0 && (() => {
              // Calcul des périodes bi-hebdo (mêmes ancres que le module Paye : dimanche 2026-01-04)
              const ancre = new Date("2026-01-04T12:00:00");
              const periodeDe = (dateStr: string) => {
                const d = new Date(dateStr + "T12:00:00");
                const diffJ = Math.floor((d.getTime() - ancre.getTime()) / 86400000);
                const num = Math.floor(diffJ / 14);
                const deb = new Date(ancre); deb.setDate(ancre.getDate() + num * 14);
                const fin = new Date(deb); fin.setDate(deb.getDate() + 13);
                return { debut: deb.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10), num };
              };
              // Périodes uniques dans les heures saisies
              const periodesMap = new Map<string, { debut: string; fin: string }>();
              for (const h of heures) {
                const p = periodeDe(h.date);
                periodesMap.set(p.debut, { debut: p.debut, fin: p.fin });
              }
              const periodes = Array.from(periodesMap.values()).sort((a, b) => b.debut.localeCompare(a.debut));

              const filtrees = heures.filter((h: any) => {
                if (hFiltreEmp && h.employe !== hFiltreEmp) return false;
                if (hRecherche && !(h.description || "").toLowerCase().includes(hRecherche.toLowerCase())) return false;
                if (hPeriode) {
                  const [d, f] = hPeriode.split("|");
                  if (h.date < d || h.date > f) return false;
                }
                return true;
              });
              const totalH = filtrees.reduce((s: number, h: any) => s + (h.heures || 0), 0);
              const totalC = filtrees.reduce((s: number, h: any) => s + (h.heures || 0) * (h.taux_horaire || 0), 0);

              return (
                <div className="bg-white rounded-lg shadow p-3 space-y-2">
                  {/* Chips périodes bi-hebdo */}
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span className="text-xs font-semibold text-slate-600">📅 Période paye :</span>
                    <button onClick={() => setHPeriode("")} className={`px-2.5 py-1 rounded text-xs font-semibold ${!hPeriode ? "bg-slate-900 text-white" : "bg-slate-100 hover:bg-slate-200"}`}>Tout</button>
                    {periodes.map((p) => {
                      const cle = `${p.debut}|${p.fin}`;
                      const label = `${p.debut.slice(5)} → ${p.fin.slice(5)}`;
                      return (
                        <button key={cle} onClick={() => setHPeriode(cle)} className={`px-2.5 py-1 rounded text-xs font-semibold ${hPeriode === cle ? "bg-emerald-600 text-white" : "bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200"}`} title={`${p.debut} → ${p.fin}`}>{label}</button>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap gap-2 items-center">
                    <input type="search" placeholder="🔍 Recherche description" value={hRecherche} onChange={(e) => setHRecherche(e.target.value)} className="flex-1 min-w-40 px-3 py-1.5 border rounded text-sm" />
                    <select value={hFiltreEmp} onChange={(e) => setHFiltreEmp(e.target.value)} className="px-3 py-1.5 border rounded text-sm bg-white">
                      <option value="">Tous les employés</option>
                      {Array.from(new Set(heures.map((h: any) => h.employe).filter(Boolean))).map((e: any) => <option key={e} value={e}>{e}</option>)}
                    </select>
                    <select value={hTri} onChange={(e) => setHTri(e.target.value as any)} className="px-3 py-1.5 border rounded text-sm bg-white">
                      <option value="date_desc">Date ↓ (récent)</option>
                      <option value="date_asc">Date ↑ (ancien)</option>
                      <option value="heures_desc">Plus d'heures</option>
                      <option value="heures_asc">Moins d'heures</option>
                      <option value="employe">Employé A→Z</option>
                    </select>
                    <span className="text-xs text-slate-600 ml-auto">{filtrees.length} entrée(s) · <strong>{totalH.toFixed(1)} h</strong> · <strong>{formatCAD(totalC)}</strong></span>
                  </div>
                </div>
              );
            })()}

            {/* Ancien rendu liste détaillé — désactivé : remplacé par vue grille/liste ci-dessus */}
            {false && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              {heures.length === 0 ? (
                <p className="p-6 text-center text-slate-500 text-sm">Aucune heure saisie</p>
              ) : (
                <div className="divide-y">
                  {(() => {
                    let list = heures.filter((h: any) => {
                      if (hFiltreEmp && h.employe !== hFiltreEmp) return false;
                      if (hRecherche && !(h.description || "").toLowerCase().includes(hRecherche.toLowerCase())) return false;
                      if (hPeriode) {
                        const [d, f] = hPeriode.split("|");
                        if (h.date < d || h.date > f) return false;
                      }
                      return true;
                    });
                    list = [...list].sort((a: any, b: any) => {
                      if (hTri === "date_desc") return b.date.localeCompare(a.date);
                      if (hTri === "date_asc") return a.date.localeCompare(b.date);
                      if (hTri === "heures_desc") return (b.heures || 0) - (a.heures || 0);
                      if (hTri === "heures_asc") return (a.heures || 0) - (b.heures || 0);
                      if (hTri === "employe") return (a.employe || "").localeCompare(b.employe || "");
                      return 0;
                    });
                    return list;
                  })().map((h: any) => (
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
            )}
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
                          {(d.a_recu || d.recu_data) && (
                            <a href={`/api/depenses/${d.id}/recu`} target="_blank" rel="noreferrer" className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded hover:bg-emerald-200">📎 Reçu</a>
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

      {lightboxId !== null && (() => {
        const liste = photos.map((p: any) => ({ id: p.id, description: p.description, date: p.date }));
        const idx = liste.findIndex((p) => p.id === lightboxId);
        if (idx < 0) return null;
        return (
          <Lightbox
            photos={liste}
            index={idx}
            onClose={() => setLightboxId(null)}
            onIndexChange={(i) => setLightboxId(liste[i].id)}
          />
        );
      })()}
    </div>
  );
}

function DescriptionTab({ projet, photos, heures, onUpdate, onOpenPhoto }: { projet: any; photos: any[]; heures: any[]; onUpdate: () => void; onOpenPhoto: (id: number) => void }) {
  const [texte, setTexte] = useState(projet.description || "");
  const [busy, setBusy] = useState(false);
  const [notesOuvert, setNotesOuvert] = useState(false);
  const { toast } = useToast();
  useEffect(() => { setTexte(projet.description || ""); }, [projet.id]);
  const sauver = async () => {
    setBusy(true);
    try {
      await fetch("/api/projets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: projet.id, description: texte }) });
      toast("Notes du projet enregistrées", "success");
      onUpdate();
    } finally { setBusy(false); }
  };
  const modifie = texte !== (projet.description || "");

  // === Journal de chantier : regroupe par jour les descriptions d'heures + les photos ===
  const dateLisible = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("fr-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };
  const jours: Record<string, { heures: any[]; photos: any[] }> = {};
  for (const h of heures) {
    if (!jours[h.date]) jours[h.date] = { heures: [], photos: [] };
    jours[h.date].heures.push(h);
  }
  for (const p of photos) {
    if (!jours[p.date]) jours[p.date] = { heures: [], photos: [] };
    jours[p.date].photos.push(p);
  }
  const joursTries = Object.keys(jours).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-3">
      {/* Ajout rapide de photos */}
      <div className="bg-white rounded-lg shadow p-4">
        <PhotoUploader projet_id={projet.id} onUpload={onUpdate} />
      </div>

      {/* Notes générales du projet (repliable) */}
      <div className="bg-white rounded-lg shadow">
        <button onClick={() => setNotesOuvert(!notesOuvert)} className="w-full flex items-center justify-between p-4 text-left">
          <h3 className="font-semibold">🗒️ Notes générales du projet</h3>
          <span className="text-slate-400">{notesOuvert ? "▾" : "▸"}</span>
        </button>
        {notesOuvert && (
          <div className="px-4 pb-4 space-y-2">
            <textarea
              value={texte}
              onChange={(e) => setTexte(e.target.value)}
              rows={4}
              placeholder="Portée des travaux, type de revêtement, particularités du chantier…"
              className="w-full px-3 py-2 border rounded text-sm"
            />
            <div className="flex justify-end">
              <button onClick={sauver} disabled={!modifie || busy} className={`px-4 py-2 rounded text-sm font-bold ${modifie && !busy ? "bg-emerald-600 hover:bg-emerald-500 text-white" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}>
                {busy ? "…" : "💾 Enregistrer"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Journal de chantier jour par jour */}
      <h3 className="font-bold text-slate-700 px-1">📅 Suivi de chantier — jour par jour</h3>
      {joursTries.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-10 text-center text-slate-500 text-sm">
          Aucune entrée pour l'instant. Les descriptions et photos saisies avec les heures apparaîtront ici, jour par jour.
        </div>
      ) : (
        <div className="space-y-3">
          {joursTries.map((date) => {
            const jour = jours[date];
            const totalH = jour.heures.reduce((s, h) => s + (h.heures || 0), 0);
            const descriptions = jour.heures.filter((h) => (h.description || "").trim());
            return (
              <div key={date} className="bg-white rounded-lg shadow p-4">
                <div className="flex items-baseline justify-between flex-wrap gap-2 border-b pb-2 mb-2">
                  <h4 className="font-bold text-slate-900 capitalize">{dateLisible(date)}</h4>
                  <span className="text-xs text-slate-500">{totalH > 0 ? `${totalH.toFixed(1)} h` : ""}{jour.photos.length ? ` · ${jour.photos.length} photo(s)` : ""}</span>
                </div>

                {/* Descriptions du jour */}
                {descriptions.length > 0 ? (
                  <ul className="space-y-1.5 mb-3">
                    {descriptions.map((h) => (
                      <li key={h.id} className="text-sm flex gap-2">
                        <span className="text-emerald-600 flex-shrink-0">•</span>
                        <span className="text-slate-700">
                          {h.description}
                          <span className="text-xs text-slate-400 ml-1">— {h.employe || "—"}{h.heures ? `, ${h.heures} h` : ""}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  totalH > 0 && <p className="text-xs text-slate-400 italic mb-3">Heures saisies, sans description.</p>
                )}

                {/* Photos du jour */}
                {jour.photos.length > 0 && (
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {jour.photos.map((p: any) => (
                      <div key={p.id} className="relative group">
                        <button type="button" onClick={() => onOpenPhoto(p.id)} className="block w-full">
                          <img src={`/api/photos/${p.id}?thumb=1`} alt={p.description || ""} loading="lazy" decoding="async" className="w-full aspect-square object-cover rounded border hover:opacity-90" />
                        </button>
                        <button
                          onClick={async () => { if (confirm("Supprimer cette photo ?")) { await fetch(`/api/photos?id=${p.id}`, { method: "DELETE" }); onUpdate(); } }}
                          className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 text-xs font-bold flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PhotoUploader({ projet_id, onUpload }: { projet_id: number; onUpload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ total: 0, done: 0 });
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState("");
  const [autoScan, setAutoScan] = useState(false); // off par défaut sur les photos de chantier (paysages)

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const { compresserImage, genererVignette } = await import("@/lib/img");
    const scanner = autoScan ? await import("@/lib/imgScanner") : null;
    setBusy(true);
    setProgress({ total: files.length, done: 0 });
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f.size > 20 * 1024 * 1024) continue;
        let data = await compresserImage(f);
        if (scanner) {
          try {
            const cadree = await scanner.autoCadrer(data);
            data = await scanner.filtreDocument(cadree, 1);
          } catch { /* garde l'original si scan échoue */ }
        }
        const thumb = await genererVignette(f).catch(() => null);
        await fetch("/api/photos", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projet_id, date, description: description || f.name, photo_data: data, photo_type: "image/jpeg", employes: "Manuel", thumb_data: thumb }),
        });
        setProgress({ total: files.length, done: i + 1 });
      }
      onUpload();
      setDescription("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-emerald-50 to-sky-50 border-2 border-emerald-200 rounded-lg p-3">
      <h3 className="font-bold text-sm text-emerald-900 mb-2">📸 Ajouter des photos au projet</h3>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-shrink-0">
          <label className="block text-[10px] font-medium text-slate-600 mb-1">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-2 py-1.5 border rounded text-xs" />
        </div>
        <div className="flex-1 min-w-32">
          <label className="block text-[10px] font-medium text-slate-600 mb-1">Description (optionnel)</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: avant travaux, façade nord..." className="w-full px-2 py-1.5 border rounded text-xs" />
        </div>
        <label className="flex items-center gap-1 text-[10px] text-slate-600 cursor-pointer self-end pb-1.5" title="Active pour les plans/croquis/contrats pris en photo. Désactive pour photos de chantier normales.">
          <input type="checkbox" checked={autoScan} onChange={(e) => setAutoScan(e.target.checked)} className="w-3 h-3" />
          <span>📄 Mode document</span>
        </label>
        <div className="flex gap-1">
          <label className="cursor-pointer bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 rounded text-xs font-bold">
            📷 Caméra
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => upload(e.target.files)} disabled={busy} />
          </label>
          <label className="cursor-pointer bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded text-xs font-bold">
            📁 Plusieurs
            <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} disabled={busy} />
          </label>
        </div>
      </div>
      {busy && (
        <div className="mt-2">
          <div className="text-xs text-slate-600 mb-1">⏳ Upload {progress.done}/{progress.total}...</div>
          <div className="h-1.5 bg-slate-200 rounded overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}
      <div className="text-[10px] text-slate-500 mt-2">📦 Compression auto : 5 MB → ~300 ko · upload 10× plus rapide · max 20 MB / photo</div>
    </div>
  );
}

function ClientInfo({ client_id }: { client_id?: number | null }) {
  const [c, setC] = useState<any>(null);
  const charger = () => { if (client_id) fetch(`/api/clients?id=${client_id}`, { cache: "no-store" }).then((r) => r.json()).then(setC).catch(() => {}); };
  useEffect(() => { charger(); }, [client_id]);
  const changerStatut = async (statut: string) => {
    if (!client_id) return;
    await fetch("/api/clients", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: client_id, statut }) });
    charger();
  };
  if (!client_id) return <div className="text-xs text-slate-500 italic">Aucun client lié</div>;
  if (!c) return <div className="text-xs text-slate-400">Chargement...</div>;
  const STATUTS_CLIENT = ["prospect", "actif", "inactif", "perdu"];
  return (
    <div className="text-sm space-y-0.5 mt-1">
      {c.telephone && <div>📞 <a href={`tel:${c.telephone}`} className="text-blue-600 hover:underline">{c.telephone}</a></div>}
      {c.courriel && <div>✉️ <a href={`mailto:${c.courriel}`} className="text-blue-600 hover:underline break-all">{c.courriel}</a></div>}
      {c.adresse && <div className="text-xs text-slate-600">🏠 {c.adresse}</div>}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[10px] text-slate-500 uppercase">Statut</span>
        <select
          value={c.statut || "prospect"}
          onChange={(e) => changerStatut(e.target.value)}
          className={`text-xs px-2 py-1 rounded border font-semibold ${c.statut === "actif" ? "bg-emerald-50 text-emerald-900 border-emerald-300" : c.statut === "prospect" ? "bg-amber-50 text-amber-900 border-amber-300" : "bg-slate-100 border-slate-300"}`}
        >
          {STATUTS_CLIENT.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </div>
  );
}

function ContratFactureSection({ projet, onUpdate }: { projet: any; onUpdate: () => void }) {
  const [edit, setEdit] = useState(false);
  const [prix, setPrix] = useState(projet.prix_contrat ? String(projet.prix_contrat) : "");
  const [contratOuvert, setContratOuvert] = useState(false);
  const [factureOuverte, setFactureOuverte] = useState(false);
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
  const uploadContrat = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("Fichier > 5 MB"); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      await fetch("/api/projets", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: projet.id, contrat_signe_data: reader.result, contrat_signe_type: file.type }),
      });
      onUpdate();
    };
    reader.readAsDataURL(file);
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
        <h2 className="font-bold">📄 Contrat</h2>
        {!edit && <button onClick={() => setEdit(true)} className="text-xs text-emerald-700 hover:underline">✏️ Modifier</button>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
        {/* Contrat signé */}
        <div>
          <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Contrat signé</div>
          {projet.contrat_signe_data || projet.a_contrat_signe ? (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded p-2">
              {projet.contrat_signe_type?.startsWith("image/") ? (
                <div className="w-12 h-12 bg-slate-200 rounded flex items-center justify-center text-2xl">🖋️</div>
              ) : (
                <div className="w-12 h-12 bg-slate-200 rounded flex items-center justify-center text-2xl">📝</div>
              )}
              <button onClick={() => setContratOuvert(true)} className="flex-1 text-left text-sm text-blue-700 hover:underline font-semibold">📎 Ouvrir le contrat</button>
              <label className="cursor-pointer text-xs text-blue-600 hover:underline">
                Remplacer
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={uploadContrat} />
              </label>
            </div>
          ) : (
            <label className="cursor-pointer bg-white border-2 border-dashed border-slate-300 hover:border-blue-500 hover:bg-blue-50 rounded p-3 text-center transition flex items-center justify-center gap-2 text-sm font-semibold text-slate-700">
              🖋️ Joindre le contrat signé
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={uploadContrat} />
            </label>
          )}
        </div>
        {/* Facture projet */}
        <div>
          <div className="text-xs text-slate-500 uppercase font-semibold mb-1">Facture projet</div>
          {projet.facture_finale_data || projet.a_facture_finale ? (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded p-2">
              <div className="w-12 h-12 bg-slate-200 rounded flex items-center justify-center text-2xl">{projet.facture_finale_type?.startsWith("image/") ? "🧾" : "📄"}</div>
              <button onClick={() => setFactureOuverte(true)} className="flex-1 text-left text-sm text-emerald-700 hover:underline font-semibold">📎 Ouvrir la facture</button>
              <label className="cursor-pointer text-xs text-emerald-700 hover:underline">
                Remplacer
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={uploadFacture} />
              </label>
            </div>
          ) : (
            <label className="cursor-pointer bg-white border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 rounded p-3 text-center transition flex items-center justify-center gap-2 text-sm font-semibold text-slate-700">
              🧾 Joindre la facture
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={uploadFacture} />
            </label>
          )}
        </div>
      </div>

      {/* Visualiseur contrat signé plein écran avec bouton retour */}
      {contratOuvert && (
        <div className="fixed inset-0 z-[80] bg-black/95 flex flex-col">
          <div className="flex items-center justify-between p-3 text-white safe-top">
            <button onClick={() => setContratOuvert(false)} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 font-semibold text-sm">← Retour</button>
            <span className="text-sm opacity-80">Contrat signé — {projet.nom}</span>
            <a href={`/api/projets/${projet.id}/contrat`} target="_blank" rel="noreferrer" download className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">⬇</a>
          </div>
          <div className="flex-1 bg-white">
            {projet.contrat_signe_type?.startsWith("image/") ? (
              <div className="w-full h-full flex items-center justify-center bg-black" onClick={() => setContratOuvert(false)}>
                <img src={`/api/projets/${projet.id}/contrat`} alt="Contrat signé" onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <iframe src={`/api/projets/${projet.id}/contrat#view=FitH&toolbar=1`} title="Contrat signé" className="w-full h-full border-0" />
            )}
          </div>
        </div>
      )}

      {/* Visualiseur facture plein écran */}
      {factureOuverte && (
        <div className="fixed inset-0 z-[80] bg-black/95 flex flex-col">
          <div className="flex items-center justify-between p-3 text-white safe-top">
            <button onClick={() => setFactureOuverte(false)} className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 font-semibold text-sm">← Retour</button>
            <span className="text-sm opacity-80">Facture — {projet.nom}</span>
            <a href={`/api/projets/${projet.id}/facture`} target="_blank" rel="noreferrer" download className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm">⬇</a>
          </div>
          <div className="flex-1 bg-white">
            {projet.facture_finale_type?.startsWith("image/") ? (
              <div className="w-full h-full flex items-center justify-center bg-black" onClick={() => setFactureOuverte(false)}>
                <img src={`/api/projets/${projet.id}/facture`} alt="Facture" onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full object-contain" />
              </div>
            ) : (
              <iframe src={`/api/projets/${projet.id}/facture#view=FitH&toolbar=1`} title="Facture" className="w-full h-full border-0" />
            )}
          </div>
        </div>
      )}
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
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="number" min="0" step={step} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "-") e.preventDefault(); }} inputMode="decimal" className="w-full px-3 py-2 border rounded text-sm text-right" /></div>;
}
function FieldDate({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}

function NotesRapidesProjet({ projet_id }: { projet_id: number }) {
  const [notes, setNotes] = useState<any[]>([]);
  const charger = () => fetch(`/api/notes-rapides?projet_id=${projet_id}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setNotes(Array.isArray(d) ? d : []));
  useEffect(() => { charger(); }, [projet_id]);
  const supprimer = async (id: number) => {
    if (!confirm("Supprimer cette note ?")) return;
    await fetch(`/api/notes-rapides?id=${id}`, { method: "DELETE" });
    charger();
  };
  if (notes.length === 0) return null;
  return (
    <section className="bg-white rounded-lg shadow p-4 border-l-4 border-emerald-400">
      <h3 className="font-bold text-slate-900 mb-3 flex items-center gap-2">🎤 Notes du chantier <span className="text-xs font-normal text-slate-500">({notes.length})</span></h3>
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className="bg-slate-50 rounded p-3 flex justify-between items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.texte}</p>
              <div className="text-[10px] text-slate-500 mt-1 flex gap-2 flex-wrap">
                <span>👤 {n.auteur || "?"}</span>
                <span>{n.source === "vocal" ? "🎤 dictée" : "✏️ texte"}</span>
                <span>{new Date(n.date_creation).toLocaleString("fr-CA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
            <button onClick={() => supprimer(n.id)} className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded">🗑</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

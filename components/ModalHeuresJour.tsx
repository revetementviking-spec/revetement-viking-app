"use client";

import { useEffect, useRef, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import { useToast } from "@/components/Toasts";
import BottomSheet from "@/components/BottomSheet";
import { compresserImage, genererVignette } from "@/lib/img";
import MicVocal from "@/components/MicVocal";
import ProjetPicker from "@/components/ProjetPicker";
import { envoyer, nombreSaisi } from "@/lib/envoi";
import { postOuFile } from "@/lib/fileOffline";
import ErreurChargement from "@/components/ErreurChargement";
import { accepteSaisieTardive, estProjetActif, trierProjetsPourSaisie } from "@/lib/statuts-projet";

interface Props { ouvert: boolean; onClose: () => void; onSuccess?: () => void; onExtra?: () => void; }
interface LigneJour {
  projet_id: number; heures: string; description: string;
  photos: { data: string; type: string; nom: string; thumb?: string | null }[];
  heure_debut: string; heure_fin: string; dejeuner_retire: boolean;
  /** Date spécifique à cette ligne (override la date globale si renseignée) */
  date?: string;
}

/** Date d'aujourd'hui en LOCAL (pas UTC) — sinon décale après 20h en EDT/EST */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Calcule heures entre debut et fin (format HH:MM), minus pause dîner 30 min si activé */
function calculerHeures(debut: string, fin: string, dejeunerRetire: boolean): number {
  if (!debut || !fin) return 0;
  const [hd, md] = debut.split(":").map(Number);
  const [hf, mf] = fin.split(":").map(Number);
  let mins = (hf * 60 + mf) - (hd * 60 + md);
  if (mins < 0) mins += 24 * 60; // si fin le lendemain
  if (dejeunerRetire) mins -= 30;
  return Math.max(0, mins / 60);
}
interface Employe { id: number; nom: string; taux_horaire: number; das_pct: number; }

export default function ModalHeuresJour({ ouvert, onClose, onSuccess, onExtra }: Props) {
  const today = todayLocal();
  const [date, setDate] = useState(today);
  const [employes, setEmployes] = useState<Employe[]>([]);
  const [empSelectionnes, setEmpSelectionnes] = useState<Set<number>>(new Set());
  const [projets, setProjets] = useState<any[]>([]);
  const [lignes, setLignes] = useState<LigneJour[]>([]);
  const [loading, setLoading] = useState(false);
  const [ajoutEmpOuvert, setAjoutEmpOuvert] = useState(false);
  const [nouvelEmp, setNouvelEmp] = useState({ nom: "", taux_horaire: "30" });
  const [erreurEmployes, setErreurEmployes] = useState<string | null>(null);
  const { toast } = useToast();

  // Avant : sans catch, un 500 ou un réseau coupé laissait la liste d'employés vide sans
  // un mot — et « Sélectionne au moins un employé » à l'enregistrement, sans issue.
  const chargerEmployes = async () => {
    setErreurEmployes(null);
    try {
      const r = await fetch("/api/employes");
      const d: Employe[] = r.ok ? await r.json() : [];
      if (!r.ok || !Array.isArray(d)) { setErreurEmployes(r.status === 401 ? "session expirée — reconnecte-toi" : `erreur ${r.status}`); return; }
      setEmployes(d);
      if (empSelectionnes.size === 0 && d.length > 0) {
        // Préselectionner Gabriel si présent, sinon le premier de la liste
        const gabriel = d.find((e) => /gabriel/i.test(e.nom));
        setEmpSelectionnes(new Set([gabriel ? gabriel.id : d[0].id]));
      }
    } catch (e: any) {
      setErreurEmployes(e?.message === "Failed to fetch" ? "réseau indisponible" : (e?.message || "erreur réseau"));
    }
  };

  useEffect(() => {
    if (!ouvert) return;
    chargerEmployes();
    // On charge TOUS les projets (pas seulement 'actif') puis on garde ceux qui
    // acceptent encore une saisie. On charge aussi les dernières heures pour
    // pré-sélectionner le chantier où on a travaillé en dernier, modifiable ensuite.
    Promise.all([
      // ?lite=1 : la liste complète calcule cinq totaux par chantier et pèse 3-4× plus, pour un simple sélecteur.
      fetch("/api/projets?lite=1").then((r) => r.json()).catch(() => []),
      // Une seule entrée suffit (la plus récente) : la liste complète pesait 120 Ko pour un id.
      fetch("/api/heures?limit=1").then((r) => r.json()).catch(() => []),
    ]).then(([tous, heures]: [any[], any[]]) => {
      // Même tolérance que les dépenses : un chantier complété reste saisissable deux
      // semaines (retouches de garantie, finition pointée après la fermeture).
      // Règle commune — voir lib/statuts-projet.ts.
      // Ordre voulu par Francis pour la saisie d'heures : les chantiers EN COURS en
      // premier, puis ceux à venir, les complétés tout en bas.
      const dispo = trierProjetsPourSaisie(
        (Array.isArray(tous) ? tous : []).filter((p) => accepteSaisieTardive(p)),
      );
      setProjets(dispo);
      if (dispo.length > 0 && lignes.length === 0) {
        // Projet pré-sélectionné : celui des dernières heures saisies, mais SEULEMENT
        // s'il roule encore. Une retouche de garantie sur un chantier fermé ne doit pas
        // devenir le défaut du lendemain — la saisie d'heures vise les chantiers en
        // cours. Sinon : le chantier en activité le plus récent (dispo est déjà trié).
        const dernier = Array.isArray(heures) && heures.length > 0 ? heures[0]?.projet_id : null;
        const dernierEncoreActif = dispo.some((p) => p.id === dernier && estProjetActif(p.statut));
        const defautId = dernierEncoreActif ? dernier : dispo[0].id;
        setLignes([{ projet_id: defautId, heures: "", description: "", photos: [], heure_debut: "07:00", heure_fin: "15:00", dejeuner_retire: true }]);
      }
    });
  }, [ouvert]);

  const ajouterPhoto = async (ligneIdx: number, file: File) => {
    if (file.size > 20 * 1024 * 1024) { toast("Photo > 20 Mo", "warning"); return; }
    try {
      const data = await compresserImage(file);
      const thumb = await genererVignette(file).catch(() => null);
      setLignes((prev) => prev.map((l, i) => i === ligneIdx ? { ...l, photos: [...l.photos, { data, type: "image/jpeg", nom: file.name, thumb }] } : l));
    } catch (e: any) {
      toast("Erreur compression : " + e.message, "error");
    }
  };

  const retirerPhoto = (ligneIdx: number, photoIdx: number) => {
    setLignes((prev) => prev.map((l, i) => i === ligneIdx ? { ...l, photos: l.photos.filter((_, j) => j !== photoIdx) } : l));
  };

  const toggleEmp = (id: number) => {
    setEmpSelectionnes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const ajouterEmploye = async () => {
    // Virgule décimale : `+"30,50"` donnait NaN → « Nom et taux requis » sur un taux pourtant saisi.
    const taux = nombreSaisi(nouvelEmp.taux_horaire);
    if (!nouvelEmp.nom.trim() || !Number.isFinite(taux) || taux <= 0) { toast("Nom et taux requis (ex. : 30,50)", "warning"); return; }
    const res = await envoyer<{ id?: number }>("/api/employes", { corps: { nom: nouvelEmp.nom.trim(), taux_horaire: taux, das_pct: 0.15 } });
    if (!res.ok) { toast(`Employé NON ajouté : ${res.erreur}`, "error"); return; }
    toast(`✓ ${nouvelEmp.nom} ajouté`, "success");
    setNouvelEmp({ nom: "", taux_horaire: "30" });
    setAjoutEmpOuvert(false);
    await chargerEmployes();
    if (res.data?.id) setEmpSelectionnes((prev) => new Set([...prev, res.data!.id!]));
  };

  const ajouterLigne = () => setLignes([...lignes, { projet_id: projets[0]?.id || 0, heures: "", description: "", photos: [], heure_debut: "07:00", heure_fin: "15:00", dejeuner_retire: true }]);
  const supprimerLigne = (i: number) => setLignes(lignes.filter((_, idx) => idx !== i));
  const modifier = (i: number, patch: Partial<LigneJour>) => setLignes(lignes.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  const empsActifs = employes.filter((e) => empSelectionnes.has(e.id));
  // Calcul auto des heures à partir de heure_debut/fin si présents et heures vide
  const heuresEffectives = (l: LigneJour): number => {
    // nombreSaisi (lib/calculs.ts) : « 7,5 », « 7.5 », « 7,5 h » acceptés ; NaN si illisible
    // (refusé à l'enregistrement, pas converti en 0 h en silence).
    if (l.heures) { const n = nombreSaisi(l.heures); return Number.isFinite(n) ? n : 0; }
    return calculerHeures(l.heure_debut, l.heure_fin, l.dejeuner_retire);
  };
  const heuresIllisibles = (l: LigneJour) => !!l.heures && !Number.isFinite(nombreSaisi(l.heures));
  const totalHeures = lignes.reduce((s, l) => s + heuresEffectives(l), 0);
  // Coût total affiché = heures × somme(taux de base) — DAS calculée en arrière-plan
  const coutEmployes = empsActifs.reduce((s, e) => s + e.taux_horaire, 0);
  const totalCout = totalHeures * coutEmployes;

  // Verrou par référence (lib/verrou.ts) : deux clics du même instant doublaient les heures
  // de CHAQUE employé sur CHAQUE ligne — et la paie avec.
  const enCours = useRef(false);
  const enregistrer = async () => {
    if (enCours.current) return;
    enCours.current = true;
    try { await enregistrerReel(); } finally { enCours.current = false; }
  };
  const enregistrerReel = async () => {
    const illisible = lignes.find(heuresIllisibles);
    if (illisible) { toast(`Heures illisibles : « ${illisible.heures} » — écris par exemple 7,5`, "warning"); return; }
    // Une ligne est valide si elle a des heures > 0 OU si début/fin permettent de les calculer
    const valides = lignes
      .map((l) => ({ ...l, heures_effectives: heuresEffectives(l) }))
      .filter((l) => l.heures_effectives > 0);
    if (valides.length === 0) { toast("Saisis au moins une ligne avec heures (manuel ou début/fin)", "warning"); return; }
    if (empsActifs.length === 0) { toast("Sélectionne au moins un employé", "warning"); return; }
    // Garde-fou : total heures par employé > 16h sur cette date → confirmation explicite
    const totalParEmpJour = valides.reduce((s, l) => s + l.heures_effectives, 0);
    if (totalParEmpJour > 16) {
      if (!confirm(`⚠️ Cela enregistre ${totalParEmpJour.toFixed(1)} heures par employé sur le ${date}.\n\nC'est plus que ce qu'une personne peut travailler dans une journée (>16h). Es-tu sûr ? Si tu voulais saisir plusieurs jours, change la date entre chaque saisie.`)) return;
    }
    // Détecte si on a coché plusieurs employés ET plusieurs lignes (multiplie le total)
    if (empsActifs.length > 1 && valides.length > 1) {
      const totalReel = empsActifs.length * totalParEmpJour;
      if (!confirm(`Tu vas créer ${empsActifs.length * valides.length} entrées (${empsActifs.length} employé(s) × ${valides.length} ligne(s)) = ${totalReel.toFixed(1)} h totales sur le ${date}.\n\nConfirmer ?`)) return;
    }
    // Alerte budget dépassé
    for (const l of valides) {
      const p = projets.find((x) => x.id === l.projet_id);
      if (p?.budget_estime > 0) {
        // heuresEffectives : gère la virgule ET la saisie début/fin. Avant, +l.heures
        // donnait NaN (virgule) ou 0 (heures calculées) → alerte budget jamais montrée.
        const ajout = heuresEffectives(l) * coutEmployes;
        const nouveauCout = p.cout_total + ajout;
        // `cout_total` est HORS taxes : le comparer au budget taxes incluses minorait le
        // ratio de ~13 %, donc cette alerte se déclenchait à ~113 % réels alors que la
        // fiche projet alerte à 100 %. Même base des deux côtés.
        const budgetHT = p.revenu_avant_taxes ?? (p.budget_estime / 1.14975);
        const pct = budgetHT > 0 ? (nouveauCout / budgetHT) * 100 : 0;
        if (pct > 100) toast(`⚠️ ${p.nom} : budget DÉPASSÉ (${pct.toFixed(0)}%)`, "error");
        else if (pct > 90) toast(`⚠️ ${p.nom} : ${pct.toFixed(0)}% du budget`, "warning");
      }
    }
    setLoading(true);
    try {
      // Une entrée par employé × ligne (chaque employé fait ces heures sur ce projet).
      // postOuFile (lib/fileOffline.ts) : chaque entrée part avec sa clé d'idempotence ;
      // réseau coupé sur un toit = mise en file locale, rejouée au retour du réseau avec la
      // MÊME clé (le serveur ne crée jamais la ligne deux fois). Le bandeau hors-ligne
      // promettait cette sauvegarde différée depuis longtemps : ici elle existe.
      const erreurs: string[] = [];
      let enFile = 0;
      for (const emp of empsActifs) {
        for (const l of valides) {
          const descBase = l.description || "";
          const trace = (l.heure_debut && l.heure_fin && !l.heures)
            ? `${l.heure_debut}→${l.heure_fin}${l.dejeuner_retire ? " (-30min dîner)" : ""}`
            : "";
          const desc = [descBase, trace].filter(Boolean).join(" · ");
          const dateLigne = l.date || date;
          const r = await postOuFile("/api/heures", {
            projet_id: Number(l.projet_id), date: dateLigne, heures: Number(l.heures_effectives),
            description: desc, employe: emp.nom, taux_horaire: Number(emp.taux_horaire) || 0,
            projet_nom: projets.find((p) => p.id === l.projet_id)?.nom,
          });
          if (!r.ok) erreurs.push(`${emp.nom} · ${l.heures_effectives}h · ${dateLigne} : ${r.erreur || "inconnu"}`);
          else if (r.offline) enFile++;
        }
      }
      if (erreurs.length > 0) {
        toast(`❌ ${erreurs.length} erreur(s) à la saisie :\n${erreurs.slice(0, 3).join("\n")}${erreurs.length > 3 ? `\n+${erreurs.length - 3} autres` : ""}`, "error");
        setLoading(false);
        return;
      }
      const totalPhotosVoulues = valides.reduce((s, l) => s + l.photos.length, 0);
      if (enFile > 0) {
        // Les photos, elles, ne sont PAS gardées hors ligne (trop lourdes pour le stockage
        // local) : on le dit, au lieu de les perdre en silence.
        toast(`📴 Hors ligne — ${enFile} saisie(s) d'heures gardée(s) sur l'appareil, elles partiront au retour du réseau${totalPhotosVoulues > 0 ? `. ${totalPhotosVoulues} photo(s) NON gardée(s) : reprends-les depuis la fiche du projet` : ""}`, "warning");
        setLignes([{ projet_id: projets[0]?.id || 0, heures: "", description: "", photos: [], heure_debut: "07:00", heure_fin: "15:00", dejeuner_retire: true }]);
        onClose();
        return;
      }

      // Sauvegarder les photos par projet × ligne
      const nomsEmps = empsActifs.map((e) => e.nom).join(", ");
      const photosInserts: Promise<any>[] = [];
      for (const l of valides) {
        for (const p of l.photos) {
          photosInserts.push(fetch("/api/photos", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projet_id: l.projet_id, date: l.date || date, employes: nomsEmps,
              photo_data: p.data, photo_type: p.type, description: l.description || p.nom, thumb_data: p.thumb || null,
            }),
          }));
        }
      }
      const totalPhotos = valides.reduce((s, l) => s + l.photos.length, 0);
      // Les heures sont DÉJÀ enregistrées à ce stade : si une photo échoue, il ne faut ni
      // annoncer un succès complet, ni laisser l'exception remonter (la modale restait
      // alors ouverte sans message, et re-cliquer créait des heures en double).
      let photosOk = 0;
      if (photosInserts.length > 0) {
        const res = await Promise.allSettled(photosInserts);
        photosOk = res.filter((x) => x.status === "fulfilled" && (x.value as Response)?.ok).length;
      }
      const photosEchouees = totalPhotos - photosOk;

      toast(`✓ ${totalHeures} h × ${empsActifs.length} employé(s)${photosOk > 0 ? ` + ${photosOk} photo(s)` : ""} (${formatCAD(totalCout)})`, "success");
      if (photosEchouees > 0) {
        toast(`⚠️ ${photosEchouees} photo(s) NON enregistrée(s) — tes heures sont sauvées, reprends les photos depuis la fiche du projet`, "error");
      }
      setLignes([{ projet_id: projets[0]?.id || 0, heures: "", description: "", photos: [], heure_debut: "07:00", heure_fin: "15:00", dejeuner_retire: true }]);
      onSuccess?.();
      onClose();
    } finally { setLoading(false); }
  };

  return (
    <BottomSheet
      ouvert={ouvert}
      onClose={onClose}
      titre="⏱️ Saisir mes heures"
      soustitre="Multi-employés, multi-projets · pour modifier d'anciennes heures → onglet Horaire"
      couleurHeader="from-emerald-600 to-teal-600"
      footer={
        <>
          <button onClick={onClose} className="px-4 py-3 bg-slate-200 hover:bg-slate-300 rounded-lg text-sm font-semibold">Annuler</button>
          <button onClick={enregistrer} disabled={loading || projets.length === 0} className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-bold disabled:opacity-50">
            {loading ? "⏳..." : "💾 Enregistrer"}
          </button>
        </>
      }
    >
      <div className="mb-3">
        <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-3 border rounded-lg text-sm" />
      </div>

      {/* Sélection employés */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <label className="text-xs font-medium text-slate-600">Employés ({empSelectionnes.size} sélectionné(s))</label>
          <button type="button" onClick={() => setAjoutEmpOuvert(!ajoutEmpOuvert)} className="text-xs text-emerald-700 hover:underline font-semibold">
            {ajoutEmpOuvert ? "✕ Annuler" : "＋ Nouvel employé"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {employes.map((e) => {
            const selected = empSelectionnes.has(e.id);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => toggleEmp(e.id)}
                className={`text-left px-3 py-2 rounded-lg border-2 transition ${selected ? "bg-emerald-50 border-emerald-500" : "bg-white border-slate-200 hover:border-emerald-300"}`}
              >
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={selected} readOnly className="w-4 h-4" />
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{e.nom}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {ajoutEmpOuvert && (
          <div className="mt-2 p-3 bg-emerald-50 border-2 border-emerald-200 rounded-lg space-y-2">
            <input type="text" autoCapitalize="words" placeholder="Nom complet" value={nouvelEmp.nom} onChange={(e) => setNouvelEmp({ ...nouvelEmp, nom: e.target.value })} className="w-full px-3 py-2 border rounded text-sm" />
            <div className="flex gap-2">
              {/* type="text" : un <input type="number"> refuse la virgule du clavier québécois (valeur vidée en silence). */}
              <input type="text" inputMode="decimal" placeholder="Taux $/h (ex. : 30,50)" value={nouvelEmp.taux_horaire} onChange={(e) => setNouvelEmp({ ...nouvelEmp, taux_horaire: e.target.value })} className="flex-1 px-3 py-2 border rounded text-sm text-right" />
              <button onClick={ajouterEmploye} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-bold">Ajouter</button>
            </div>
            <p className="text-[10px] text-slate-600">Configurer les infos complètes dans l'onglet <a href="/employes" className="font-bold underline">Employés</a></p>
          </div>
        )}
      </div>

      {erreurEmployes && <div className="mb-3"><ErreurChargement compact erreur={`employés : ${erreurEmployes}`} onReessayer={chargerEmployes} /></div>}

      {projets.length === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-900">
          ⚠️ Aucun projet disponible. Vérifie tes projets dans <a href="/projets" className="font-bold underline">la liste</a> — si un projet existe mais n'apparaît pas ici, son statut est peut-être "complete" ou "annulé".
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {lignes.map((l, i) => {
              const proj = projets.find((p) => p.id === l.projet_id);
              const heuresCalc = heuresEffectives(l);
              return (
                <div key={i} className="border-2 border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Projet</label>
                      {/* `afficherTous` : champ vide, la liste propose tous les chantiers
                          disponibles au lieu des seuls chantiers en cours — dans l'ordre
                          en cours → à venir → complétés. */}
                      <ProjetPicker value={l.projet_id} onChange={(pid) => modifier(i, { projet_id: pid })} projets={projets} afficherTous />
                    </div>
                    <div className="w-36">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Date {l.date && l.date !== date && <span className="text-amber-600">⚠</span>}</label>
                      <input type="date" value={l.date || date} onChange={(e) => modifier(i, { date: e.target.value })} className="w-full px-2 py-3 border rounded-lg text-sm" title="Date spécifique à cette ligne (par défaut = date globale en haut)" />
                    </div>
                    {lignes.length > 1 && (
                      <button type="button" onClick={() => supprimerLigne(i)} aria-label={`Retirer la ligne ${i + 1}`} className="w-12 h-12 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-base flex-shrink-0">✕</button>
                    )}
                  </div>

                  {/* Heures d'entrée/sortie + dîner */}
                  <div className="bg-white border rounded-lg p-2 space-y-2">
                    <div className="grid grid-cols-3 gap-2 items-end">
                      <div>
                        <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Entrée</label>
                        <input type="time" value={l.heure_debut} onChange={(e) => modifier(i, { heure_debut: e.target.value, heures: "" })} className="w-full px-2 py-2 border rounded text-sm" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-600 mb-0.5">Sortie</label>
                        <input type="time" value={l.heure_fin} onChange={(e) => modifier(i, { heure_fin: e.target.value, heures: "" })} className="w-full px-2 py-2 border rounded text-sm" />
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-500">Total</div>
                        <div className="text-lg font-bold text-emerald-700">{heuresCalc.toFixed(2)} h</div>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input type="checkbox" checked={l.dejeuner_retire} onChange={(e) => modifier(i, { dejeuner_retire: e.target.checked, heures: "" })} className="w-4 h-4" />
                      <span>🥪 Retirer dîner (30 min)</span>
                    </label>
                    <details className="text-[10px]">
                      <summary className="text-slate-500 cursor-pointer">Saisie manuelle des heures</summary>
                      <div className="mt-1">
                        <input type="text" inputMode="decimal" placeholder="ex. : 7,5" value={l.heures} onChange={(e) => modifier(i, { heures: e.target.value })} className={`w-full px-2 py-2 border rounded text-sm text-right font-bold ${heuresIllisibles(l) ? "border-red-500" : ""}`} aria-invalid={heuresIllisibles(l)} />
                        <p className="text-[10px] text-slate-500 mt-0.5">Si rempli, écrase le calcul début/fin.</p>
                      </div>
                    </details>
                  </div>
                  <div className="flex gap-2 items-start">
                    <textarea value={l.description} onChange={(e) => modifier(i, { description: e.target.value })} rows={3} placeholder="Description / rapport de journée (optionnel) — ou utilise le micro →" className="flex-1 px-3 py-2 border rounded text-xs bg-white resize-y min-h-[4.5rem] leading-relaxed" />
                    <MicVocal taille="sm" onTranscript={(t) => modifier(i, { description: (l.description ? l.description + " " : "") + t })} titre="Dicter le rapport de journée pour ce projet" />
                  </div>

                  {/* 📸 Photos du jour pour CE projet */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] font-semibold text-slate-600">📸 Photos du jour ({l.photos.length})</label>
                      <div className="flex gap-1">
                        <label className="cursor-pointer text-[10px] bg-blue-100 hover:bg-blue-200 text-blue-800 px-2 py-1 rounded font-semibold">
                          📷 Photo
                          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && ajouterPhoto(i, e.target.files[0])} />
                        </label>
                        <label className="cursor-pointer text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-800 px-2 py-1 rounded font-semibold">
                          📁 Galerie
                          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []); files.forEach((f) => ajouterPhoto(i, f)); }} />
                        </label>
                      </div>
                    </div>
                    {l.photos.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {l.photos.map((p, pi) => (
                          <div key={pi} className="relative w-14 h-14">
                            <img src={p.data} alt={p.nom} className="w-14 h-14 object-cover rounded border" />
                            {/* Cible tactile 44 px (la pastille visible reste petite) */}
                            <button type="button" onClick={() => retirerPhoto(i, pi)} aria-label={`Retirer la photo ${p.nom}`} className="absolute -top-3 -right-3 w-11 h-11 flex items-center justify-center">
                              <span aria-hidden="true" className="bg-red-500 text-white rounded-full w-5 h-5 text-xs font-bold flex items-center justify-center shadow">✕</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {proj && heuresCalc > 0 && empsActifs.length > 0 && (
                    <div className="text-xs text-slate-600 flex justify-between">
                      <span>Reste budget: {formatCAD((proj.budget_estime || 0) - proj.cout_total)}</span>
                      <span className="font-bold text-emerald-700">+ {formatCAD(heuresCalc * coutEmployes)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button onClick={ajouterLigne} className="w-full mt-2 px-3 py-3 border-2 border-dashed border-slate-300 hover:border-emerald-500 hover:bg-emerald-50 rounded-lg text-sm text-slate-600 font-semibold">
            ＋ Autre projet
          </button>

          {onExtra && (
            <button onClick={onExtra} className="w-full mt-2 px-3 py-3 bg-amber-50 border-2 border-amber-300 hover:bg-amber-100 rounded-lg text-sm text-amber-900 font-bold">
              💲 Un extra à facturer aujourd'hui ? (travaux / matériaux en plus)
            </button>
          )}

          {totalHeures > 0 && empsActifs.length > 0 && (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-3 mt-3 flex justify-between items-center">
              <div>
                <div className="text-xs text-emerald-700 uppercase font-bold">Total journée</div>
                <div className="text-2xl font-bold text-emerald-900">{totalHeures} h × {empsActifs.length}</div>
                <div className="text-[10px] text-emerald-700">{empsActifs.map(e => e.nom).join(", ")}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-emerald-700">Coût MO</div>
                <div className="text-xl font-bold text-emerald-900">{formatCAD(totalCout)}</div>
              </div>
            </div>
          )}
        </>
      )}
    </BottomSheet>
  );
}

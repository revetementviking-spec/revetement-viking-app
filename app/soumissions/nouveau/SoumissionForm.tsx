"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MATERIAUX, LIBELLE_CATEGORIE, type Categorie } from "@/data/materiaux";
import { TAUX_HORAIRE_VENTE, FRAIS_FORFAITAIRES, PARAMS_DEFAUT } from "@/data/main-oeuvre";
import { calculerSoumission, formatCAD, type LigneSoumission, type FraisActif } from "@/lib/calculateur";
import { PRESETS, type PresetMateriau } from "@/data/presets-soumission";
import { mapperHoverVersLignes, type HoverMesures } from "@/lib/hover-mapping";
import { sauvegarderBrouillon, chargerBrouillon, effacerBrouillon } from "@/lib/autosave";
import dynamic from "next/dynamic";
import Navigation from "@/components/Navigation";
import { useToast } from "@/components/Toasts";

// Lazy load — composant lourd avec SpeechRecognition + UI complète
const NotesVocales = dynamic(() => import("@/components/NotesVocales"), { ssr: false });

const CATEGORIES_ORDRE: Categorie[] = [
  "soffite", "fascia", "solin",
  "parement-vinyle", "parement-aluminium", "parement-composite",
  "accessoire", "depart", "rouleau",
];

interface ChatMessage { role: "user" | "assistant"; content: string; }

export default function SoumissionForm() {
  const [modifierNumero, setModifierNumero] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      setModifierNumero(p.get("modifier"));
    }
  }, []);
  const { toast } = useToast();

  const [client, setClient] = useState({ nom: "", adresse: "", telephone: "", courriel: "", projet: "" });
  const [numeroSoumission, setNumeroSoumission] = useState("");
  const [lignes, setLignes] = useState<LigneSoumission[]>([]);
  const [fraisActifs, setFraisActifs] = useState<FraisActif[]>(
    FRAIS_FORFAITAIRES.filter((f) => f.obligatoire).map((f) => ({ id: f.id, heures: f.heuresEstimees }))
  );
  const [fraisGestion, setFraisGestion] = useState(PARAMS_DEFAUT.fraisGestion);
  const [appliquerTaxes, setAppliquerTaxes] = useState(true);
  const [autosaveStatus, setAutosaveStatus] = useState<"" | "saving" | "saved">("");
  const [draftRestaure, setDraftRestaure] = useState(false);

  const [filtreFournisseur, setFiltreFournisseur] = useState<string>("tous");
  const [recherche, setRecherche] = useState("");
  const [hoverExtraction, setHoverExtraction] = useState<any>(null);
  const [hoverLoading, setHoverLoading] = useState(false);
  const [presetSelectionne, setPresetSelectionne] = useState<string | null>(null);
  const hoverFileRef = useRef<HTMLInputElement>(null);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // === AUTO-ESTIMATEUR ===
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoEtape, setAutoEtape] = useState<string>("");
  const [autoRapport, setAutoRapport] = useState<any>(null);

  // === AGENT VISION MULTI-PHOTOS ===
  const [photosVision, setPhotosVision] = useState<File[]>([]);
  const [referenceEchelle, setReferenceEchelle] = useState("Porte de garage standard 9'");
  const [descriptionVision, setDescriptionVision] = useState("");
  const [visionLoading, setVisionLoading] = useState(false);
  const photosVisionRef = useRef<HTMLInputElement>(null);

  const [chargementSave, setChargementSave] = useState(false);
  const [chargementPDF, setChargementPDF] = useState(false);
  const [chargementCmd, setChargementCmd] = useState(false);
  const [chargementPrix, setChargementPrix] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  const fournisseurs = useMemo(() => Array.from(new Set(MATERIAUX.map((m) => m.fournisseur))), []);

  const materiauxFiltres = useMemo(() => MATERIAUX.filter((m) => {
    if (filtreFournisseur !== "tous" && m.fournisseur !== filtreFournisseur) return false;
    if (recherche && !`${m.nom} ${m.code}`.toLowerCase().includes(recherche.toLowerCase())) return false;
    return true;
  }), [filtreFournisseur, recherche]);

  // === CHARGEMENT INITIAL : édition ou brouillon ===
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    if (modifierNumero) {
      fetch(`/api/soumissions?numero=${modifierNumero}`).then((r) => r.json()).then((d) => {
        if (d.payload) {
          setClient(d.payload.client || client);
          setLignes(d.payload.lignes || []);
          setFraisActifs(d.payload.fraisActifs || []);
          setFraisGestion(d.payload.fraisGestion ?? PARAMS_DEFAUT.fraisGestion);
          setAppliquerTaxes(d.payload.appliquerTaxes ?? true);
          setHoverExtraction(d.payload.hoverExtraction || null);
          setNumeroSoumission(d.numero);
        }
      });
    } else {
      const draft = chargerBrouillon();
      if (draft && (draft.lignes?.length > 0 || draft.client?.nom)) {
        if (confirm("Un brouillon non sauvegardé existe. Le restaurer ?")) {
          setClient(draft.client || client);
          setLignes(draft.lignes || []);
          setFraisActifs(draft.fraisActifs || []);
          setFraisGestion(draft.fraisGestion ?? PARAMS_DEFAUT.fraisGestion);
          setAppliquerTaxes(draft.appliquerTaxes ?? true);
          setHoverExtraction(draft.hoverExtraction || null);
          setNumeroSoumission(draft.numero || "");
          setDraftRestaure(true);
        } else {
          effacerBrouillon();
        }
      }
    }
  }, [modifierNumero]);

  const ajouterLigne = (code: string, quantite = 0) => {
    const mat = MATERIAUX.find((m) => m.code === code);
    if (!mat) return;
    setLignes((prev) => [...prev, { materiauCode: code, quantite, surplus: mat.surplusDefaut, margePct: PARAMS_DEFAUT.margeMateriauxDefaut }]);
  };
  const modifierLigne = (idx: number, patch: Partial<LigneSoumission>) =>
    setLignes((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const supprimerLigne = (idx: number) => setLignes((prev) => prev.filter((_, i) => i !== idx));
  const toggleFrais = (id: string) => {
    setFraisActifs((prev) => {
      const exists = prev.find((f) => f.id === id);
      if (exists) return prev.filter((f) => f.id !== id);
      const def = FRAIS_FORFAITAIRES.find((f) => f.id === id);
      return [...prev, { id, heures: def?.heuresEstimees || 0 }];
    });
  };

  const calcul = useMemo(
    () => calculerSoumission({ lignes, fraisActifs, fraisGestion, appliquerTaxes }),
    [lignes, fraisActifs, fraisGestion, appliquerTaxes]
  );

  // === AUTOSAVE (toutes les 3 sec si modif) ===
  useEffect(() => {
    if (!initialLoadDone.current) return;
    if (lignes.length === 0 && !client.nom) return;
    setAutosaveStatus("saving");
    const t = setTimeout(() => {
      sauvegarderBrouillon({
        numero: numeroSoumission,
        client, lignes, fraisActifs, fraisGestion, appliquerTaxes,
        hoverExtraction,
      });
      setAutosaveStatus("saved");
      setTimeout(() => setAutosaveStatus(""), 1500);
    }, 1500);
    return () => clearTimeout(t);
  }, [client, lignes, fraisActifs, fraisGestion, appliquerTaxes, hoverExtraction, numeroSoumission]);

  // === RACCOURCIS CLAVIER (Ctrl/Cmd+S : sauvegarder) ===
  const sauverRef = useRef<() => void>(() => {});

  // === PRESET ===
  const appliquerPreset = (preset: PresetMateriau) => {
    setPresetSelectionne(preset.id);
    if (hoverExtraction?.mesures_globales) {
      setLignes(mapperHoverVersLignes(preset, hoverExtraction.mesures_globales as HoverMesures));
    } else {
      setLignes(preset.lignes.map((pl) => {
        const mat = MATERIAUX.find((m) => m.code === pl.materiauCode);
        return {
          materiauCode: pl.materiauCode,
          quantite: pl.quantiteDefaut || 0,
          surplus: mat?.surplusDefaut || 0.10,
          margePct: PARAMS_DEFAUT.margeMateriauxDefaut,
        };
      }));
    }
  };

  const uploadHover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setHoverLoading(true);
    setHoverExtraction(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/hover", { method: "POST", body: fd });
      const d = await r.json();
      if (d.ok) {
        setHoverExtraction(d.extraction);
        if (d.extraction.adresse && !client.adresse) setClient((c) => ({ ...c, adresse: d.extraction.adresse }));
        if (presetSelectionne) {
          const p = PRESETS.find((x) => x.id === presetSelectionne);
          if (p) setLignes(mapperHoverVersLignes(p, d.extraction.mesures_globales));
        }
      } else {
        alert("Erreur : " + (d.error || "inconnue"));
      }
    } finally {
      setHoverLoading(false);
      if (hoverFileRef.current) hoverFileRef.current.value = "";
    }
  };

  const envoyerMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    try {
      const etat = {
        client,
        lignes: lignes.map((l) => {
          const mat = MATERIAUX.find((m) => m.code === l.materiauCode);
          return { code: l.materiauCode, nom: mat?.nom, categorie: mat?.categorie, quantite: l.quantite, unite: mat?.uniteCalcul, surplus: l.surplus, marge: l.margePct, couleur: l.couleur };
        }),
        fraisGestion, total: calcul.total,
        hoverMesures: hoverExtraction?.mesures_globales,
      };
      const r = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.content, etat, historique: newMessages.slice(0, -1) }),
      });
      const d = await r.json();
      if (d.error) {
        setChatMessages((prev) => [...prev, { role: "assistant", content: "❌ " + d.error }]);
      } else {
        if (Array.isArray(d.actions)) d.actions.forEach(appliquerAction);
        setChatMessages((prev) => [...prev, { role: "assistant", content: d.reponse_texte || "OK" }]);
      }
    } finally { setChatLoading(false); }
  };

  // === AGENT VISION MULTI-PHOTOS ===
  const handlePhotosVision = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setPhotosVision(files.slice(0, 6));
  };

  const analyserPhotos = async () => {
    if (photosVision.length === 0) { toast('Sélectionne au moins 1 photo.', 'warning'); return; }
    if (!referenceEchelle.trim()) { toast("Donne une référence d'échelle (ex: porte garage 9', façade 38 pi).", 'warning'); return; }
    setVisionLoading(true);
    setHoverExtraction(null);
    try {
      const fd = new FormData();
      fd.append("reference", referenceEchelle);
      fd.append("description", descriptionVision);
      photosVision.forEach((f, i) => fd.append(`photo_${i}`, f));
      const r = await fetch("/api/vision-mesures", { method: "POST", body: fd });
      const d = await r.json();
      if (d.ok) {
        setHoverExtraction(d.extraction);
        if (presetSelectionne) {
          const p = PRESETS.find((x) => x.id === presetSelectionne);
          if (p) setLignes(mapperHoverVersLignes(p, d.extraction.mesures_globales));
        }
      } else {
        alert("Erreur: " + (d.error || "inconnue") + (d.raw ? "\n\n" + d.raw.slice(0, 300) : ""));
      }
    } catch (e: any) {
      toast('Erreur: ' + e.message, 'error');
    } finally {
      setVisionLoading(false);
    }
  };

  // === AUTO-ESTIMATEUR : plan → matériaux → prix → soumission ===
  const construireAutoSoumission = async () => {
    if (!hoverExtraction?.mesures_globales) {
      toast("Téléverse d'abord un plan/photo/Hover pour que l'IA puisse l'analyser.", 'warning');
      return;
    }
    setAutoLoading(true);
    setAutoRapport(null);
    setAutoEtape("Sélection des matériaux du catalogue...");
    try {
      const r = await fetch("/api/auto-estimateur", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extraction: hoverExtraction,
          preferenceMateriau: presetSelectionne, // "vinyle-complet" si présélectionné, sinon null
        }),
      });
      const d = await r.json();
      if (d.error) { toast('Erreur : ' + d.error, 'error'); return; }

      // Appliquer les lignes générées
      if (Array.isArray(d.lignes_generees)) {
        const nouvellesLignes: LigneSoumission[] = d.lignes_generees.map((g: any) => {
          const mat = MATERIAUX.find((m) => m.code === g.materiauCode);
          return {
            materiauCode: g.materiauCode,
            quantite: g.quantite || 0,
            surplus: g.surplus ?? mat?.surplusDefaut ?? 0.10,
            margePct: g.margePct ?? PARAMS_DEFAUT.margeMateriauxDefaut,
            couleur: g.couleur,
            note: g.note,
          };
        });
        setLignes(nouvellesLignes);
      }
      if (Array.isArray(d.frais_forfaitaires)) {
        setFraisActifs(d.frais_forfaitaires.map((f: any) => ({ id: f.id, heures: f.heures })));
      }
      setAutoRapport(d);
    } catch (e: any) {
      toast('Erreur : ' + e.message, 'error');
    } finally {
      setAutoLoading(false);
      setAutoEtape("");
    }
  };

  // === HANDLER NOTES VOCALES ===
  const appliquerAjustementsVocaux = (ajustements: any[], transcription: string) => {
    for (const a of ajustements) {
      switch (a.type) {
        case "ajouter_heures_categorie": {
          // Trouver une frais forfaitaire dédiée OU ajouter à fraisActifs avec ID dédié
          const id = `complexite-${a.categorie}`;
          setFraisActifs((prev) => {
            const exist = prev.find((f) => f.id === id);
            if (exist) return prev.map((f) => f.id === id ? { ...f, heures: f.heures + a.heures } : f);
            return [...prev, { id, heures: a.heures }];
          });
          break;
        }
        case "ajouter_frais_forfaitaire": {
          const fid = a.id_frais || a.id;
          setFraisActifs((prev) => {
            const exist = prev.find((f) => f.id === fid);
            if (exist) return prev.map((f) => f.id === fid ? { ...f, heures: f.heures + a.heures } : f);
            return [...prev, { id: fid, heures: a.heures }];
          });
          break;
        }
        case "modifier_marge":
          setLignes((prev) => prev.map((l) => ({ ...l, margePct: a.margePct })));
          break;
        case "ajouter_ligne": {
          const mat = MATERIAUX.find((m) => m.code === a.materiauCode);
          if (!mat) break;
          setLignes((prev) => [...prev, { materiauCode: a.materiauCode, quantite: a.quantite || 0, surplus: mat.surplusDefaut, margePct: PARAMS_DEFAUT.margeMateriauxDefaut, couleur: a.couleur }]);
          break;
        }
        case "modifier_quantite_par_categorie":
          setLignes((prev) => prev.map((l) => {
            const mat = MATERIAUX.find((m) => m.code === l.materiauCode);
            return mat?.categorie === a.categorie ? { ...l, quantite: a.quantite } : l;
          }));
          break;
        case "appliquer_couleur_partout":
          setLignes((prev) => prev.map((l) => ({ ...l, couleur: a.couleur })));
          break;
        case "ajouter_note":
          setClient((c) => ({ ...c, projet: (c.projet ? c.projet + " | " : "") + a.note_texte }));
          break;
      }
    }
  };

  const appliquerAction = (a: any) => {
    switch (a.type) {
      case "definir_client":
        setClient((c) => ({ ...c, [a.champ]: a.valeur }));
        break;
      case "modifier_quantite_par_categorie":
        setLignes((prev) => prev.map((l) => {
          const mat = MATERIAUX.find((m) => m.code === l.materiauCode);
          return mat?.categorie === a.categorie ? { ...l, quantite: a.quantite } : l;
        }));
        break;
      case "appliquer_couleur_partout":
        setLignes((prev) => prev.map((l) => {
          const mat = MATERIAUX.find((m) => m.code === l.materiauCode);
          // Appliquer couleur seulement sur parements et fascia/soffite/solins
          if (mat && ["parement-vinyle", "parement-aluminium", "parement-composite", "soffite", "fascia", "solin", "accessoire", "rouleau", "depart"].includes(mat.categorie)) {
            return { ...l, couleur: a.couleur };
          }
          return l;
        }));
        break;
      case "ajouter_ligne": {
        const mat = MATERIAUX.find((m) => m.code === a.materiauCode);
        if (!mat) return;
        setLignes((prev) => [...prev, {
          materiauCode: a.materiauCode, quantite: a.quantite || 0,
          surplus: a.surplus ?? mat.surplusDefaut,
          margePct: a.margePct ?? PARAMS_DEFAUT.margeMateriauxDefaut,
          couleur: a.couleur,
        }]);
        break;
      }
      case "modifier_ligne":
        setLignes((prev) => prev.map((l, i) => i === a.index ? { ...l, ...(a.quantite !== undefined && { quantite: a.quantite }), ...(a.surplus !== undefined && { surplus: a.surplus }), ...(a.margePct !== undefined && { margePct: a.margePct }), ...(a.couleur !== undefined && { couleur: a.couleur }) } : l));
        break;
      case "supprimer_ligne":
        setLignes((prev) => prev.filter((_, i) => i !== a.index));
        break;
      case "modifier_marge_globale":
        setLignes((prev) => prev.map((l) => ({ ...l, margePct: a.margePct })));
        break;
      case "modifier_frais_gestion":
        setFraisGestion(a.pct);
        break;
      case "ajouter_frais_forfaitaire":
        setFraisActifs((prev) => prev.find((f) => f.id === a.id) ? prev : [...prev, { id: a.id, heures: a.heures }]);
        break;
      case "vider_toutes_lignes":
        setLignes([]); break;
      case "appliquer_preset": {
        const p = PRESETS.find((x) => x.id === a.presetId);
        if (p) appliquerPreset(p);
        break;
      }
    }
  };

  const sauvegarder = async () => {
    if (!client.nom) { toast('Entre au moins le nom du client.', 'warning'); return; }
    setChargementSave(true);
    try {
      const r = await fetch("/api/soumissions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero: numeroSoumission || undefined,
          client, total: calcul.total,
          heuresEstimees: calcul.totalHeures,
          data: { client, lignes, fraisActifs, fraisGestion, appliquerTaxes, hoverExtraction },
        }),
      });
      const d = await r.json();
      if (d.numero) {
        setNumeroSoumission(d.numero);
        effacerBrouillon();
      }
      toast(`Sauvegardée : ${d.numero}`, "success");
    } finally { setChargementSave(false); }
  };

  // Enregistre la dernière version de sauvegarder + écoute Ctrl/Cmd+S
  useEffect(() => { sauverRef.current = sauvegarder; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        sauverRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const telechargerPDF = async (): Promise<{ numero: string; blob: Blob } | null> => {
    if (!client.nom) { toast('Entre au moins le nom du client.', 'warning'); return null; }
    setChargementPDF(true);
    try {
      const { genererPDFBlob } = await import("@/lib/pdf-soumission");
      const numero = numeroSoumission || `XP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-DRAFT`;
      const blob = await genererPDFBlob({ client, numeroSoumission: numero, date: new Date().toLocaleDateString("fr-CA"), calcul });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `Soumission-${numero}-${client.nom.replace(/[^a-z0-9]/gi, "_")}.pdf`; a.click();
      URL.revokeObjectURL(url);
      return { numero, blob };
    } finally { setChargementPDF(false); }
  };

  const telechargerCommande = async () => {
    if (lignes.length === 0) { toast("Ajoute des matériaux d'abord.", 'warning'); return; }
    setChargementCmd(true);
    try {
      const { genererCommandeBlob } = await import("@/lib/pdf-commande");
      const numero = numeroSoumission || "DRAFT";
      const blob = await genererCommandeBlob({
        numeroSoumission: numero, date: new Date().toLocaleDateString("fr-CA"),
        client: { nom: client.nom, adresse: client.adresse, projet: client.projet },
        calcul,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `Commande-${numero}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } finally { setChargementCmd(false); }
  };

  const envoyerEmail = async () => {
    if (!client.courriel) { toast("Ajoute l'adresse courriel du client.", 'warning'); return; }
    const result = await telechargerPDF();
    if (!result) return;
    const sujet = `Soumission ${result.numero} - ${client.projet || "Revêtement extérieur"}`;
    const corps = `Bonjour ${client.nom},

Vous trouverez ci-joint la soumission pour les travaux de revêtement extérieur${client.projet ? ` - ${client.projet}` : ""}.

Numéro : ${result.numero}
Montant total : ${formatCAD(calcul.total)}
Validité : 30 jours

Le PDF vient d'être téléchargé sur votre ordinateur. Joignez-le manuellement à cet email avant d'envoyer.

N'hésitez pas à me contacter pour toute question.

Cordialement,
Frédéric
Revêtement Viking Inc.
RBQ 5811-4299-01
info@entreprisesxpress.ca`;
    window.location.href = `mailto:${client.courriel}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`;
  };

  const verifierPrix = async (code: string) => {
    const mat = MATERIAUX.find((m) => m.code === code);
    if (!mat) return;
    setChargementPrix(code);
    try {
      const r = await fetch("/api/prix-web", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nom: mat.nom, code: mat.code, fournisseur: mat.fournisseur }),
      });
      const d = await r.json();
      if (d.error) { toast('Erreur: ' + d.error, 'error'); return; }
      const msg = (d.prix_trouves || []).map((p: any) => `${p.source}: ${p.prix}$`).join("\n");
      toast(`${mat.nom}\nInterne: ${mat.prixCoutantParUniteCalcul.toFixed(2)}$/${mat.uniteCalcul}\n${msg || "Aucun prix web"}\n${d.note || ""}`, "info");
    } finally { setChargementPrix(null); }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Navigation
        titre="Revêtement Viking"
        soustitre={`RBQ 5811-4299-01${numeroSoumission ? ` · ${numeroSoumission}` : ""}`}
        badge={
          <>
            {autosaveStatus === "saving" && <span className="text-xs text-amber-300">⏳ Sauvegarde...</span>}
            {autosaveStatus === "saved" && <span className="text-xs text-emerald-300">✓ Auto-sauvé</span>}
            {draftRestaure && <span className="text-xs bg-amber-500 text-slate-900 px-2 py-0.5 rounded ml-1">📂 Brouillon</span>}
            {modifierNumero && <span className="text-xs bg-blue-500 text-white px-2 py-0.5 rounded ml-1">✏️ Modif</span>}
          </>
        }
        actions={
          <>
            <button onClick={sauvegarder} disabled={chargementSave} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold disabled:opacity-50 text-left">{chargementSave ? "..." : "💾 Sauver"}</button>
            <button onClick={telechargerPDF} disabled={chargementPDF} className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded text-sm font-semibold disabled:opacity-50 text-left">{chargementPDF ? "..." : "📄 PDF"}</button>
            <button onClick={envoyerEmail} className="px-3 py-2 bg-blue-500 hover:bg-blue-400 text-white rounded text-sm font-semibold text-left">✉️ Email</button>
            <button onClick={telechargerCommande} disabled={chargementCmd} className="px-3 py-2 bg-orange-500 hover:bg-orange-400 text-white rounded text-sm text-left">{chargementCmd ? "..." : "🛒 Commande"}</button>
          </>
        }
      />

      <main className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          {/* HOVER */}
          <section className="bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-lg p-5">
            <h2 className="text-lg font-bold mb-1">🤖 1. Analyse Hover / photo / plan</h2>
            <p className="text-sm text-slate-600 mb-3">Téléverse un PDF Hover, plan ou photo. L'IA extrait tout.</p>
            <input ref={hoverFileRef} type="file" accept="application/pdf,image/*" onChange={uploadHover} disabled={hoverLoading} className="text-sm" />
            {hoverLoading && <p className="text-indigo-700 text-sm mt-2">⏳ Analyse (30-60 sec)...</p>}
            {hoverExtraction && (
              <div className="mt-4 bg-white rounded p-4 text-sm space-y-2">
                <div className="font-semibold">{hoverExtraction.resume}</div>
                {hoverExtraction.adresse && <div className="text-slate-600">📍 {hoverExtraction.adresse}</div>}
                {hoverExtraction.mesures_globales && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
                    {Object.entries(hoverExtraction.mesures_globales).filter(([_, v]) => v != null).map(([k, v]: any) => (
                      <div key={k} className="bg-indigo-50 rounded p-2">
                        <div className="text-xs text-slate-500 capitalize">{k.replace(/_/g, " ")}</div>
                        <div className="font-bold text-indigo-900">{v}</div>
                      </div>
                    ))}
                  </div>
                )}
                {hoverExtraction.estimation_heures_installation && (
                  <div className="mt-2 text-xs bg-amber-50 rounded p-2"><strong>Heures IA :</strong> {hoverExtraction.estimation_heures_installation.total} h</div>
                )}
                {hoverExtraction.elements_remarquables?.length > 0 && (
                  <div className="mt-2 text-xs"><strong>À noter :</strong> {hoverExtraction.elements_remarquables.join(" · ")}</div>
                )}

                {/* Bouton AUTO-ESTIMATEUR */}
                <div className="mt-4 pt-4 border-t border-indigo-200">
                  <button
                    onClick={construireAutoSoumission}
                    disabled={autoLoading}
                    className="w-full px-4 py-3 bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:from-fuchsia-500 hover:to-pink-500 text-white rounded-lg font-bold text-base shadow-md disabled:opacity-50 transition"
                  >
                    {autoLoading ? `⏳ ${autoEtape || "L'IA construit la soumission..."}` : "✨ Construire la soumission automatiquement"}
                  </button>
                  <p className="text-xs text-slate-500 mt-1 text-center">
                    L'IA choisit les matériaux, calcule les quantités, vérifie les prix sur le web et bâtit la soumission complète.
                  </p>
                </div>
              </div>
            )}

            {/* RAPPORT AUTO-ESTIMATEUR */}
            {autoRapport && (
              <div className="mt-4 bg-white border-2 border-fuchsia-300 rounded p-4 text-sm space-y-3">
                <div className="font-bold text-fuchsia-900">✨ Stratégie de soumission générée</div>
                <p className="text-slate-700">{autoRapport.resume_strategie}</p>
                {autoRapport.heures_totales_estimees && (
                  <div className="text-xs bg-amber-50 rounded p-2">
                    <strong>Heures totales estimées :</strong> {autoRapport.heures_totales_estimees} h
                  </div>
                )}
                {autoRapport.verifications_web?.length > 0 && (
                  <div>
                    <div className="font-semibold text-xs text-indigo-700 mb-1">🌐 Vérifications de prix sur le web :</div>
                    {autoRapport.verifications_web.map((v: any, i: number) => (
                      <div key={i} className="text-xs bg-indigo-50 rounded p-2 mb-1">
                        <strong>{v.code}</strong> — Web : {v.prix_web_moyen}$ {v.ecart_pct ? `(écart ${v.ecart_pct}%)` : ""}
                        <div className="text-slate-600">{v.note}</div>
                        {v.source && <div className="text-slate-500 text-[10px]">📎 {v.source}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {autoRapport.elements_a_clarifier?.length > 0 && (
                  <div className="text-xs">
                    <div className="font-semibold text-amber-700">⚠️ À clarifier :</div>
                    <ul className="list-disc list-inside text-slate-700">
                      {autoRapport.elements_a_clarifier.map((e: string, i: number) => <li key={i}>{e}</li>)}
                    </ul>
                  </div>
                )}
                {autoRapport.items_manquants_catalogue?.length > 0 && (
                  <div className="text-xs">
                    <div className="font-semibold text-red-700">❌ Items manquants au catalogue :</div>
                    <ul className="list-disc list-inside text-slate-700">
                      {autoRapport.items_manquants_catalogue.map((e: any, i: number) => (
                        <li key={i}>{e.description} — {e.raison}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* AGENT VISION MULTI-PHOTOS */}
          <section className="bg-gradient-to-br from-cyan-50 to-sky-50 border-2 border-cyan-300 rounded-lg p-5">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <h2 className="text-lg font-bold">📸 1bis. Agent vision multi-photos</h2>
              <span className="text-xs bg-amber-100 text-amber-900 px-2 py-1 rounded font-semibold">Précision ~85% (PAS pour commande matériaux)</span>
            </div>
            <p className="text-sm text-slate-600 mb-3">
              Pas de rapport Hover? Téléverse 3-5 photos d'une maison + UNE référence d'échelle, l'IA estime les dimensions. Idéal pour <strong>pré-qualification téléphone</strong> ou <strong>premier estimé terrain</strong>.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  📐 Référence d'échelle (OBLIGATOIRE) <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={referenceEchelle}
                  onChange={(e) => setReferenceEchelle(e.target.value)}
                  placeholder="Ex: Porte de garage simple 9' / Porte avant 36 po / Façade avant 38 pi"
                  className="w-full px-3 py-2 border-2 border-cyan-200 focus:border-cyan-500 rounded text-sm"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Suggestions : "Porte garage double 16'" · "Porte garage simple 9'" · "Porte avant 36 po × 80 po" · "Hauteur étage 9'" · ou écris une dimension réelle connue
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">📷 Photos (1 à 6 — idéalement façade avant + côtés + arrière)</label>
                <input
                  ref={photosVisionRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePhotosVision}
                  className="text-sm"
                />
                {photosVision.length > 0 && (
                  <div className="mt-2 flex gap-2 flex-wrap">
                    {photosVision.map((f, i) => (
                      <div key={i} className="text-xs bg-cyan-100 text-cyan-900 px-2 py-1 rounded">
                        📸 {i + 1}. {f.name.slice(0, 30)} ({(f.size / 1024 / 1024).toFixed(1)} MB)
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">📝 Description optionnelle</label>
                <textarea
                  value={descriptionVision}
                  onChange={(e) => setDescriptionVision(e.target.value)}
                  placeholder="Ex: Maison 2 étages, garage à droite, fronton arrière, parement vinyle existant à remplacer..."
                  rows={2}
                  className="w-full px-3 py-2 border rounded text-sm"
                />
              </div>

              <button
                onClick={analyserPhotos}
                disabled={visionLoading || photosVision.length === 0}
                className="w-full px-4 py-3 bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-white rounded-lg font-bold shadow-md disabled:opacity-50"
              >
                {visionLoading ? "⏳ Analyse des photos en cours (30-90 sec)..." : `🔍 Analyser ${photosVision.length} photo(s) et extraire les mesures`}
              </button>

              {/* Affichage de la confiance + recommandation */}
              {hoverExtraction?.type_rapport === "agent_vision_xpress" && (
                <div className="mt-3 p-3 bg-white rounded border-2 border-cyan-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">📊 Confiance globale :</span>
                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                      hoverExtraction.confiance_globale_pct >= 80 ? "bg-emerald-100 text-emerald-900" :
                      hoverExtraction.confiance_globale_pct >= 60 ? "bg-amber-100 text-amber-900" :
                      "bg-red-100 text-red-900"
                    }`}>
                      {hoverExtraction.confiance_globale_pct}%
                    </span>
                  </div>
                  {hoverExtraction.recommandation && (
                    <p className="text-xs text-slate-700 italic">💡 {hoverExtraction.recommandation}</p>
                  )}
                  {hoverExtraction.limitations?.length > 0 && (
                    <div className="mt-2 text-xs text-amber-800">
                      <strong>Limitations :</strong> {hoverExtraction.limitations.join(" · ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* PRESETS */}
          <section className="bg-white rounded-lg shadow p-5">
            <h2 className="text-lg font-bold mb-1">🎯 2. Type de revêtement</h2>
            <p className="text-sm text-slate-600 mb-3">Clique → lignes auto-remplies. {hoverExtraction && <span className="text-emerald-700 font-semibold">Mesures Hover seront appliquées.</span>}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => appliquerPreset(p)} title={p.description}
                  className={`p-3 border-2 rounded text-left text-sm transition ${presetSelectionne === p.id ? "ring-2 ring-emerald-500 " : ""}${p.couleur} hover:scale-105`}>
                  <div className="text-2xl">{p.icone}</div>
                  <div className="font-semibold mt-1">{p.nom}</div>
                  <div className="text-xs opacity-75">{p.lignes.length} matériaux</div>
                </button>
              ))}
            </div>
          </section>

          {/* CHAT */}
          <section className="bg-gradient-to-br from-emerald-50 to-teal-50 border-2 border-emerald-200 rounded-lg p-5">
            <h2 className="text-lg font-bold mb-1">💬 3. Assistant IA</h2>
            <p className="text-sm text-slate-600 mb-3">Écris ce que tu veux modifier en français.</p>
            <div className="bg-white rounded p-3 max-h-64 overflow-y-auto mb-3 space-y-2 text-sm">
              {chatMessages.length === 0 ? (
                <p className="text-slate-400 italic text-center py-4">Ex: "augmente parement à 2800 pi²"</p>
              ) : (
                chatMessages.map((m, i) => (
                  <div key={i} className={`p-2 rounded ${m.role === "user" ? "bg-blue-50" : "bg-emerald-50"}`}>
                    <div className="text-xs font-bold mb-1">{m.role === "user" ? "Toi" : "Assistant"}</div>
                    {m.content}
                  </div>
                ))
              )}
              {chatLoading && <div className="text-emerald-700 italic">⏳ Réflexion...</div>}
            </div>
            <div className="flex gap-2">
              <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && envoyerMessage()} placeholder="Ex: change parement pour Maibec Canexel..." disabled={chatLoading} className="flex-1 px-3 py-2 border rounded text-sm" />
              <button onClick={envoyerMessage} disabled={chatLoading || !chatInput.trim()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold disabled:opacity-50">Envoyer</button>
            </div>
          </section>

          {/* CLIENT */}
          <section className="bg-white rounded-lg shadow p-5">
            <h2 className="text-lg font-semibold mb-3">Informations client</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input label="Nom du client" value={client.nom} onChange={(v) => setClient({ ...client, nom: v })} />
              <Input label="Téléphone" value={client.telephone} onChange={(v) => setClient({ ...client, telephone: v })} />
              <Input label="Courriel" value={client.courriel} onChange={(v) => setClient({ ...client, courriel: v })} />
              <Input label="Projet" value={client.projet} onChange={(v) => setClient({ ...client, projet: v })} />
              <div className="md:col-span-2"><Input label="Adresse" value={client.adresse} onChange={(v) => setClient({ ...client, adresse: v })} /></div>
            </div>
          </section>

          {/* LIGNES */}
          <section className="bg-white rounded-lg shadow p-5">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-semibold">Matériaux ({lignes.length})</h2>
              {lignes.length > 0 && <button onClick={() => setLignes([])} className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded">Vider</button>}
            </div>
            {lignes.length === 0 ? (
              <p className="text-slate-500 text-sm italic">Aucun matériau. Choisis un préset ou ajoute manuellement.</p>
            ) : (
              <div className="space-y-2">
                {lignes.map((l, idx) => {
                  const mat = MATERIAUX.find((m) => m.code === l.materiauCode);
                  if (!mat) return null;
                  const calc = calcul.lignes[idx];
                  return (
                    <div key={idx} className="border rounded p-2 bg-slate-50">
                      <div className="flex justify-between items-start mb-1">
                        <div className="flex-1">
                          <div className="font-medium text-sm">{mat.nom}</div>
                          <div className="text-xs text-slate-500">[{mat.fournisseur}] {mat.code}</div>
                        </div>
                        <button onClick={() => supprimerLigne(idx)} className="text-red-600 hover:bg-red-50 px-2 rounded text-sm">✕</button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                        <NumInput label={`Qté (${mat.uniteCalcul})`} value={l.quantite} onChange={(v) => modifierLigne(idx, { quantite: v })} />
                        <NumInput label="Surplus %" value={l.surplus * 100} onChange={(v) => modifierLigne(idx, { surplus: v / 100 })} />
                        <NumInput label="Marge %" value={l.margePct * 100} onChange={(v) => modifierLigne(idx, { margePct: v / 100 })} />
                        <TxtInput label="Couleur" value={l.couleur || ""} onChange={(v) => modifierLigne(idx, { couleur: v })} />
                        <div className="flex flex-col">
                          <label className="text-slate-600 mb-1">Cmder</label>
                          <div className="px-2 py-1 bg-white rounded border text-center font-semibold">{calc?.formatACommander ?? 0}</div>
                        </div>
                      </div>
                      {calc && (
                        <div className="mt-1 pt-1 border-t flex flex-wrap justify-between text-xs text-slate-600 gap-2">
                          <span>Mat: <strong>{formatCAD(calc.prixVenteMateriau)}</strong></span>
                          <span>MO: <strong>{calc.heuresMO.toFixed(1)}h</strong></span>
                          <span className="text-emerald-700 font-semibold">{formatCAD(calc.sousTotal)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* CATALOGUE */}
          <details className="bg-white rounded-lg shadow">
            <summary className="cursor-pointer p-5 font-semibold text-lg">➕ Ajouter manuellement</summary>
            <div className="p-5 pt-0">
              <div className="flex gap-2 mb-3 flex-wrap">
                <button onClick={() => setFiltreFournisseur("tous")} className={`px-3 py-1 rounded text-xs ${filtreFournisseur === "tous" ? "bg-slate-900 text-white" : "bg-slate-100"}`}>Tous</button>
                {fournisseurs.map((f) => (
                  <button key={f} onClick={() => setFiltreFournisseur(f)} className={`px-3 py-1 rounded text-xs ${filtreFournisseur === f ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{f}</button>
                ))}
                <input type="text" placeholder="Recherche..." value={recherche} onChange={(e) => setRecherche(e.target.value)} className="flex-1 min-w-40 px-3 py-1 border rounded text-sm" />
              </div>
              <div className="space-y-1">
                {CATEGORIES_ORDRE.map((cat) => {
                  const items = materiauxFiltres.filter((m) => m.categorie === cat);
                  if (!items.length) return null;
                  return (
                    <details key={cat} className="border rounded">
                      <summary className="cursor-pointer px-3 py-2 bg-slate-100 hover:bg-slate-200 font-medium text-sm">{LIBELLE_CATEGORIE[cat]} ({items.length})</summary>
                      <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
                        {items.map((m) => (
                          <div key={m.code} className="flex items-center gap-2">
                            <button onClick={() => ajouterLigne(m.code)} className="flex-1 text-left px-2 py-1 hover:bg-emerald-50 rounded text-sm">
                              <div className="font-medium">{m.nom}</div>
                              <div className="text-xs text-slate-500">[{m.fournisseur}] {m.code} · {formatCAD(m.prixCoutantParUniteCalcul)}/{m.uniteCalcul}</div>
                            </button>
                            <button onClick={() => verifierPrix(m.code)} disabled={chargementPrix === m.code} title="Vérifier prix web" className="px-2 py-1 text-xs bg-indigo-100 hover:bg-indigo-200 rounded">{chargementPrix === m.code ? "..." : "🌐"}</button>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          </details>

          {/* FRAIS */}
          <section className="bg-white rounded-lg shadow p-5">
            <h2 className="text-lg font-semibold mb-3">Frais forfaitaires</h2>
            <div className="space-y-2">
              {FRAIS_FORFAITAIRES.map((f) => {
                const actif = fraisActifs.find((a) => a.id === f.id);
                return (
                  <div key={f.id} className="flex items-center gap-3 text-sm">
                    <input type="checkbox" checked={!!actif} onChange={() => toggleFrais(f.id)} className="w-4 h-4" />
                    <span className="flex-1">{f.libelle}</span>
                    {actif && (
                      <>
                        <input type="number" value={actif.heures} onChange={(e) => setFraisActifs((prev) => prev.map((x) => x.id === f.id ? { ...x, heures: +e.target.value } : x))} className="w-20 px-2 py-1 border rounded text-right" step={0.5} />
                        <span className="text-slate-500">h</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* SOMMAIRE */}
        <aside className="lg:sticky lg:top-24 lg:self-start space-y-4">
          <section className="bg-white rounded-lg shadow p-5">
            <h2 className="text-lg font-semibold mb-3">Sommaire</h2>
            <div className="space-y-2 text-sm">
              <Row label="Coût matériaux" value={formatCAD(calcul.totalCoutMateriaux)} />
              <Row label="Vente matériaux" value={formatCAD(calcul.totalVenteMateriaux)} />
              <Row label={`MO install (${calcul.totalHeuresInstallation.toFixed(1)}h)`} value={formatCAD(calcul.totalHeuresInstallation * TAUX_HORAIRE_VENTE)} />
              <Row label={`MO forfait (${calcul.totalHeuresForfaitaires.toFixed(1)}h)`} value={formatCAD(calcul.totalHeuresForfaitaires * TAUX_HORAIRE_VENTE)} />
              <Row label="Total MO" value={formatCAD(calcul.totalCoutMO)} bold />
              <hr />
              <div className="flex items-center justify-between">
                <label className="text-slate-700">Gestion %</label>
                <input type="number" value={fraisGestion * 100} onChange={(e) => setFraisGestion(+e.target.value / 100)} className="w-20 px-2 py-1 border rounded text-right" step={1} />
              </div>
              <Row label="Frais gestion" value={formatCAD(calcul.fraisGestionMontant)} />
              <hr />
              <Row label="Avant taxes" value={formatCAD(calcul.sousTotalAvantTaxes)} bold />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={appliquerTaxes} onChange={(e) => setAppliquerTaxes(e.target.checked)} /> TPS + TVQ
              </label>
              {appliquerTaxes && (<><Row label="TPS (5%)" value={formatCAD(calcul.tps)} /><Row label="TVQ (9.975%)" value={formatCAD(calcul.tvq)} /></>)}
              <hr />
              <div className="flex justify-between text-xl font-bold pt-1">
                <span>Total</span><span className="text-emerald-700">{formatCAD(calcul.total)}</span>
              </div>
            </div>
          </section>
        </aside>
      </main>

      {/* Notes vocales flottantes */}
      <NotesVocales
        contexteSoumission={{
          client,
          nbLignes: lignes.length,
          total: calcul.total,
          heuresInstall: calcul.totalHeuresInstallation,
          fraisGestion,
          categoriesPresentes: Array.from(new Set(lignes.map((l) => MATERIAUX.find((m) => m.code === l.materiauCode)?.categorie).filter(Boolean))),
        }}
        onAjustements={appliquerAjustementsVocaux}
      />
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div><label className="block text-xs font-medium text-slate-600 mb-1">{label}</label><input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border rounded text-sm" /></div>;
}
function TxtInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <div className="flex flex-col"><label className="text-slate-600 mb-1">{label}</label><input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="ex: Blanc Pur" className="px-2 py-1 border rounded text-xs" /></div>;
}
function NumInput({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return <div className="flex flex-col"><label className="text-slate-600 mb-1">{label}</label><input type="number" value={value} step={step} onChange={(e) => onChange(+e.target.value)} className="px-2 py-1 border rounded text-right" /></div>;
}
function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}><span className="text-slate-700">{label}</span><span>{value}</span></div>;
}

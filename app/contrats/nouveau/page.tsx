"use client";

// Préparation d'un contrat à envoyer au client pour signature.
//
// Remplace l'ancien parcours : quatre `prompt()` du navigateur enchaînés depuis la fiche
// CRM (prix, date, dépôt, n° de devis). On ne pouvait ni revenir en arrière, ni vérifier
// ce qu'on avait tapé, ni joindre un devis, ni renseigner l'adresse des travaux quand
// elle diffère de celle du client — alors que le PDF du contrat a un champ pour chacun.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Navigation from "@/components/Navigation";
import ZoneDepot from "@/components/ZoneDepot";
import { useToast } from "@/components/Toasts";
import { envoyer, nombreSaisi } from "@/lib/envoi";
import { formatCAD } from "@/lib/calculateur";
import { aujourdhuiMontreal } from "@/lib/date";
import { LIMITE_FICHIER_OCTETS, LIMITE_FICHIER_TEXTE } from "@/lib/limites-fichiers";

const AUJOURDHUI = () => aujourdhuiMontreal();
// 4 Mo de fichier ≈ 5,5 Mo une fois encodé : au-delà, la plateforme refuse la requête.
const TAILLE_MAX_DEVIS = LIMITE_FICHIER_OCTETS;

interface Champs {
  client_id: number | null;
  client_nom: string; client_adresse: string; client_ville: string;
  client_code_postal: string; client_province: string;
  client_telephone: string; client_courriel: string;
  proprietaire: string; locataire: string;
  memeAdresse: boolean;
  adresse_travaux: string; ville_travaux: string; code_postal_travaux: string; province_travaux: string;
  charge_projet: string;
  date_debut_travaux: string;
  prix_total: string;
  depot_pct: string; paiement_milieu_pct: string; paiement_fin_pct: string;
  soumission_numero: string; soumission_date: string;
  notes_travaux: string;
}

const VIDE: Champs = {
  client_id: null,
  client_nom: "", client_adresse: "", client_ville: "", client_code_postal: "", client_province: "Québec, Canada",
  client_telephone: "", client_courriel: "",
  proprietaire: "", locataire: "",
  memeAdresse: true,
  adresse_travaux: "", ville_travaux: "", code_postal_travaux: "", province_travaux: "Québec, Canada",
  // Chargé de projet : remplacé par l'usager connecté dès que /api/auth/me répond ;
  // Gabriel (président) par défaut, pas Francis.
  charge_projet: "Gabriel",
  date_debut_travaux: "",
  prix_total: "",
  depot_pct: "33.3333", paiement_milieu_pct: "33.3333", paiement_fin_pct: "33.3334",
  soumission_numero: "", soumission_date: "",
  notes_travaux: "",
};

export default function Page() {
  // Borne Suspense : useSearchParams la réclame.
  return (
    <Suspense fallback={<main className="p-8 text-slate-500">Chargement…</main>}>
      <NouveauContrat />
    </Suspense>
  );
}

function NouveauContrat() {
  const router = useRouter();
  const sp = useSearchParams();
  const { toast } = useToast();

  const [f, setF] = useState<Champs>(VIDE);
  const [clients, setClients] = useState<any[]>([]);
  const [soumissions, setSoumissions] = useState<any[]>([]);
  const [devis, setDevis] = useState<{ nom: string; type: string; data: string; taille: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resultat, setResultat] = useState<{ token: string; numero: string } | null>(null);
  const [courrielEnvoi, setCourrielEnvoi] = useState("");
  const [envoye, setEnvoye] = useState(false);
  const [apercu, setApercu] = useState<string | null>(null);
  const fichierRef = useRef<HTMLInputElement>(null);
  // Verrou synchrone : un état laisse passer deux clics du même instant (voir lib/verrou.ts).
  // Ici l'enjeu est réel — deux contrats créés, deux numéros, deux liens de signature.
  const envoiContrat = useRef(false);
  const maj = (p: Partial<Champs>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    fetch("/api/clients").then((r) => (r.ok ? r.json() : [])).then((l) => Array.isArray(l) && setClients(l)).catch(() => {});
    fetch("/api/soumissions").then((r) => (r.ok ? r.json() : [])).then((l) => Array.isArray(l) && setSoumissions(l)).catch(() => {});
    // Chargé de projet = l'usager connecté (Gabriel ou Francis), tant que le champ n'a
    // pas été modifié à la main.
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => {
      const u = typeof d?.user === "string" ? d.user.trim() : "";
      if (u) setF((x) => (x.charge_projet === VIDE.charge_projet ? { ...x, charge_projet: u } : x));
    }).catch(() => {});
  }, []);

  // Pré-remplissage depuis la fiche CRM (?client_id=)
  const clientIdUrl = sp.get("client_id");
  useEffect(() => {
    if (!clientIdUrl || clients.length === 0) return;
    const c = clients.find((x) => String(x.id) === String(clientIdUrl));
    if (!c) return;
    setF((x) => ({
      ...x,
      client_id: c.id,
      client_nom: c.nom || "",
      client_adresse: c.adresse || "",
      client_telephone: c.telephone || "",
      client_courriel: c.courriel || "",
      proprietaire: c.nom || "",
      notes_travaux: x.notes_travaux || c.notes || "",
    }));
  }, [clientIdUrl, clients]);

  const choisirClient = (id: string) => {
    const c = clients.find((x) => String(x.id) === id);
    if (!c) { maj({ client_id: null }); return; }
    maj({
      client_id: c.id, client_nom: c.nom || "", client_adresse: c.adresse || "",
      client_telephone: c.telephone || "", client_courriel: c.courriel || "",
      proprietaire: c.nom || "",
    });
  };

  const prix = nombreSaisi(f.prix_total);
  const prixValide = Number.isFinite(prix) && prix > 0;
  const sommePct = (nombreSaisi(f.depot_pct) || 0) + (nombreSaisi(f.paiement_milieu_pct) || 0) + (nombreSaisi(f.paiement_fin_pct) || 0);

  const manques = useMemo(() => {
    const m: string[] = [];
    if (!f.client_nom.trim()) m.push("le nom du client");
    if (!f.client_id) m.push("le client du CRM (le contrat doit être rattaché à une fiche)");
    if (!prixValide) m.push("un prix total valide");
    if (!f.date_debut_travaux.trim()) m.push("la date de début des travaux");
    if (!f.memeAdresse && !f.adresse_travaux.trim()) m.push("l'adresse des travaux");
    return m;
  }, [f, prixValide]);

  const lireDevis = async (fichiers: File[]) => {
    const file = fichiers[0];
    if (!file) return;
    if (file.size > TAILLE_MAX_DEVIS) {
      toast(`Devis trop lourd (${(file.size / 1024 / 1024).toFixed(1)} Mo, max ${LIMITE_FICHIER_TEXTE}). Compresse le PDF.`, "error");
      return;
    }
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(file);
    }).catch(() => null as any);
    if (!data) { toast("Lecture du fichier impossible", "error"); return; }
    setDevis({ nom: file.name, type: file.type || "application/pdf", data, taille: file.size });
    toast(`Devis joint : ${file.name}`, "success");
  };

  /** Les données envoyées au générateur PDF et stockées comme contrat autoritaire. */
  const donneesContrat = () => ({
    charge_projet: f.charge_projet,
    client_nom: f.client_nom.trim(),
    client_adresse: f.client_adresse.trim(),
    client_ville: f.client_ville.trim(),
    client_code_postal: f.client_code_postal.trim(),
    client_province: f.client_province,
    client_telephone: f.client_telephone.trim(),
    client_courriel: f.client_courriel.trim(),
    proprietaire: f.proprietaire.trim() || f.client_nom.trim(),
    locataire: f.locataire.trim(),
    adresse_travaux: f.memeAdresse ? f.client_adresse.trim() : f.adresse_travaux.trim(),
    ville_travaux: f.memeAdresse ? f.client_ville.trim() : f.ville_travaux.trim(),
    code_postal_travaux: f.memeAdresse ? f.client_code_postal.trim() : f.code_postal_travaux.trim(),
    province_travaux: f.memeAdresse ? f.client_province : f.province_travaux,
    date_debut_travaux: f.date_debut_travaux.trim(),
    prix_total: prix,
    depot_pct: nombreSaisi(f.depot_pct) || 0,
    // PAS de `paiement_signature_pct` : le PDF ajoute une ligne « À l'envoi du contrat »
    // dès que ce champ est > 0. On y recopiait le dépôt, ce qui donnait un tableau à
    // QUATRE lignes totalisant 133 % du contrat. Le modèle en a exactement trois :
    // dépôt à la signature, après la 1re semaine, balance à la fin.
    paiement_signature_pct: 0,
    paiement_milieu_pct: nombreSaisi(f.paiement_milieu_pct) || 0,
    paiement_fin_pct: nombreSaisi(f.paiement_fin_pct) || 0,
    soumission_numero: f.soumission_numero.trim(),
    soumission_date: f.soumission_date.trim(),
    notes_travaux: f.notes_travaux.trim(),
    // Sert de nom au projet créé à la signature.
    nom_projet: f.client_nom.trim(),
    adresse_chantier: f.memeAdresse ? f.client_adresse.trim() : f.adresse_travaux.trim(),
  });

  const voirApercu = async () => {
    try {
      const { genererContratBlob } = await import("@/lib/pdf-contrat");
      const blob = await genererContratBlob({ ...donneesContrat(), numero: "APERÇU" });
      // On révoque l'URL précédente : sans ça chaque aperçu fuit un blob en mémoire.
      if (apercu) URL.revokeObjectURL(apercu);
      setApercu(URL.createObjectURL(blob));
    } catch (e: any) {
      toast(`Aperçu impossible : ${e?.message || e}`, "error");
    }
  };
  useEffect(() => () => { if (apercu) URL.revokeObjectURL(apercu); }, [apercu]);

  const creer = async () => {
    if (envoiContrat.current) return;
    if (manques.length) { toast(`Il manque ${manques.join(", ")}.`, "warning"); return; }
    envoiContrat.current = true;
    setBusy(true);
    try {
      const data = donneesContrat();
      const { genererContratBlob } = await import("@/lib/pdf-contrat");
      const blob = await genererContratBlob({ ...data, numero: "" });
      const pdf64 = await new Promise<string>((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(blob);
      });
      const r = await envoyer("/api/contrats-pipeline", {
        corps: {
          client_id: f.client_id, data_json: data, pdf_brouillon: pdf64,
          annexe_data: devis?.data || null, annexe_nom: devis?.nom || null,
        },
      });
      if (!r.ok) { toast(`Contrat NON créé : ${r.erreur}`, "error"); return; }
      setResultat({ token: r.data.token, numero: r.data.numero });
      setCourrielEnvoi(f.client_courriel.trim());
      toast(`Contrat ${r.data.numero} prêt à envoyer`, "success");
    } finally { envoiContrat.current = false; setBusy(false); }
  };

  const envoyerAuClient = async () => {
    if (busy || !resultat) return;
    setBusy(true);
    try {
      const r = await envoyer(`/api/contrats-pipeline/${resultat.token}/envoyer`, { corps: { to: courrielEnvoi.trim() } });
      // `ok:false` avec une raison (courriel non configuré, refus du fournisseur) n'est
      // pas une erreur réseau : on montre la vraie cause au lieu d'un échec générique.
      if (!r.ok) { toast(`Courriel NON envoyé : ${r.erreur}`, "error"); return; }
      if (r.data?.ok === false) {
        toast(r.data.raison === "email_non_configure"
          ? "Courriel non configuré sur le serveur — copie le lien et envoie-le toi-même."
          : `Courriel NON envoyé : ${r.data.error || r.data.raison}`, "error");
        return;
      }
      setEnvoye(true);
      toast(`Contrat envoyé à ${courrielEnvoi.trim()}`, "success");
    } finally { setBusy(false); }
  };

  // ===== Écran de confirmation : le contrat existe, voici le lien =====
  if (resultat) {
    const lien = `${typeof window !== "undefined" ? window.location.origin : ""}/contrat/${resultat.token}`;
    return (
      <>
        <Navigation titre="Nouveau contrat" soustitre="Préparer un contrat à faire signer" />
        <main className="max-w-2xl mx-auto p-4 space-y-4">
          <div className="bg-white rounded-lg shadow p-6 space-y-4 text-center">
            <div className="text-5xl">📄</div>
            <h1 className="text-xl font-bold text-slate-900">Contrat {resultat.numero} prêt</h1>
            <p className="text-sm text-slate-600">
              Rien n'a encore été envoyé, et <strong>aucun projet n'a été créé</strong> : le projet naîtra automatiquement
              quand le client aura signé.
            </p>
            <div className="bg-slate-50 border rounded-lg p-3 text-left">
              <div className="text-xs font-semibold text-slate-600 mb-1">Lien de signature</div>
              <div className="flex gap-2">
                <input readOnly value={lien} className="flex-1 px-2 py-2 border rounded text-xs font-mono bg-white" onFocus={(e) => e.currentTarget.select()} />
                <button
                  onClick={() => { navigator.clipboard?.writeText(lien); toast("Lien copié", "success"); }}
                  className="px-3 py-2 bg-slate-800 text-white rounded text-xs font-bold min-h-[44px]"
                >Copier</button>
              </div>
            </div>
            {/* Envoi depuis ici : sans ce bouton, il fallait ressortir, retrouver le
                client dans le CRM et rouvrir sa fiche juste pour expédier le lien. */}
            <label className="block text-left">
              <span className="block text-xs font-medium text-slate-600 mb-1">Envoyer le lien de signature à</span>
              <input type="email" value={courrielEnvoi} onChange={(e) => setCourrielEnvoi(e.target.value)}
                placeholder="client@exemple.com" className="w-full px-3 py-2 border rounded text-sm min-h-[44px]" />
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <a href={`/contrat/${resultat.token}`} target="_blank" rel="noreferrer" className="flex-1 px-4 py-3 bg-slate-100 hover:bg-slate-200 rounded-lg font-bold text-sm min-h-[48px] flex items-center justify-center">👁 Voir la page du client</a>
              <button
                onClick={envoyerAuClient}
                disabled={busy || !courrielEnvoi.trim() || envoye}
                className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg font-bold text-sm min-h-[48px]"
              >
                {envoye ? "✓ Envoyé" : busy ? "⏳ Envoi…" : "📧 Envoyer au client"}
              </button>
            </div>
            <button onClick={() => router.push("/clients")} className="text-xs text-slate-500 hover:underline">Retour au CRM</button>
            {devis && <p className="text-xs text-emerald-700">📎 Devis joint : {devis.nom}</p>}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Navigation titre="Nouveau contrat" soustitre="Préparer un contrat à faire signer" />
      <main className="max-w-3xl mx-auto p-4 space-y-4 pb-24">
        <header>
          <h1 className="text-xl font-bold text-slate-900">Nouveau contrat</h1>
          <p className="text-xs text-slate-500">Le projet sera créé automatiquement à la signature du client — pas avant.</p>
        </header>

        <Section titre="1. Client">
          <label className="block">
            <Lbl>Fiche client (CRM) *</Lbl>
            <select value={f.client_id ?? ""} onChange={(e) => choisirClient(e.target.value)} className="w-full px-3 py-2 border rounded text-sm bg-white min-h-[44px]">
              <option value="">— Choisir un client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </label>
          <Grille>
            <Champ label="Nom du client *" v={f.client_nom} o={(v) => maj({ client_nom: v })} />
            <Champ label="Propriétaire (si différent)" v={f.proprietaire} o={(v) => maj({ proprietaire: v })} placeholder="Par défaut : le client" />
            <Champ label="Téléphone" v={f.client_telephone} o={(v) => maj({ client_telephone: v })} placeholder="450-555-1234" />
            <Champ label="Courriel" v={f.client_courriel} o={(v) => maj({ client_courriel: v })} type="email" />
            <Champ label="Adresse" v={f.client_adresse} o={(v) => maj({ client_adresse: v })} />
            <Champ label="Ville" v={f.client_ville} o={(v) => maj({ client_ville: v })} />
            <Champ label="Code postal" v={f.client_code_postal} o={(v) => maj({ client_code_postal: v })} />
            <Champ label="Locataire (si applicable)" v={f.locataire} o={(v) => maj({ locataire: v })} />
          </Grille>
        </Section>

        <Section titre="2. Chantier">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.memeAdresse} onChange={(e) => maj({ memeAdresse: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
            <span>Les travaux ont lieu à l'adresse du client</span>
          </label>
          {!f.memeAdresse && (
            <Grille>
              <Champ label="Adresse des travaux *" v={f.adresse_travaux} o={(v) => maj({ adresse_travaux: v })} />
              <Champ label="Ville" v={f.ville_travaux} o={(v) => maj({ ville_travaux: v })} />
              <Champ label="Code postal" v={f.code_postal_travaux} o={(v) => maj({ code_postal_travaux: v })} />
            </Grille>
          )}
          <Grille>
            <Champ label="Chargé de projet" v={f.charge_projet} o={(v) => maj({ charge_projet: v })} />
            <Champ label="Début des travaux *" v={f.date_debut_travaux} o={(v) => maj({ date_debut_travaux: v })} placeholder="15 juin 2026" />
          </Grille>
          <label className="block">
            <Lbl>Description des travaux</Lbl>
            <textarea value={f.notes_travaux} onChange={(e) => maj({ notes_travaux: e.target.value })} rows={4}
              placeholder="Ex. : pose de revêtement Maibec Canexel sur les 4 façades, remplacement des soffites et fascias…"
              className="w-full px-3 py-2 border rounded text-sm" />
          </label>
        </Section>

        <Section titre="3. Montant et paiement">
          <Grille>
            <Champ label="Prix total du contrat * (taxes incl.)" v={f.prix_total} o={(v) => maj({ prix_total: v })} placeholder="51 738,75" />
            <div className="flex items-end">
              <div className="text-sm text-slate-600">
                {prixValide ? <>= <strong className="text-slate-900">{formatCAD(prix)}</strong></> : <span className="text-slate-400">Montant à saisir</span>}
              </div>
            </div>
          </Grille>
          <Grille>
            <Champ label="Dépôt à la signature (%)" v={f.depot_pct} o={(v) => maj({ depot_pct: v })} />
            <Champ label="Versement mi-parcours (%)" v={f.paiement_milieu_pct} o={(v) => maj({ paiement_milieu_pct: v })} />
            <Champ label="Solde à la fin (%)" v={f.paiement_fin_pct} o={(v) => maj({ paiement_fin_pct: v })} />
          </Grille>
          {/* Un échéancier qui ne fait pas 100 % est une erreur de saisie coûteuse :
              soit on facture moins que le contrat, soit plus. */}
          {Math.abs(sommePct - 100) > 0.01 && (
            <p className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              ⚠ Les versements totalisent {sommePct} % au lieu de 100 %.
            </p>
          )}
          {prixValide && Math.abs(sommePct - 100) <= 0.01 && (
            <p className="text-xs text-slate-600">
              Dépôt {formatCAD(prix * (nombreSaisi(f.depot_pct) || 0) / 100)} ·
              mi-parcours {formatCAD(prix * (nombreSaisi(f.paiement_milieu_pct) || 0) / 100)} ·
              solde {formatCAD(prix * (nombreSaisi(f.paiement_fin_pct) || 0) / 100)}
            </p>
          )}
          <Grille>
            <label className="block">
              <Lbl>Soumission liée</Lbl>
              <select value={f.soumission_numero} onChange={(e) => maj({ soumission_numero: e.target.value, soumission_date: e.target.value ? AUJOURDHUI() : "" })} className="w-full px-3 py-2 border rounded text-sm bg-white min-h-[44px]">
                <option value="">— Aucune —</option>
                {soumissions.map((s) => <option key={s.numero} value={s.numero}>{s.numero} — {s.client_nom} ({formatCAD(s.total || 0)})</option>)}
              </select>
            </label>
            <Champ label="Date de la soumission" v={f.soumission_date} o={(v) => maj({ soumission_date: v })} placeholder="AAAA-MM-JJ" />
          </Grille>
        </Section>

        <Section titre="4. Devis joint (facultatif)">
          <p className="text-xs text-slate-600">
            Le client pourra l'ouvrir depuis la page de signature, et il le recevra avec son contrat signé.
          </p>
          <ZoneDepot onFichiers={lireDevis} accept=".pdf,image/*" multiple={false} messageSurvol="📎 Dépose le devis ici">
            <button
              type="button"
              onClick={() => fichierRef.current?.click()}
              className="w-full border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-lg p-6 text-sm text-slate-600 min-h-[88px]"
            >
              {devis ? (
                <span className="text-emerald-700 font-semibold">📎 {devis.nom} · {(devis.taille / 1024).toFixed(0)} Ko — cliquer pour remplacer</span>
              ) : (
                <>📎 Glisse un PDF ici, ou clique pour choisir un fichier<br /><span className="text-xs text-slate-400">PDF ou image, 4 Mo maximum</span></>
              )}
            </button>
          </ZoneDepot>
          <input ref={fichierRef} type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { lireDevis(Array.from(e.target.files || [])); e.target.value = ""; }} />
          {devis && (
            <button onClick={() => setDevis(null)} className="text-xs text-red-700 hover:underline">Retirer le devis</button>
          )}
        </Section>

        {apercu && (
          <Section titre="Aperçu du contrat">
            <iframe src={apercu} title="Aperçu du contrat" className="w-full border rounded" style={{ height: "70vh", minHeight: 400 }} />
          </Section>
        )}

        {manques.length > 0 && (
          <p className="text-xs text-slate-600 bg-slate-100 border rounded p-3">
            Avant de créer le contrat, il manque : <strong>{manques.join(", ")}</strong>.
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2 sticky bottom-0 bg-slate-50 py-3 border-t">
          <button onClick={voirApercu} className="flex-1 px-4 py-3 bg-white border-2 border-slate-300 hover:border-slate-400 rounded-lg font-bold text-sm min-h-[48px]">
            👁 Aperçu du PDF
          </button>
          <button
            onClick={creer}
            disabled={busy || manques.length > 0}
            className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-bold text-sm min-h-[48px]"
          >
            {busy ? "⏳ Création…" : "📄 Créer le contrat"}
          </button>
        </div>
      </main>
    </>
  );
}

// ===== Petits blocs de présentation =====
function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg shadow p-4 space-y-3">
      <h2 className="font-bold text-sm text-slate-900">{titre}</h2>
      {children}
    </section>
  );
}
function Grille({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>;
}
function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="block text-xs font-medium text-slate-600 mb-1">{children}</span>;
}
function Champ({ label, v, o, placeholder, type = "text" }: { label: string; v: string; o: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <Lbl>{label}</Lbl>
      <input type={type} value={v} onChange={(e) => o(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 border rounded text-sm min-h-[44px]" />
    </label>
  );
}

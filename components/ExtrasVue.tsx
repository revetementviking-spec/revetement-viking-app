"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/Toasts";
import { formatCAD } from "@/lib/calculateur";
import ModalExtra from "@/components/ModalExtra";
import { envoyer, lireListe, nombreSaisi } from "@/lib/envoi";
import { useVerrou } from "@/lib/verrou";
import ErreurChargement from "@/components/ErreurChargement";

const ICONE: Record<string, string> = { montant: "💰", heures: "⏱️", materiaux: "📦" };

/** Liste + gestion des extras à facturer. Réutilisé par la page /extras, l'onglet Extras
 *  des Finances, et l'onglet Extras d'une fiche projet.
 *
 *  `projetId` limite la vue à un seul chantier et pré-remplit le projet à la création :
 *  le même écran, avec les mêmes gestes (modifier, marquer facturé, supprimer), plutôt
 *  qu'une deuxième liste à maintenir en parallèle. */
export default function ExtrasVue({ projetId, onChange }: { projetId?: number; onChange?: () => void } = {}) {
  const [onglet, setOnglet] = useState<"a_charger" | "charge">("a_charger");
  const [extras, setExtras] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [edition, setEdition] = useState<{ id: number; description: string; montant: string; heures: string; nature: string } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  // Verrou par ref (lib/verrou.ts) : `if (busy) return` sur un état laissait passer
  // deux clics du même instant sur « Enregistrer ».
  const verrou = useVerrou();
  const { toast } = useToast();

  const charger = async () => {
    setLoading(true);
    try {
      const q = `statut=${onglet}${projetId ? `&projet_id=${projetId}` : ""}`;
      // Lecture avec filet : un échec ressemblait à « aucun extra en attente 🎉 ».
      const r = await lireListe(`/api/extras?${q}`);
      if (!r.ok) { setErreur(r.erreur); return; }
      setErreur(null);
      setExtras(r.data);
    } finally { setLoading(false); }
  };
  useEffect(() => { charger(); }, [onglet, projetId]);

  // Un extra change le revenu du projet (les extras facturés entrent dans le revenu
  // reconnu) : la fiche doit se recalculer, pas seulement cette liste.
  const rafraichir = () => { charger(); onChange?.(); };

  // On ne retire la ligne de l'écran QUE si le serveur a confirmé : avant, une session
  // expirée faisait disparaître l'extra à l'écran alors qu'il restait « à charger » en
  // base — il « revenait » au rechargement suivant.
  const basculer = async (e: any, charge: boolean) => {
    const r = await envoyer("/api/extras", { methode: "PATCH", corps: { id: e.id, statut: charge ? "charge" : "a_charger" } });
    if (!r.ok) { toast(`Échec : ${r.erreur}`, "error"); return; }
    toast(charge ? "✓ Marqué facturé" : "Remis à facturer", "success");
    setExtras((arr) => arr.filter((x) => x.id !== e.id));
    onChange?.();
  };
  const supprimer = async (e: any) => {
    if (!confirm("Supprimer cet extra ?")) return;
    const r = await envoyer(`/api/extras?id=${e.id}`, { methode: "DELETE" });
    if (!r.ok) { toast(`Échec de la suppression : ${r.erreur}`, "error"); return; }
    toast("Extra supprimé", "info");
    setExtras((arr) => arr.filter((x) => x.id !== e.id));
    onChange?.();
  };

  // === Modification en place (texte, montant, heures) ===
  const ouvrirEdition = (e: any) => setEdition({
    id: e.id,
    description: e.description || "",
    montant: e.montant != null ? String(e.montant) : "",
    heures: e.heures != null ? String(e.heures) : "",
    nature: e.nature || "montant",
  });

  const enregistrer = () => verrou.executer(async () => {
    if (!edition) return;
    if (!edition.description.trim()) { toast("La description ne peut pas être vide", "warning"); return; }
    // Un montant ou des heures illisibles sont refusés ici, avec un message, au lieu de
    // partir tels quels au serveur.
    const montantTexte = edition.nature === "heures" ? "" : edition.montant.trim();
    const heuresTexte = edition.nature === "heures" ? edition.heures.trim() : "";
    if (montantTexte && !Number.isFinite(nombreSaisi(montantTexte))) { toast("Montant illisible (ex. : 1 250,75)", "warning"); return; }
    if (heuresTexte && !Number.isFinite(nombreSaisi(heuresTexte))) { toast("Heures illisibles (ex. : 6,5)", "warning"); return; }
    // On n'envoie que les champs pertinents à la nature choisie : un extra « heures » ne
    // doit pas traîner un montant, et inversement.
    const corps: any = { id: edition.id, description: edition.description.trim(), nature: edition.nature };
    corps.montant = montantTexte ? nombreSaisi(montantTexte) : null;
    corps.heures = heuresTexte ? nombreSaisi(heuresTexte) : null;
    const r = await envoyer("/api/extras", { methode: "PATCH", corps });
    if (!r.ok) { toast(`Modification refusée : ${r.erreur}`, "error"); return; }
    toast("Extra modifié", "success");
    setEdition(null);
    rafraichir();
  });
  const busy = verrou.occupe;

  const total = extras.reduce((s, e) => s + (e.montant || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2 border-b">
          <button onClick={() => setOnglet("a_charger")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${onglet === "a_charger" ? "border-amber-600 text-amber-700" : "border-transparent text-slate-500"}`}>À facturer</button>
          <button onClick={() => setOnglet("charge")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition ${onglet === "charge" ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`}>Facturés</button>
        </div>
        <button onClick={() => setModal(true)} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-bold">＋ Extra</button>
      </div>

      {onglet === "a_charger" && extras.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm font-bold text-amber-900">
          {extras.length} extra(s) à facturer{total > 0 ? ` · ${formatCAD(total)}` : ""}
        </div>
      )}

      {erreur ? (
        <ErreurChargement erreur={erreur} onReessayer={charger} />
      ) : loading ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-slate-500">Chargement…</div>
      ) : extras.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center text-slate-500">
          {onglet === "a_charger" ? "Aucun extra en attente de facturation 🎉" : "Aucun extra facturé pour l'instant."}
        </div>
      ) : (
        <div className="space-y-2">
          {extras.map((e) => {
          // `ed` (const local) plutôt que `edition` directement : TypeScript ne peut pas
          // garantir qu'un état lu dans une fermeture reste non-null au moment du rendu.
          const ed = edition && edition.id === e.id ? edition : null;
          return ed ? (
            /* Modification EN PLACE : la ligne se transforme en formulaire. Pas de fenêtre
               par-dessus — on veut garder sous les yeux le projet et la date de l'extra. */
            <div key={e.id} className="bg-white rounded-lg shadow p-4 space-y-3 border-2 border-amber-400">
              <div className="text-xs text-slate-500">{e.projet_nom || "Sans projet"} · {e.date}</div>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Description</span>
                <textarea
                  value={ed.description}
                  onChange={(ev) => setEdition({ ...ed, description: ev.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 border rounded text-sm"
                />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-600 mb-1">Nature</span>
                  <select
                    value={ed.nature}
                    onChange={(ev) => setEdition({ ...ed, nature: ev.target.value })}
                    className="w-full px-3 py-2 border rounded text-sm bg-white min-h-[44px]"
                  >
                    <option value="montant">💰 Montant</option>
                    <option value="heures">⏱️ Heures</option>
                    <option value="materiaux">📦 Matériaux</option>
                  </select>
                </label>
                {ed.nature === "heures" ? (
                  <label className="block">
                    <span className="block text-xs font-medium text-slate-600 mb-1">Heures</span>
                    <input
                      value={ed.heures}
                      onChange={(ev) => setEdition({ ...ed, heures: ev.target.value })}
                      type="text" inputMode="decimal" placeholder="Ex. : 6,5"
                      className="w-full px-3 py-2 border rounded text-sm text-right font-bold min-h-[44px]"
                    />
                  </label>
                ) : (
                  <label className="block">
                    {/* Les extras sont facturés taxes incluses, comme le contrat : on le dit. */}
                    <span className="block text-xs font-medium text-slate-600 mb-1">Montant (taxes incluses) — laisser vide si à déterminer</span>
                    <input
                      value={ed.montant}
                      onChange={(ev) => setEdition({ ...ed, montant: ev.target.value })}
                      type="text" inputMode="decimal" placeholder="Ex. : 1 250,75"
                      className="w-full px-3 py-2 border rounded text-sm text-right font-bold min-h-[44px]"
                    />
                  </label>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={enregistrer} disabled={busy} className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-bold min-h-[44px]">
                  {busy ? "⏳ Enregistrement…" : "✓ Enregistrer"}
                </button>
                <button onClick={() => setEdition(null)} className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-semibold min-h-[44px]">Annuler</button>
              </div>
            </div>
          ) : (
            <div key={e.id} className="bg-white rounded-lg shadow p-4 flex gap-3">
              {e.a_photo && (
                <a href={`/api/extras/${e.id}/photo`} target="_blank" rel="noreferrer" className="flex-shrink-0 min-w-11 min-h-11" aria-label="Ouvrir la photo justificative">
                  {/* La route /api/extras/[id]/photo sert déjà la vignette (thumb_data) quand elle existe. */}
                  <img src={`/api/extras/${e.id}/photo`} alt="Photo justificative" loading="lazy" className="w-16 h-16 object-cover rounded border" />
                </a>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-900">{ICONE[e.nature] || "💲"} {e.description}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {e.projet_nom || "Sans projet"} · {e.date}{e.saisi_par ? ` · saisi par ${e.saisi_par}` : ""}
                </div>
                <div className="text-sm font-bold text-amber-700 mt-1">
                  {e.montant ? formatCAD(e.montant) : e.heures ? `${e.heures} h` : e.nature === "materiaux" ? "Matériaux — montant à déterminer" : "Montant à déterminer"}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 flex-shrink-0">
                {onglet === "a_charger" ? (
                  <>
                    <button onClick={() => basculer(e, true)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold whitespace-nowrap">✓ Facturé</button>
                    <button onClick={() => ouvrirEdition(e)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-xs font-bold whitespace-nowrap">✏️ Modifier</button>
                  </>
                ) : (
                  /* Pas de bouton Modifier sur un extra FACTURÉ : son montant a servi à
                     facturer le client. Le serveur refuse d'ailleurs la modification —
                     il faut le rouvrir, corriger, puis le remarquer facturé. */
                  <button onClick={() => basculer(e, false)} className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded text-xs font-bold whitespace-nowrap">↩ Rouvrir</button>
                )}
                <button onClick={() => supprimer(e)} className="px-3 py-1.5 text-red-600 hover:bg-red-50 rounded text-xs font-semibold">🗑 Suppr.</button>
              </div>
            </div>
          );
          })}
        </div>
      )}

      <ModalExtra ouvert={modal} onClose={() => setModal(false)} onSuccess={rafraichir} projetIdInitial={projetId} />
    </div>
  );
}

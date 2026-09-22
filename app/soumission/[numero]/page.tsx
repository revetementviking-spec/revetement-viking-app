"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { envoyer } from "@/lib/envoi";

const cad = (n: number) => new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(n || 0);
const TPS = 0.05, TVQ = 0.09975;

export default function SoumissionPublique() {
  const params = useParams();
  const search = useSearchParams();
  const numero = decodeURIComponent(String(params.numero || ""));
  const token = search.get("t") || "";

  const [data, setData] = useState<any>(null);
  const [erreur, setErreur] = useState("");
  const [nom, setNom] = useState("");
  const [traitement, setTraitement] = useState(false);
  const [fait, setFait] = useState<"" | "accepte" | "refuse">("");

  useEffect(() => {
    if (!numero || !token) { setErreur("Lien invalide ou incomplet."); return; }
    fetch(`/api/soumission-publique?numero=${encodeURIComponent(numero)}&token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) setErreur(d.error); else setData(d); })
      .catch(() => setErreur("Erreur de chargement."));
  }, [numero, token]);

  const agir = async (action: "accepter" | "refuser") => {
    if (action === "accepter" && !nom.trim()) { setErreur("Entre ton nom pour signer."); return; }
    setTraitement(true); setErreur("");
    try {
      // Page PUBLIQUE (client) : statut HTTP vérifié, jamais d'exception muette sur un 403/500.
      const res = await envoyer("/api/soumission-publique", { corps: { numero, token, action, nom: nom.trim() } });
      if (res.ok) setFait(action === "accepter" ? "accepte" : "refuse");
      else setErreur(res.erreur || "Erreur");
    } catch { setErreur("Erreur réseau."); }
    finally { setTraitement(false); }
  };

  if (erreur && !data) return (
    <Centre><div className="text-center"><div className="text-5xl mb-3">🔒</div><p className="text-slate-700 font-semibold">{erreur}</p></div></Centre>
  );
  if (!data) return <Centre><p className="text-slate-500">Chargement…</p></Centre>;

  const dejaTraitee = data.statut === "acceptee" || data.statut === "facturee" || data.statut === "refusee" || fait;
  // `data.total` est le total TAXES INCLUSES (calculerSoumission fait déjà
  // sousTotalAvantTaxes + TPS + TVQ). Il faut donc DÉCOMPOSER ce montant, pas y rajouter
  // les taxes une 2e fois — sinon le client signait un montant gonflé de 14,975 %
  // (11 497,50 $ affichés 13 219,25 $).
  const totalTTC = data.total || 0;
  const sousTotal = data.appliquerTaxes ? totalTTC / (1 + TPS + TVQ) : totalTTC;
  const tps = data.appliquerTaxes ? sousTotal * TPS : 0;
  const tvq = data.appliquerTaxes ? sousTotal * TVQ : 0;

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center gap-3">
          <span className="text-3xl">⛵</span>
          <div>
            <h1 className="text-xl font-bold">Revêtement Viking Inc.</h1>
            <p className="text-xs text-slate-300">RBQ 5811-4299-01 · Soumission {data.numero}</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Infos */}
          <div>
            <h2 className="font-bold text-lg text-slate-900">{data.projet || "Projet de revêtement extérieur"}</h2>
            <p className="text-sm text-slate-600">Pour : {data.client_nom}</p>
            {data.client_adresse && <p className="text-sm text-slate-600">{data.client_adresse}</p>}
            <p className="text-xs text-slate-400 mt-1">Émise le {new Date(data.date_creation).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" })}</p>
          </div>

          {/* Lignes */}
          {data.lignes?.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-100 text-left text-xs uppercase text-slate-600">
                  <tr><th className="p-2">Description</th><th className="p-2 text-right">Montant</th></tr>
                </thead>
                <tbody>
                  {data.lignes.map((l: any, i: number) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{l.description || l.nom || l.code || "Item"}</td>
                      <td className="p-2 text-right">{l.montant != null ? cad(l.montant) : l.total != null ? cad(l.total) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Total */}
          <div className="bg-slate-50 rounded-lg p-4 space-y-1">
            {data.appliquerTaxes && (
              <>
                <Ligne label="Sous-total" val={cad(sousTotal)} />
                <Ligne label="TPS (5 %)" val={cad(tps)} />
                <Ligne label="TVQ (9,975 %)" val={cad(tvq)} />
              </>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-slate-300">
              <span className="font-bold text-lg">Total{data.appliquerTaxes ? " avec taxes" : ""}</span>
              <span className="font-bold text-xl text-emerald-700">{cad(totalTTC)}</span>
            </div>
          </div>

          {/* Zone signature / résultat */}
          {fait === "accepte" || (dejaTraitee && data.statut === "acceptee") ? (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-5 text-center">
              <div className="text-4xl mb-2">✅</div>
              <p className="font-bold text-emerald-900">Soumission acceptée — merci !</p>
              {(data.signature_nom || nom) && <p className="text-sm text-emerald-800 mt-1">Signée par {data.signature_nom || nom}</p>}
              <p className="text-xs text-emerald-700 mt-2">Revêtement Viking vous contactera sous peu pour la suite.</p>
            </div>
          ) : fait === "refuse" || data.statut === "refusee" ? (
            <div className="bg-slate-50 border-2 border-slate-300 rounded-lg p-5 text-center">
              <div className="text-4xl mb-2">📋</div>
              <p className="font-semibold text-slate-700">Soumission refusée.</p>
              <p className="text-xs text-slate-500 mt-1">Vous pouvez contacter Revêtement Viking si vous changez d'avis.</p>
            </div>
          ) : (
            <div className="border-2 border-emerald-300 rounded-lg p-4 bg-emerald-50/40">
              <p className="text-sm font-semibold text-slate-800 mb-2">Pour accepter cette soumission, entrez votre nom complet :</p>
              <input
                type="text"
                value={nom}
                onChange={(e) => setNom(e.target.value)}
                placeholder="Votre nom complet"
                autoComplete="name"
                className="w-full px-3 py-3 border-2 border-slate-300 focus:border-emerald-500 rounded-lg text-base mb-2"
              />
              <p className="text-[11px] text-slate-500 mb-3">En cliquant « J'accepte », vous confirmez votre accord avec les termes de cette soumission. Votre nom, la date et l'heure seront enregistrés comme signature électronique.</p>
              {erreur && <p className="text-sm text-red-600 mb-2">{erreur}</p>}
              <div className="flex flex-col sm:flex-row gap-2">
                <button onClick={() => agir("accepter")} disabled={traitement} className="flex-1 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold disabled:opacity-50">
                  {traitement ? "…" : "✍️ J'accepte cette soumission"}
                </button>
                <button onClick={() => agir("refuser")} disabled={traitement} className="px-4 py-3 bg-white hover:bg-slate-100 border border-slate-300 text-slate-600 rounded-lg font-semibold disabled:opacity-50">
                  Refuser
                </button>
              </div>
            </div>
          )}

          <p className="text-center text-[10px] text-slate-400 pt-2">Revêtement Viking Inc. · RBQ 5811-4299-01 · revetementviking@gmail.com</p>
        </div>
      </div>
    </div>
  );
}

function Centre({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">{children}</div>;
}
function Ligne({ label, val }: { label: string; val: string }) {
  return <div className="flex justify-between text-sm text-slate-600"><span>{label}</span><span>{val}</span></div>;
}

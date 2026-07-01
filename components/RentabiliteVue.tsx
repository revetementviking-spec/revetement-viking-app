"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCAD } from "@/lib/calculateur";
import { exporterCSV } from "@/lib/csv";
import { useToast } from "@/components/Toasts";

// Tableur de rentabilité : décompose EXACTEMENT le calcul de la marge du tableau de bord.
// revenu = (prix_contrat | budget) + extras facturés  →  ÷ 1,14975 = avant taxes
// coût = dépenses + main-d'œuvre  →  marge = revenu_avant_taxes − coût
const FACTEUR_TAXES = 1.14975;

type Filtre = "actif" | "tous" | "complete";

export default function RentabiliteVue() {
  const [projets, setProjets] = useState<any[]>([]);
  const [filtre, setFiltre] = useState<Filtre>("actif"); // défaut = actifs (comme le tableau de bord)
  const [chargement, setChargement] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    fetch("/api/projets").then((r) => r.json()).then((d) => { setProjets(Array.isArray(d) ? d : []); setChargement(false); }).catch(() => setChargement(false));
  }, []);

  const lignes = useMemo(() => {
    const arr = projets.filter((p) => filtre === "tous" ? p.statut !== "annule" : p.statut === filtre);
    return arr.map((p) => {
      const prix = (+p.prix_contrat || +p.budget_estime || 0);
      const extras = +p.extras_factures || 0;
      const revenu = prix + extras;                        // taxes incluses
      const revenuAT = +p.revenu_avant_taxes || (revenu / FACTEUR_TAXES);
      const dep = +p.total_depenses || 0;
      const mo = +p.cout_main_oeuvre || 0;
      const cout = +p.cout_total || (dep + mo);
      const marge = +p.marge || (revenuAT - cout);
      const margePct = revenuAT > 0 ? (marge / revenuAT) * 100 : 0;
      return { p, prix, extras, revenu, revenuAT, dep, mo, cout, marge, margePct };
    });
  }, [projets, filtre]);

  const tot = useMemo(() => lignes.reduce((s, l) => ({
    prix: s.prix + l.prix, extras: s.extras + l.extras, revenu: s.revenu + l.revenu,
    revenuAT: s.revenuAT + l.revenuAT, dep: s.dep + l.dep, mo: s.mo + l.mo, cout: s.cout + l.cout, marge: s.marge + l.marge,
  }), { prix: 0, extras: 0, revenu: 0, revenuAT: 0, dep: 0, mo: 0, cout: 0, marge: 0 }), [lignes]);

  // Marge moyenne pondérée = total marge / total revenu avant taxes (identique au tableau de bord).
  const margeMoyPct = tot.revenuAT > 0 ? (tot.marge / tot.revenuAT) * 100 : 0;

  const exportCSV = () => {
    const rows = lignes.map((l) => ({
      projet: l.p.nom, client: l.p.client_nom || "", statut: l.p.statut,
      prix_contrat: l.prix.toFixed(2), extras_factures: l.extras.toFixed(2), revenu_taxes_incl: l.revenu.toFixed(2),
      revenu_avant_taxes: l.revenuAT.toFixed(2), depenses: l.dep.toFixed(2), main_oeuvre: l.mo.toFixed(2),
      cout_total: l.cout.toFixed(2), marge: l.marge.toFixed(2), marge_pct: l.margePct.toFixed(1),
    }));
    exporterCSV(`rentabilite-${filtre}-${new Date().toISOString().slice(0, 10)}`, rows);
    toast(`✓ ${rows.length} projet(s) exporté(s)`, "success");
  };

  const exportPDF = async () => {
    try {
      const { genererRapportRentabiliteBlob } = await import("@/lib/pdf-rapport");
      const blob = await genererRapportRentabiliteBlob({ projets, filtre, date: new Date().toLocaleDateString("fr-CA") });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `Rapport-rentabilite-${filtre}-${new Date().toISOString().slice(0, 10)}.pdf`; a.click();
      URL.revokeObjectURL(url);
      toast("✓ Rapport PDF généré", "success");
    } catch (e: any) { toast("Erreur PDF : " + (e?.message || ""), "error"); }
  };

  const Num = ({ v, c }: { v: number; c?: string }) => <span className={`tabular-nums ${c || ""}`}>{formatCAD(v)}</span>;

  return (
    <div className="space-y-4">
      {/* Bandeau : le chiffre du tableau de bord */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-lg p-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-[10px] uppercase font-bold text-blue-700">📊 Marge moyenne {filtre === "actif" ? "(projets actifs)" : filtre === "complete" ? "(projets complétés)" : "(tous les projets)"}</div>
            <div className="text-3xl font-bold text-blue-900 mt-0.5">{margeMoyPct.toFixed(1)} %</div>
            <div className="text-xs text-blue-700">{formatCAD(tot.marge)} de marge sur {formatCAD(tot.revenuAT)} de revenu avant taxes</div>
          </div>
          <div className="text-[11px] text-slate-600 max-w-xs">
            C'est <strong>exactement</strong> le calcul de la carte « Marge moyenne » du tableau de bord{filtre === "actif" ? "" : " (le tableau de bord n'affiche que les projets actifs)"}.
          </div>
        </div>
      </div>

      {/* Formule */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 text-xs text-slate-700 space-y-1">
        <div className="font-bold text-slate-900">🧮 Formule (par projet)</div>
        <div><span className="font-mono bg-slate-100 px-1 rounded">Revenu</span> = Prix contrat (ou budget) <span className="text-emerald-700">+ Extras facturés</span></div>
        <div><span className="font-mono bg-slate-100 px-1 rounded">Revenu avant taxes</span> = Revenu ÷ 1,14975 <span className="text-slate-400">(on retire TPS 5 % + TVQ 9,975 %)</span></div>
        <div><span className="font-mono bg-slate-100 px-1 rounded">Coût total</span> = Dépenses + Main-d'œuvre</div>
        <div><span className="font-mono bg-slate-100 px-1 rounded font-bold">Marge</span> = Revenu avant taxes − Coût total</div>
      </div>

      {/* Filtres + export */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-white rounded-lg shadow-sm border p-1">
          {([["actif", "Actifs"], ["complete", "Complétés"], ["tous", "Tous"]] as [Filtre, string][]).map(([v, l]) => (
            <button key={v} onClick={() => setFiltre(v)} className={`px-3 py-1.5 rounded text-sm font-semibold ${filtre === v ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>{l}</button>
          ))}
        </div>
        <span className="text-xs text-slate-500">{lignes.length} projet(s)</span>
        <button onClick={exportPDF} className="ml-auto px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold">📄 Rapport PDF</button>
        <button onClick={exportCSV} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold">📥 Export Excel (CSV)</button>
      </div>

      {/* Tableur */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        {chargement ? (
          <div className="p-8 text-center text-slate-400 text-sm">Chargement…</div>
        ) : lignes.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">Aucun projet {filtre === "actif" ? "actif" : filtre === "complete" ? "complété" : ""}.</div>
        ) : (
          <table className="w-full text-sm min-w-max border-collapse">
            <thead className="bg-slate-100 text-xs">
              <tr className="[&>th]:p-2 [&>th]:border [&>th]:border-slate-200 text-right">
                <th className="text-left sticky left-0 bg-slate-100 z-10">Projet</th>
                <th className="text-right">Prix contrat</th>
                <th className="text-right text-emerald-700">+ Extras</th>
                <th className="text-right">= Revenu</th>
                <th className="text-right">÷1,14975<br/>Rev. av. taxes</th>
                <th className="text-right text-orange-700">− Dépenses</th>
                <th className="text-right text-amber-700">− M.-d'œuvre</th>
                <th className="text-right">= Coût total</th>
                <th className="text-right">Marge $</th>
                <th className="text-right">Marge %</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={l.p.id} onClick={() => { window.location.href = `/projets/${l.p.id}`; }}
                  className={`[&>td]:p-2 [&>td]:border [&>td]:border-slate-100 cursor-pointer hover:bg-blue-50 ${i % 2 ? "bg-slate-50/40" : ""}`}>
                  <td className="text-left sticky left-0 bg-inherit z-10">
                    <div className="font-medium truncate max-w-[180px]">{l.p.nom}</div>
                    <div className="text-[10px] text-slate-500">{l.p.client_nom || "—"} · {l.p.statut}</div>
                  </td>
                  <td className="text-right tabular-nums">{formatCAD(l.prix)}</td>
                  <td className="text-right tabular-nums text-emerald-700">{l.extras ? formatCAD(l.extras) : "—"}</td>
                  <td className="text-right tabular-nums font-semibold">{formatCAD(l.revenu)}</td>
                  <td className="text-right tabular-nums text-slate-600">{formatCAD(l.revenuAT)}</td>
                  <td className="text-right tabular-nums text-orange-700">{formatCAD(l.dep)}</td>
                  <td className="text-right tabular-nums text-amber-700">{formatCAD(l.mo)}</td>
                  <td className="text-right tabular-nums">{formatCAD(l.cout)}</td>
                  <td className={`text-right tabular-nums font-bold ${l.marge < 0 ? "text-red-700" : "text-emerald-700"}`}>{formatCAD(l.marge)}</td>
                  <td className={`text-right tabular-nums font-bold ${l.marge < 0 ? "text-red-700" : "text-emerald-700"}`}>{l.margePct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-blue-100 font-bold text-xs">
              <tr className="[&>td]:p-2 [&>td]:border [&>td]:border-blue-200">
                <td className="text-left sticky left-0 bg-blue-100 z-10">TOTAL ({lignes.length})</td>
                <td className="text-right tabular-nums">{formatCAD(tot.prix)}</td>
                <td className="text-right tabular-nums text-emerald-700">{formatCAD(tot.extras)}</td>
                <td className="text-right tabular-nums">{formatCAD(tot.revenu)}</td>
                <td className="text-right tabular-nums">{formatCAD(tot.revenuAT)}</td>
                <td className="text-right tabular-nums text-orange-700">{formatCAD(tot.dep)}</td>
                <td className="text-right tabular-nums text-amber-700">{formatCAD(tot.mo)}</td>
                <td className="text-right tabular-nums">{formatCAD(tot.cout)}</td>
                <td className={`text-right tabular-nums ${tot.marge < 0 ? "text-red-700" : "text-emerald-800"}`}>{formatCAD(tot.marge)}</td>
                <td className={`text-right tabular-nums ${tot.marge < 0 ? "text-red-700" : "text-emerald-800"}`}>{margeMoyPct.toFixed(1)}%</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
      <p className="text-[11px] text-slate-500">Clique une ligne pour ouvrir le projet. La colonne « Rev. av. taxes » retire les taxes du revenu (comme pour la rentabilité réelle). Les extras comptent une fois <strong>facturés</strong>.</p>
    </div>
  );
}

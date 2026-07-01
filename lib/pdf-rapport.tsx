import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";

// Rapport de rentabilité PDF — même calcul que l'onglet Finances > Rentabilité.
const FACTEUR = 1.14975;
const cad = (n: number) => `${Math.round(n || 0).toLocaleString("fr-CA")} $`;

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: "Helvetica", color: "#0f172a" },
  h1: { fontSize: 16, fontFamily: "Helvetica-Bold", color: "#065f46" },
  sub: { fontSize: 8, color: "#64748b", marginBottom: 2 },
  kpiRow: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 8 },
  kpi: { flex: 1, border: "1 solid #e2e8f0", borderRadius: 4, padding: 6 },
  kpiLabel: { fontSize: 6.5, color: "#64748b", textTransform: "uppercase" },
  kpiVal: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 2 },
  tr: { flexDirection: "row", borderBottom: "0.5 solid #e2e8f0", paddingVertical: 3 },
  th: { flexDirection: "row", backgroundColor: "#f1f5f9", paddingVertical: 4, fontFamily: "Helvetica-Bold" },
  tf: { flexDirection: "row", backgroundColor: "#dbeafe", paddingVertical: 4, fontFamily: "Helvetica-Bold", marginTop: 1 },
  cNom: { width: "26%", paddingLeft: 3 },
  cNum: { width: "12.3%", textAlign: "right", paddingRight: 3 },
  foot: { position: "absolute", bottom: 18, left: 28, right: 28, fontSize: 6.5, color: "#94a3b8", textAlign: "center" },
});

function ligneOf(p: any) {
  const prix = (+p.prix_contrat || +p.budget_estime || 0);
  const extras = +p.extras_factures || 0;
  const revenuAT = +p.revenu_avant_taxes || ((prix + extras) / FACTEUR);
  const cout = +p.cout_total || ((+p.total_depenses || 0) + (+p.cout_main_oeuvre || 0));
  const marge = +p.marge || (revenuAT - cout);
  return { nom: p.nom, statut: p.statut, prix, extras, revenuAT, cout, marge, margePct: revenuAT > 0 ? (marge / revenuAT) * 100 : 0 };
}

function RapportRentabilite({ projets, filtre, date }: { projets: any[]; filtre: string; date: string }) {
  const lignes = projets
    .filter((p) => filtre === "tous" ? p.statut !== "annule" : p.statut === filtre)
    .map(ligneOf);
  const t = lignes.reduce((a, l) => ({ prix: a.prix + l.prix, extras: a.extras + l.extras, revenuAT: a.revenuAT + l.revenuAT, cout: a.cout + l.cout, marge: a.marge + l.marge }), { prix: 0, extras: 0, revenuAT: 0, cout: 0, marge: 0 });
  const margeMoy = t.revenuAT > 0 ? (t.marge / t.revenuAT) * 100 : 0;
  const libFiltre = filtre === "actif" ? "Projets actifs" : filtre === "complete" ? "Projets complétés" : "Tous les projets";

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.h1}>Rapport de rentabilité — Revêtement Viking Inc.</Text>
        <Text style={s.sub}>RBQ 5811-4299-01 · {libFiltre} · Généré le {date}</Text>

        <View style={s.kpiRow}>
          <View style={s.kpi}><Text style={s.kpiLabel}>Revenu avant taxes</Text><Text style={s.kpiVal}>{cad(t.revenuAT)}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Coûts totaux</Text><Text style={[s.kpiVal, { color: "#c2410c" }]}>{cad(t.cout)}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Marge nette</Text><Text style={[s.kpiVal, { color: t.marge >= 0 ? "#047857" : "#b91c1c" }]}>{cad(t.marge)}</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Marge moyenne</Text><Text style={[s.kpiVal, { color: "#1d4ed8" }]}>{margeMoy.toFixed(1)} %</Text></View>
          <View style={s.kpi}><Text style={s.kpiLabel}>Nombre de projets</Text><Text style={s.kpiVal}>{lignes.length}</Text></View>
        </View>

        <View style={s.th}>
          <Text style={s.cNom}>Projet</Text>
          <Text style={s.cNum}>Prix contrat</Text>
          <Text style={s.cNum}>Extras</Text>
          <Text style={s.cNum}>Rev. av. taxes</Text>
          <Text style={s.cNum}>Coûts</Text>
          <Text style={s.cNum}>Marge $</Text>
          <Text style={s.cNum}>Marge %</Text>
        </View>
        {lignes.map((l, i) => (
          <View key={i} style={s.tr}>
            <Text style={s.cNom}>{(l.nom || "").slice(0, 42)}</Text>
            <Text style={s.cNum}>{cad(l.prix)}</Text>
            <Text style={s.cNum}>{l.extras ? cad(l.extras) : "—"}</Text>
            <Text style={s.cNum}>{cad(l.revenuAT)}</Text>
            <Text style={s.cNum}>{cad(l.cout)}</Text>
            <Text style={[s.cNum, { color: l.marge >= 0 ? "#047857" : "#b91c1c" }]}>{cad(l.marge)}</Text>
            <Text style={[s.cNum, { color: l.marge >= 0 ? "#047857" : "#b91c1c" }]}>{l.margePct.toFixed(1)}%</Text>
          </View>
        ))}
        <View style={s.tf}>
          <Text style={s.cNom}>TOTAL ({lignes.length})</Text>
          <Text style={s.cNum}>{cad(t.prix)}</Text>
          <Text style={s.cNum}>{cad(t.extras)}</Text>
          <Text style={s.cNum}>{cad(t.revenuAT)}</Text>
          <Text style={s.cNum}>{cad(t.cout)}</Text>
          <Text style={s.cNum}>{cad(t.marge)}</Text>
          <Text style={s.cNum}>{margeMoy.toFixed(1)}%</Text>
        </View>

        <Text style={s.foot}>Rentabilité calculée avant taxes (revenu ÷ 1,14975 − coûts). Revenu = prix de contrat + extras facturés. Document interne — Revêtement Viking Inc.</Text>
      </Page>
    </Document>
  );
}

export async function genererRapportRentabiliteBlob(props: { projets: any[]; filtre: string; date: string }): Promise<Blob> {
  return await pdf(<RapportRentabilite {...props} />).toBlob();
}

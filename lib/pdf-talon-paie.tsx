import { Document, Page, Text, View, StyleSheet, pdf, Svg, Path } from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1e293b" },
  header: { flexDirection: "row", alignItems: "center", gap: 10, borderBottom: "2pt solid #0f172a", paddingBottom: 12, marginBottom: 16 },
  h1: { fontSize: 18, fontWeight: 700 },
  small: { fontSize: 8, color: "#64748b" },
  bloc: { marginBottom: 14 },
  ligneInfo: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  label: { color: "#64748b" },
  val: { fontWeight: 700 },
  sectionTitre: { fontSize: 11, fontWeight: 700, backgroundColor: "#0f172a", color: "white", padding: 6, marginTop: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", padding: 5, borderBottom: "0.5pt solid #e2e8f0" },
  net: { marginTop: 12, padding: 12, backgroundColor: "#10b981", color: "white", flexDirection: "row", justifyContent: "space-between", borderRadius: 4 },
  netLabel: { fontSize: 13, fontWeight: 700 },
  netVal: { fontSize: 16, fontWeight: 700 },
  footer: { position: "absolute", bottom: 30, left: 40, right: 40, fontSize: 7, color: "#94a3b8", textAlign: "center", borderTop: "0.5pt solid #e2e8f0", paddingTop: 6 },
});

interface TalonProps {
  employe: string;
  debut: string;
  fin: string;
  heures_normales: number;
  heures_sup: number;
  taux_horaire: number;
  das_pct: number;
  montant_brut: number;
  das_montant: number;
  montant_net: number;
  date_paiement?: string;
}

const cad = (n: number) => new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(n || 0);
const dateLisible = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" });
};

export function TalonPaiePDF({ talon }: { talon: TalonProps }) {
  const brutNormal = talon.heures_normales * talon.taux_horaire;
  const brutSup = talon.heures_sup * talon.taux_horaire * 1.5;
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Svg width="44" height="33" viewBox="0 0 400 280">
            <Path d="M40 180 L360 180 L340 240 L60 240 Z" stroke="#0f172a" strokeWidth={6} fill="none" />
            <Path d="M200 40 L200 180" stroke="#0f172a" strokeWidth={6} />
            <Path d="M205 70 L300 100 L300 175 L205 175 Z" fill="#0f172a" />
          </Svg>
          <View>
            <Text style={s.h1}>Talon de paie</Text>
            <Text style={s.small}>Revêtement Viking Inc. · RBQ 5811-4299-01</Text>
          </View>
        </View>

        {/* Infos employé + période */}
        <View style={s.bloc}>
          <View style={s.ligneInfo}><Text style={s.label}>Employé</Text><Text style={s.val}>{talon.employe}</Text></View>
          <View style={s.ligneInfo}><Text style={s.label}>Période de paie</Text><Text style={s.val}>{dateLisible(talon.debut)} au {dateLisible(talon.fin)}</Text></View>
          <View style={s.ligneInfo}><Text style={s.label}>Date de paiement</Text><Text style={s.val}>{talon.date_paiement ? dateLisible(talon.date_paiement) : "—"}</Text></View>
        </View>

        {/* Gains */}
        <Text style={s.sectionTitre}>Gains</Text>
        <View style={s.row}>
          <Text>Heures normales — {talon.heures_normales.toFixed(2)} h × {cad(talon.taux_horaire)}</Text>
          <Text style={s.val}>{cad(brutNormal)}</Text>
        </View>
        {talon.heures_sup > 0 && (
          <View style={s.row}>
            <Text>Heures supplémentaires — {talon.heures_sup.toFixed(2)} h × {cad(talon.taux_horaire * 1.5)} (×1.5)</Text>
            <Text style={s.val}>{cad(brutSup)}</Text>
          </View>
        )}
        <View style={s.row}>
          <Text style={s.val}>Salaire brut</Text>
          <Text style={s.val}>{cad(talon.montant_brut)}</Text>
        </View>

        {/* Retenues */}
        <Text style={s.sectionTitre}>Retenues</Text>
        <View style={s.row}>
          <Text>Déductions à la source (DAS) — {(talon.das_pct * 100).toFixed(0)} %</Text>
          <Text style={s.val}>− {cad(talon.das_montant)}</Text>
        </View>
        <Text style={[s.small, { marginTop: 4 }]}>
          Estimation regroupée (impôt fédéral, provincial, RRQ, RQAP, AE). Montant indicatif — se référer au relevé officiel pour les déclarations.
        </Text>

        {/* Net */}
        <View style={s.net}>
          <Text style={s.netLabel}>Salaire net à payer</Text>
          <Text style={s.netVal}>{cad(talon.montant_net)}</Text>
        </View>

        <View style={s.footer}>
          <Text>Revêtement Viking Inc. · RBQ 5811-4299-01 · Talon généré le {new Date().toLocaleDateString("fr-CA")} · Document interne</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function genererTalonPaieBlob(talon: TalonProps): Promise<Blob> {
  return await pdf(<TalonPaiePDF talon={talon} />).toBlob();
}

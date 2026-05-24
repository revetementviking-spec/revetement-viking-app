import { Document, Page, Text, View, StyleSheet, pdf, Svg, Path } from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1e293b", lineHeight: 1.4 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, borderBottom: "2pt solid #0f172a", paddingBottom: 10, marginBottom: 14 },
  h1: { fontSize: 20, fontWeight: 700, color: "#0f172a" },
  h2: { fontSize: 12, fontWeight: 700, backgroundColor: "#0f172a", color: "white", padding: 4, marginTop: 12, marginBottom: 6 },
  small: { fontSize: 8, color: "#64748b" },
  row: { flexDirection: "row", justifyContent: "space-between", padding: 3, borderBottom: "0.5pt solid #cbd5e1" },
  bloc: { padding: 8, backgroundColor: "#f1f5f9", marginBottom: 8 },
  signZone: { marginTop: 20, borderTop: "1pt solid #cbd5e1", paddingTop: 12 },
  signLine: { borderBottom: "1pt solid #0f172a", marginTop: 30, marginBottom: 4, width: "70%" },
});

interface ContratData {
  numero: string; titre: string; date_emission: string;
  date_debut_travaux?: string; date_fin_prevue?: string;
  client_nom?: string; client_adresse?: string; client_telephone?: string; client_courriel?: string;
  montant_avant_taxes?: number; taxes_pct?: number; montant_total?: number;
  depot_pct?: number; depot_montant?: number;
  conditions?: string; garantie?: string;
  description_travaux?: string;
}

export function ContratPDF({ data }: { data: ContratData }) {
  const tps = data.montant_avant_taxes ? data.montant_avant_taxes * 0.05 : 0;
  const tvq = data.montant_avant_taxes ? data.montant_avant_taxes * 0.09975 : 0;
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        {/* En-tête */}
        <View style={s.header}>
          <Svg width="55" height="40" viewBox="0 0 400 280">
            <Path d="M40 180 L360 180 L340 240 L60 240 Z" stroke="#0f172a" strokeWidth={6} fill="none" />
            <Path d="M200 40 L200 180" stroke="#0f172a" strokeWidth={6} />
            <Path d="M205 70 L300 100 L300 175 L205 175 Z" fill="#0f172a" />
            <Path d="M360 180 L390 165 L370 158 L390 148 L370 142 L385 132" stroke="#0f172a" strokeWidth={5} fill="none" />
          </Svg>
          <View style={{ flex: 1 }}>
            <Text style={s.h1}>CONTRAT DE SERVICES</Text>
            <Text style={s.small}>Revêtement Viking Inc. · RBQ 5811-4299-01 · info@entreprisesxpress.ca</Text>
          </View>
          <View style={{ textAlign: "right" }}>
            <Text style={{ fontWeight: 700 }}>{data.numero}</Text>
            <Text style={s.small}>Émis le {data.date_emission}</Text>
          </View>
        </View>

        {/* Parties */}
        <View style={s.bloc}>
          <Text style={{ fontWeight: 700, marginBottom: 4 }}>ENTRE :</Text>
          <Text style={{ fontWeight: 700 }}>Revêtement Viking Inc.</Text>
          <Text style={s.small}>RBQ : 5811-4299-01</Text>
          <Text style={s.small}>info@entreprisesxpress.ca</Text>
          <Text style={{ marginTop: 6, fontWeight: 700 }}>ET :</Text>
          <Text style={{ fontWeight: 700 }}>{data.client_nom || "—"}</Text>
          {data.client_adresse && <Text style={s.small}>{data.client_adresse}</Text>}
          {data.client_telephone && <Text style={s.small}>Tél. : {data.client_telephone}</Text>}
          {data.client_courriel && <Text style={s.small}>Courriel : {data.client_courriel}</Text>}
        </View>

        {/* Objet */}
        <Text style={s.h2}>1. OBJET DU CONTRAT</Text>
        <Text style={{ fontWeight: 700 }}>{data.titre}</Text>
        {data.description_travaux && <Text style={{ marginTop: 4 }}>{data.description_travaux}</Text>}

        {/* Échéancier */}
        <Text style={s.h2}>2. ÉCHÉANCIER</Text>
        <View style={s.row}><Text>Début des travaux :</Text><Text>{data.date_debut_travaux || "À déterminer"}</Text></View>
        <View style={s.row}><Text>Fin prévue :</Text><Text>{data.date_fin_prevue || "À déterminer"}</Text></View>

        {/* Prix */}
        <Text style={s.h2}>3. PRIX ET MODALITÉS</Text>
        <View style={s.row}><Text>Sous-total (avant taxes) :</Text><Text>{(data.montant_avant_taxes || 0).toFixed(2)} $</Text></View>
        <View style={s.row}><Text>TPS (5%) :</Text><Text>{tps.toFixed(2)} $</Text></View>
        <View style={s.row}><Text>TVQ (9.975%) :</Text><Text>{tvq.toFixed(2)} $</Text></View>
        <View style={[s.row, { backgroundColor: "#0f172a" }]}><Text style={{ color: "white", fontWeight: 700 }}>TOTAL :</Text><Text style={{ color: "white", fontWeight: 700 }}>{(data.montant_total || 0).toFixed(2)} $</Text></View>
        <Text style={{ marginTop: 6, fontSize: 9 }}>
          <Text style={{ fontWeight: 700 }}>Dépôt requis : </Text>
          {(data.depot_pct ?? 30)}% du total, soit <Text style={{ fontWeight: 700 }}>{(data.depot_montant || 0).toFixed(2)} $</Text>, à la signature du contrat.
        </Text>
        <Text style={{ fontSize: 9 }}>Solde payable à la fin des travaux après inspection.</Text>

        {/* Garantie */}
        <Text style={s.h2}>4. GARANTIE</Text>
        <Text style={{ fontSize: 9 }}>{data.garantie || "Garantie standard de 1 an sur la main-d'œuvre. Garantie du manufacturier appliquée sur les matériaux selon leurs spécifications."}</Text>

        {/* Conditions */}
        <Text style={s.h2}>5. CONDITIONS GÉNÉRALES</Text>
        <Text style={{ fontSize: 9 }}>{data.conditions || `• Les prix incluent la main-d'œuvre et les matériaux selon la soumission acceptée.
• Tout ajout ou modification fera l'objet d'un avenant écrit.
• Les retards causés par les conditions météo ou des éléments hors de notre contrôle ne peuvent être imputés à Revêtement Viking Inc.
• Le client s'engage à donner accès au chantier durant les heures de travail.
• En cas de retard de paiement de plus de 30 jours, des intérêts de 1,5%/mois seront facturés.
• Tout litige sera soumis au tribunal du district du domicile du client.`}</Text>

        {/* Signatures */}
        <View style={s.signZone}>
          <Text style={{ fontWeight: 700, marginBottom: 6 }}>Signature des parties :</Text>
          <View style={{ flexDirection: "row", gap: 30 }}>
            <View style={{ flex: 1 }}>
              <View style={s.signLine} />
              <Text style={s.small}>Revêtement Viking Inc.</Text>
              <Text style={s.small}>Date : ____________</Text>
            </View>
            <View style={{ flex: 1 }}>
              <View style={s.signLine} />
              <Text style={s.small}>{data.client_nom || "Client"}</Text>
              <Text style={s.small}>Date : ____________</Text>
            </View>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function genererContratBlob(data: ContratData): Promise<Blob> {
  return await pdf(<ContratPDF data={data} />).toBlob();
}

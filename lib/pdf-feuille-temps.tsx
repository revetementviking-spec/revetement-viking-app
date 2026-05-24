import { Document, Page, Text, View, StyleSheet, pdf, Svg, Path } from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#1e293b" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, borderBottom: "2pt solid #0f172a", paddingBottom: 10, marginBottom: 12 },
  h1: { fontSize: 16, fontWeight: 700 },
  small: { fontSize: 8, color: "#64748b" },
  row: { flexDirection: "row", padding: 4, borderBottom: "0.5pt solid #cbd5e1" },
  rowHead: { backgroundColor: "#0f172a", color: "white", padding: 4, fontSize: 9, flexDirection: "row" },
  total: { marginTop: 8, padding: 8, backgroundColor: "#10b981", color: "white", flexDirection: "row", justifyContent: "space-between" },
});

interface Ligne { employe: string; date: string; heures: number; taux_horaire: number; description?: string; }
interface Props { projet: { nom: string; client_nom?: string; adresse_chantier?: string }; lignes: Ligne[]; }

export function FeuilleTempsPDF({ projet, lignes }: Props) {
  const totalH = lignes.reduce((x, l) => x + l.heures, 0);
  const totalC = lignes.reduce((x, l) => x + l.heures * l.taux_horaire, 0);
  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.header}>
          <Svg width="40" height="30" viewBox="0 0 400 280">
            <Path d="M40 180 L360 180 L340 240 L60 240 Z" stroke="#0f172a" strokeWidth={6} fill="none" />
            <Path d="M200 40 L200 180" stroke="#0f172a" strokeWidth={6} />
            <Path d="M205 70 L300 100 L300 175 L205 175 Z" fill="#0f172a" />
          </Svg>
          <View>
            <Text style={s.h1}>Feuille de temps</Text>
            <Text style={s.small}>Revêtement Viking Inc. · RBQ 5811-4299-01</Text>
          </View>
        </View>

        <View style={{ marginBottom: 8 }}>
          <Text style={{ fontSize: 11, fontWeight: 700 }}>{projet.nom}</Text>
          {projet.client_nom && <Text style={s.small}>Client : {projet.client_nom}</Text>}
          {projet.adresse_chantier && <Text style={s.small}>Chantier : {projet.adresse_chantier}</Text>}
          <Text style={s.small}>Émis le {new Date().toLocaleDateString("fr-CA")}</Text>
        </View>

        <View style={s.rowHead}>
          <Text style={{ width: "25%" }}>Employé</Text>
          <Text style={{ width: "15%" }}>Date</Text>
          <Text style={{ width: "10%", textAlign: "right" }}>Heures</Text>
          <Text style={{ width: "15%", textAlign: "right" }}>Taux $/h</Text>
          <Text style={{ width: "15%", textAlign: "right" }}>Coût</Text>
          <Text style={{ width: "20%" }}>Note</Text>
        </View>
        {lignes.map((l, i) => (
          <View key={i} style={s.row}>
            <Text style={{ width: "25%" }}>{l.employe}</Text>
            <Text style={{ width: "15%" }}>{l.date}</Text>
            <Text style={{ width: "10%", textAlign: "right" }}>{l.heures.toFixed(1)}</Text>
            <Text style={{ width: "15%", textAlign: "right" }}>{l.taux_horaire.toFixed(2)}</Text>
            <Text style={{ width: "15%", textAlign: "right" }}>{(l.heures * l.taux_horaire).toFixed(2)} $</Text>
            <Text style={{ width: "20%", fontSize: 7 }}>{l.description || ""}</Text>
          </View>
        ))}
        <View style={s.total}>
          <Text>Total : {totalH.toFixed(1)} h</Text>
          <Text>{totalC.toFixed(2)} $ (DAS inclus si applicable)</Text>
        </View>
      </Page>
    </Document>
  );
}

export async function genererFeuilleTempsBlob(props: Props): Promise<Blob> {
  return await pdf(<FeuilleTempsPDF {...props} />).toBlob();
}

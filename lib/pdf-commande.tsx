import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";
import type { SoumissionCalculee } from "./calculateur";
import { formatCAD } from "./calculateur";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1e293b" },
  header: { borderBottom: "2pt solid #0f172a", paddingBottom: 8, marginBottom: 12, flexDirection: "row", justifyContent: "space-between" },
  h1: { fontSize: 16, fontWeight: 700, color: "#0f172a" },
  small: { fontSize: 8, color: "#64748b" },
  sectionTitle: { backgroundColor: "#0f172a", color: "white", padding: 5, fontSize: 11, marginBottom: 5, marginTop: 12 },
  row: { flexDirection: "row", padding: 4, borderBottom: "0.5pt solid #cbd5e1" },
  rowHeader: { backgroundColor: "#e2e8f0", fontWeight: 700 },
  c1: { width: "15%" },
  c2: { width: "45%" },
  c3: { width: "20%" },
  c4: { width: "10%", textAlign: "right" },
  c5: { width: "10%", textAlign: "right" },
  total: { marginTop: 8, padding: 6, backgroundColor: "#f1f5f9", fontWeight: 700, flexDirection: "row", justifyContent: "space-between" },
});

interface Props {
  numeroSoumission: string;
  date: string;
  client: { nom: string; adresse: string; projet: string };
  calcul: SoumissionCalculee;
}

export function CommandeMateriauxPDF({ numeroSoumission, date, client, calcul }: Props) {
  // Grouper par fournisseur
  const parFournisseur: Record<string, typeof calcul.lignes> = {};
  for (const l of calcul.lignes) {
    const f = l.materiau.fournisseur;
    if (!parFournisseur[f]) parFournisseur[f] = [];
    parFournisseur[f].push(l);
  }

  return (
    <Document>
      {Object.entries(parFournisseur).map(([fournisseur, lignes]) => {
        const totalFournisseur = lignes.reduce((s, l) => s + l.coutMateriau, 0);
        return (
          <Page key={fournisseur} size="LETTER" style={styles.page}>
            <View style={styles.header}>
              <View>
                <Text style={styles.h1}>BON DE COMMANDE</Text>
                <Text style={styles.small}>Revêtement Viking Inc. · RBQ 5811-4299-01</Text>
                <Text style={styles.small}>info@entreprisesxpress.ca</Text>
              </View>
              <View style={{ textAlign: "right" }}>
                <Text style={styles.h1}>{fournisseur}</Text>
                <Text style={styles.small}>Réf. soum. : {numeroSoumission}</Text>
                <Text style={styles.small}>Date : {date}</Text>
              </View>
            </View>

            <View>
              <Text style={{ fontSize: 9, marginBottom: 4 }}>
                <Text style={{ fontWeight: 700 }}>Projet : </Text>
                {client.projet || "—"} · {client.nom}
              </Text>
              <Text style={{ fontSize: 9 }}>
                <Text style={{ fontWeight: 700 }}>Livraison : </Text>
                {client.adresse || "à confirmer"}
              </Text>
            </View>

            <Text style={styles.sectionTitle}>MATÉRIAUX À COMMANDER</Text>
            <View style={[styles.row, styles.rowHeader]}>
              <Text style={styles.c1}>Code</Text>
              <Text style={styles.c2}>Description</Text>
              <Text style={styles.c3}>Format</Text>
              <Text style={styles.c4}>Qté</Text>
              <Text style={styles.c5}>Coût</Text>
            </View>
            {lignes.map((l, i) => (
              <View style={styles.row} key={i}>
                <Text style={styles.c1}>{l.materiau.code}</Text>
                <Text style={styles.c2}>
                  {l.materiau.nom}
                  {(l as any).couleur && <Text style={{ color: "#475569" }}> — Couleur : {(l as any).couleur}</Text>}
                </Text>
                <Text style={styles.c3}>{l.materiau.formatVendu}</Text>
                <Text style={styles.c4}>{l.formatACommander}</Text>
                <Text style={styles.c5}>{formatCAD(l.coutMateriau)}</Text>
              </View>
            ))}

            <View style={styles.total}>
              <Text>TOTAL {fournisseur.toUpperCase()} (avant taxes)</Text>
              <Text>{formatCAD(totalFournisseur)}</Text>
            </View>

            <Text style={{ marginTop: 20, fontSize: 8, color: "#64748b" }}>
              ⚠ Vérifier disponibilités et couleurs avant commande. Confirmer livraison sur le chantier.
            </Text>
          </Page>
        );
      })}
    </Document>
  );
}

export async function genererCommandeBlob(props: Props): Promise<Blob> {
  return await pdf(<CommandeMateriauxPDF {...props} />).toBlob();
}

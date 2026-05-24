import { Document, Page, Text, View, StyleSheet, pdf, Svg, Path } from "@react-pdf/renderer";
import type { SoumissionCalculee } from "./calculateur";
import { formatCAD } from "./calculateur";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica", color: "#1e293b" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottom: "2pt solid #0f172a",
    paddingBottom: 10,
    marginBottom: 12,
  },
  h1: { fontSize: 18, fontWeight: 700, color: "#0f172a" },
  small: { fontSize: 8, color: "#64748b" },
  section: { marginBottom: 10 },
  sectionTitle: {
    backgroundColor: "#0f172a",
    color: "white",
    padding: 4,
    fontSize: 10,
    marginBottom: 4,
  },
  row: { flexDirection: "row", padding: 3, borderBottom: "0.5pt solid #cbd5e1" },
  rowHeader: { backgroundColor: "#e2e8f0", fontWeight: 700 },
  col1: { width: "50%" },
  col2: { width: "12%", textAlign: "right" },
  col3: { width: "18%", textAlign: "right" },
  col4: { width: "20%", textAlign: "right" },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", padding: 3 },
  totalsTitle: { width: "60%" },
  totalsValue: { width: "40%", textAlign: "right" },
  grandTotal: {
    marginTop: 8,
    padding: 8,
    backgroundColor: "#0f172a",
    color: "white",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  conditions: { marginTop: 14, fontSize: 7.5, color: "#475569", lineHeight: 1.4 },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 7,
    color: "#94a3b8",
    borderTop: "0.5pt solid #cbd5e1",
    paddingTop: 6,
  },
});

interface Props {
  client: {
    nom: string;
    adresse: string;
    telephone: string;
    courriel: string;
    projet: string;
  };
  numeroSoumission: string;
  date: string;
  calcul: SoumissionCalculee;
}

export function SoumissionPDF({ client, numeroSoumission, date, calcul }: Props) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* En-tête */}
        <View style={styles.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Svg width="46" height="34" viewBox="0 0 400 280">
              <Path d="M40 180 L360 180 L340 240 L60 240 Z" stroke="#0f172a" strokeWidth={6} fill="none" />
              <Path d="M200 40 L200 180" stroke="#0f172a" strokeWidth={6} />
              <Path d="M205 70 L300 100 L300 175 L205 175 Z" fill="#0f172a" />
              <Path d="M360 180 L390 165 L370 158 L390 148 L370 142 L385 132" stroke="#0f172a" strokeWidth={5} fill="none" />
            </Svg>
            <View>
              <Text style={styles.h1}>Revêtement Viking Inc.</Text>
            <Text style={styles.small}>RBQ 5811-4299-01</Text>
            <Text style={styles.small}>info@entreprisesxpress.ca</Text>
            <Text style={styles.small}>Revêtement extérieur — Soffite · Fascia · Solin · Parement</Text>
            </View>
          </View>
          <View style={{ textAlign: "right" }}>
            <Text style={styles.h1}>SOUMISSION</Text>
            <Text style={styles.small}>No. {numeroSoumission}</Text>
            <Text style={styles.small}>Date: {date}</Text>
            <Text style={styles.small}>Valide 30 jours</Text>
          </View>
        </View>

        {/* Client */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CLIENT</Text>
          <Text>{client.nom}</Text>
          <Text>{client.adresse}</Text>
          <Text>{client.telephone} {client.courriel ? `· ${client.courriel}` : ""}</Text>
          {client.projet ? <Text style={{ marginTop: 4 }}>Projet : {client.projet}</Text> : null}
        </View>

        {/* Détail des matériaux */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>DÉTAIL DES TRAVAUX</Text>
          <View style={[styles.row, styles.rowHeader]}>
            <Text style={styles.col1}>Description</Text>
            <Text style={styles.col2}>Qté</Text>
            <Text style={styles.col3}>Unité</Text>
            <Text style={styles.col4}>Sous-total</Text>
          </View>
          {calcul.lignes.map((l, i) => {
            const couleur = (l as any).couleur;
            return (
              <View style={styles.row} key={i}>
                <Text style={styles.col1}>
                  {l.materiau.nom}
                  {couleur ? ` — Couleur : ${couleur}` : ""}
                  {"\n"}
                  <Text style={styles.small}>
                    {l.materiau.fournisseur} · {l.materiau.code} · {l.heuresMO.toFixed(1)}h MO
                  </Text>
                </Text>
                <Text style={styles.col2}>{l.quantiteAvecSurplus.toFixed(0)}</Text>
                <Text style={styles.col3}>{l.materiau.uniteCalcul}</Text>
                <Text style={styles.col4}>{formatCAD(l.sousTotal)}</Text>
              </View>
            );
          })}
        </View>

        {/* Totaux */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RÉCAPITULATIF</Text>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsTitle}>Matériaux</Text>
            <Text style={styles.totalsValue}>{formatCAD(calcul.totalVenteMateriaux)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsTitle}>
              Main-d'œuvre ({calcul.totalHeures.toFixed(1)} h)
            </Text>
            <Text style={styles.totalsValue}>{formatCAD(calcul.totalCoutMO)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsTitle}>Frais d'administration et gestion</Text>
            <Text style={styles.totalsValue}>{formatCAD(calcul.fraisGestionMontant)}</Text>
          </View>
          <View style={[styles.totalsRow, { borderTop: "1pt solid #1e293b", marginTop: 4, paddingTop: 4 }]}>
            <Text style={[styles.totalsTitle, { fontWeight: 700 }]}>Sous-total avant taxes</Text>
            <Text style={[styles.totalsValue, { fontWeight: 700 }]}>
              {formatCAD(calcul.sousTotalAvantTaxes)}
            </Text>
          </View>
          {calcul.tps > 0 && (
            <>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsTitle}>TPS (5%)</Text>
                <Text style={styles.totalsValue}>{formatCAD(calcul.tps)}</Text>
              </View>
              <View style={styles.totalsRow}>
                <Text style={styles.totalsTitle}>TVQ (9.975%)</Text>
                <Text style={styles.totalsValue}>{formatCAD(calcul.tvq)}</Text>
              </View>
            </>
          )}
          <View style={styles.grandTotal}>
            <Text style={{ fontSize: 12, fontWeight: 700 }}>TOTAL</Text>
            <Text style={{ fontSize: 14, fontWeight: 700 }}>{formatCAD(calcul.total)}</Text>
          </View>
        </View>

        <View style={styles.conditions}>
          <Text style={{ fontWeight: 700, marginBottom: 3 }}>CONDITIONS GÉNÉRALES</Text>
          <Text>
            • Soumission valide pour 30 jours à compter de la date d'émission.{"\n"}
            • Acceptation : signature du client + dépôt de 30% requis pour démarrer.{"\n"}
            • Solde 60% à l'avancement (50% des travaux), 10% à la fin.{"\n"}
            • Garantie main-d'œuvre 2 ans · Garantie matériaux selon fabricant.{"\n"}
            • Tout travail supplémentaire non prévu sera facturé en supplément après approbation écrite.{"\n"}
            • Le client est responsable de l'accès au chantier et de l'électricité.{"\n"}
            • Permis et autorisations municipales à la charge du client sauf mention contraire.
          </Text>
        </View>

        <Text style={styles.footer}>
          Revêtement Viking Inc. · RBQ 5811-4299-01 · info@entreprisesxpress.ca
        </Text>
      </Page>
    </Document>
  );
}

export async function genererPDFBlob(props: Props): Promise<Blob> {
  const doc = <SoumissionPDF {...props} />;
  return await pdf(doc).toBlob();
}

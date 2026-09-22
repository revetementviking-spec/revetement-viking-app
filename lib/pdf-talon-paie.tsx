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
  /** Indemnité de jour férié incluse dans `heures_normales` (1/20 — lib/paie-feries.ts). */
  heures_ferie?: number;
  /** JSON [{ date, nom, heures }] des fériés de la période. */
  feries_detail?: string | null;
  /** Solde de banque après la période — affiché quand des heures y ont été reportées. */
  banque_solde?: number;
  /** Ventilation par taux horaire (fournie par /api/paies). Affichée ligne par ligne
   *  seulement si la quinzaine contient PLUSIEURS taux et que la somme retombe sur le
   *  brut versé — sinon une seule ligne, comme avant. */
  gains_par_taux?: { taux: number; heures: number; montant: number }[];
}

/** Lignes de gains à imprimer : une par taux quand il y en a plusieurs et que leur somme
 *  est bien le brut de la paie (au cent près) ; sinon la ligne unique historique. */
export function lignesGainsTalon(t: Pick<TalonProps, "heures_normales" | "taux_horaire" | "montant_brut" | "gains_par_taux">): { heures: number; taux: number; montant: number }[] {
  const g = (t.gains_par_taux || []).filter((x) => x && x.heures > 0);
  if (g.length > 1) {
    const somme = g.reduce((s, x) => s + x.montant, 0);
    if (Math.abs(somme - t.montant_brut) < 0.005) return g.map((x) => ({ heures: x.heures, taux: x.taux, montant: x.montant }));
  }
  return [{ heures: t.heures_normales, taux: t.taux_horaire, montant: t.heures_normales * t.taux_horaire }];
}

const cad = (n: number) => new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(n || 0);
const dateLisible = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" });
};

/** Fériés de la période, lisibles. Un JSON abîmé ne doit pas empêcher un talon de sortir. */
function feriesLisibles(json?: string | null): { date: string; nom: string; heures: number }[] {
  try {
    const d = JSON.parse(json || "[]");
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

export function TalonPaiePDF({ talon }: { talon: TalonProps }) {
  // L'indemnité de férié est DANS les heures payées : on la sort des lignes de travail pour
  // que l'employé voie les deux gains séparément. Sans ça, le talon montre des heures qu'il
  // n'a pas travaillées, et un employé qui recompte ses punchs ne retrouve pas son total.
  const heuresFerie = talon.heures_ferie || 0;
  const heuresTravail = Math.max(0, talon.heures_normales - heuresFerie);
  const brutFerie = heuresFerie * talon.taux_horaire;
  const feries = feriesLisibles(talon.feries_detail);
  // La ventilation par taux et l'indemnité de férié cohabitent : on donne à
  // `lignesGainsTalon` le TRAVAIL seul (heures et brut nets de l'indemnité), et la ligne de
  // férié s'ajoute après. Les deux ensemble redonnent exactement `montant_brut` — et si la
  // ventilation ne retombe pas sur ce brut-là, la fonction sert d'elle-même la ligne unique.
  const gains = heuresFerie > 0
    ? lignesGainsTalon({
        heures_normales: heuresTravail,
        taux_horaire: talon.taux_horaire,
        montant_brut: talon.montant_brut - brutFerie,
        gains_par_taux: talon.gains_par_taux,
      })
    : lignesGainsTalon(talon);
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
        {gains.map((g, i) => (
          <View style={s.row} key={i}>
            <Text>Heures payées — {g.heures.toFixed(2)} h × {cad(g.taux)}</Text>
            <Text style={s.val}>{cad(g.montant)}</Text>
          </View>
        ))}
        {heuresFerie > 0 && (
          <View style={s.row}>
            <Text>
              Indemnité jour férié — {heuresFerie.toFixed(2)} h × {cad(talon.taux_horaire)}
              {feries.length > 0 ? `\n${feries.map((f) => `${f.nom} (${dateLisible(f.date)})`).join(", ")}` : ""}
            </Text>
            <Text style={s.val}>{cad(brutFerie)}</Text>
          </View>
        )}
        <View style={s.row}>
          <Text style={s.val}>Salaire brut</Text>
          <Text style={s.val}>{cad(talon.montant_brut)}</Text>
        </View>
        {heuresFerie > 0 && (
          <Text style={[s.small, { marginTop: 4 }]}>
            Indemnité de jour férié : 1/20 des heures travaillées des 4 semaines complètes précédant
            la semaine du congé (Loi sur les normes du travail, art. 62).
          </Text>
        )}
        {(talon.banque_solde || 0) > 0 && (
          <Text style={[s.small, { marginTop: 2 }]}>
            Banque d'heures au terme de la période : {(talon.banque_solde || 0).toFixed(2)} h, payables plus tard.
          </Text>
        )}

        {/* Net (DAS retiré de l'affichage — montant payé tel quel) */}
        <View style={s.net}>
          <Text style={s.netLabel}>Salaire à payer</Text>
          <Text style={s.netVal}>{cad(talon.montant_brut)}</Text>
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

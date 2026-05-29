import { Document, Page, Text, View, StyleSheet, pdf, Svg, Path, Image } from "@react-pdf/renderer";

const ENTREPRISE = {
  nom: "Revêtement Viking Inc.",
  adresse: "1634 Rue Joliette",
  ville: "Montréal",
  province: "Qc, Canada",
  code_postal: "H1W 3E9",
  telephone: "438-493-2041",
  courriel: "revetementviking@gmail.com",
  rbq: "5811-4299-01",
  tps: "775895501",
  tvq: "1228912103",
};

const ASSURANCE = { compagnie: "L'Unique Assurance", police: "30840653" };

export interface ContratData {
  numero: string;
  charge_projet: string;
  client_nom: string;
  client_adresse?: string;
  client_ville?: string;
  client_province?: string;
  client_code_postal?: string;
  client_telephone?: string;
  client_courriel?: string;
  proprietaire?: string;
  locataire?: string;
  adresse_travaux?: string;
  ville_travaux?: string;
  code_postal_travaux?: string;
  province_travaux?: string;
  soumission_numero?: string;
  soumission_date?: string;
  date_debut_travaux: string;
  prix_total: number;
  depot_pct?: number;
  paiement_milieu_pct?: number;
  paiement_fin_pct?: number;
  paiement_signature_pct?: number;
  notes_travaux?: string;
  signature_entrepreneur?: { nom: string; date: string };
  signature_client?: { nom: string; date: string };
  signature_client_image?: string;                 // dataURL PNG dessinée par le client
}

const COULEUR_PRIMAIRE = "#1e3a5f"; // bleu marine Viking
const COULEUR_TEXTE = "#1e293b";
const COULEUR_GRIS = "#64748b";
const COULEUR_GRIS_CLAIR = "#94a3b8";

const s = StyleSheet.create({
  page: { paddingTop: 70, paddingBottom: 70, paddingHorizontal: 50, fontSize: 10, fontFamily: "Helvetica", color: COULEUR_TEXTE, lineHeight: 1.45 },
  pageCouv: { padding: 50, fontSize: 10, fontFamily: "Helvetica", color: COULEUR_TEXTE },

  // EN-TÊTE sur chaque page (sauf couverture)
  enTete: { position: "absolute", top: 25, left: 50, right: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 8, borderBottom: "1.5pt solid " + COULEUR_PRIMAIRE },
  enTeteLogo: { flexDirection: "row", alignItems: "center", gap: 8 },
  enTeteTitre: { fontSize: 11, fontWeight: 700, color: COULEUR_PRIMAIRE },
  enTeteSous: { fontSize: 8, color: COULEUR_GRIS },

  // COUVERTURE
  couvLogoBloc: { alignItems: "center", marginTop: 80 },
  couvNomEntreprise: { fontSize: 14, fontWeight: 700, color: COULEUR_PRIMAIRE, letterSpacing: 2, marginTop: 10 },
  titreCouv: { fontSize: 26, fontWeight: 700, textAlign: "center", marginTop: 60, color: COULEUR_PRIMAIRE, letterSpacing: 0.5 },
  sousTitreCouv: { fontSize: 12, fontWeight: 400, textAlign: "center", color: COULEUR_GRIS, marginTop: 4 },
  ligneCouv: { borderBottom: "0.5pt solid " + COULEUR_PRIMAIRE, marginTop: 30, marginBottom: 30, marginHorizontal: 80 },
  introCouv: { fontSize: 10, marginHorizontal: 70, textAlign: "center", color: COULEUR_GRIS, lineHeight: 1.6 },
  nomClient: { fontSize: 16, fontWeight: 700, textAlign: "center", marginTop: 8, color: COULEUR_TEXTE },
  numContrat: { fontSize: 9, textAlign: "center", color: COULEUR_GRIS_CLAIR, marginTop: 80, letterSpacing: 1 },

  // SECTIONS
  h1: { fontSize: 13, fontWeight: 700, color: COULEUR_PRIMAIRE, marginTop: 16, marginBottom: 10, paddingBottom: 4, borderBottom: "1pt solid " + COULEUR_PRIMAIRE },
  h2: { fontSize: 11, fontWeight: 700, color: COULEUR_TEXTE, marginTop: 12, marginBottom: 6 },

  twoCol: { flexDirection: "row", gap: 24, marginVertical: 4 },
  col: { flex: 1 },

  label: { fontSize: 8, color: COULEUR_GRIS, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  valeur: { fontSize: 10, fontWeight: 700, marginBottom: 7, color: COULEUR_TEXTE },

  row: { flexDirection: "row", justifyContent: "space-between", padding: 8, borderBottom: "0.5pt solid #cbd5e1" },
  rowFort: { flexDirection: "row", justifyContent: "space-between", padding: 10, backgroundColor: COULEUR_PRIMAIRE, color: "white", marginTop: 6, borderRadius: 3 },

  para: { marginVertical: 4, fontSize: 10 },
  paraGras: { fontWeight: 700 },
  encadre: { padding: 10, backgroundColor: "#f1f5f9", borderLeft: "3pt solid " + COULEUR_PRIMAIRE, marginVertical: 8 },

  puce: { flexDirection: "row", marginVertical: 4 },
  puceMarque: { width: 14, fontSize: 9, color: COULEUR_PRIMAIRE, fontWeight: 700 },
  puceTxt: { flex: 1, fontSize: 9, color: COULEUR_TEXTE, lineHeight: 1.5 },

  sigBloc: { flexDirection: "row", justifyContent: "space-between", marginTop: 40 },
  sigBox: { width: 220 },
  sigLigne: { borderTop: "1pt solid " + COULEUR_PRIMAIRE, marginTop: 40, paddingTop: 6 },
  sigNom: { fontSize: 11, fontWeight: 700, color: COULEUR_PRIMAIRE },
  sigDate: { fontSize: 9, color: COULEUR_GRIS, marginTop: 2 },
  sigTitre: { fontSize: 9, color: COULEUR_GRIS, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },

  // PIED DE PAGE
  pied: { position: "absolute", bottom: 25, left: 50, right: 50, paddingTop: 8, borderTop: "0.5pt solid #e2e8f0", flexDirection: "row", justifyContent: "space-between" },
  piedTxt: { fontSize: 7, color: COULEUR_GRIS_CLAIR },
});

// === Logo Drakkar Viking (fidèle au logo officiel : voile + tête de dragon + coque rayée) ===
const LogoSvg = ({ size = 50 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 200 200">
    {/* Drapeau au sommet */}
    <Path d="M100 25 L120 30 L100 38 Z" fill={COULEUR_PRIMAIRE} />
    {/* Mât */}
    <Path d="M100 22 L100 135" stroke={COULEUR_PRIMAIRE} strokeWidth={2.5} />
    {/* Vergue */}
    <Path d="M62 55 L138 55" stroke={COULEUR_PRIMAIRE} strokeWidth={2.5} />
    {/* Voile pleine bleu marine */}
    <Path d="M70 55 L130 55 L130 120 L70 120 Z" fill={COULEUR_PRIMAIRE} />
    {/* Cordages */}
    <Path d="M70 55 L40 115" stroke={COULEUR_PRIMAIRE} strokeWidth={1} />
    <Path d="M130 55 L160 115" stroke={COULEUR_PRIMAIRE} strokeWidth={1} />
    {/* Coque (forme drakkar) */}
    <Path d="M28 132 L35 130 L165 130 L172 132 L160 165 L150 172 L70 172 L40 165 Z" stroke={COULEUR_PRIMAIRE} strokeWidth={3} fill="none" />
    {/* Planches horizontales */}
    <Path d="M50 148 L150 148" stroke={COULEUR_PRIMAIRE} strokeWidth={1} />
    <Path d="M55 158 L145 158" stroke={COULEUR_PRIMAIRE} strokeWidth={1} />
    {/* Tête de dragon avant */}
    <Path d="M168 130 L180 128 L184 120 L188 118 L184 124 L178 131 Z" fill={COULEUR_PRIMAIRE} />
    <Path d="M186 117 L192 115 L188 122 Z" fill={COULEUR_PRIMAIRE} />
    {/* Queue arrière recourbée */}
    <Path d="M32 130 L22 128 L18 120 L14 113 L22 113 L26 124 Z" fill={COULEUR_PRIMAIRE} />
  </Svg>
);

const Logo = LogoSvg;

const cad = (n: number) => new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(n || 0);

export function ContratPDF({ c }: { c: ContratData }) {
  const depot = c.depot_pct ?? 25;
  const milieu = c.paiement_milieu_pct ?? 25;
  const sig = c.paiement_signature_pct ?? 0;
  const fin = c.paiement_fin_pct ?? Math.max(0, 100 - depot - milieu - sig);
  const montantSig = c.prix_total * (sig / 100);
  const montantDepot = c.prix_total * (depot / 100);
  const montantMilieu = c.prix_total * (milieu / 100);
  const montantFin = c.prix_total * (fin / 100);

  const adresseTravaux = c.adresse_travaux || c.client_adresse || "";
  const villeTravaux = c.ville_travaux || c.client_ville || "";

  return (
    <Document>
      {/* COUVERTURE */}
      <Page size="LETTER" style={s.pageCouv}>
        <View style={s.couvLogoBloc}>
          <Logo size={120} />
          <Text style={s.couvNomEntreprise}>REVÊTEMENT VIKING INC.</Text>
          <Text style={{ fontSize: 9, color: COULEUR_GRIS, marginTop: 3 }}>RBQ {ENTREPRISE.rbq}</Text>
        </View>
        <Text style={s.titreCouv}>Contrat de rénovation</Text>
        <Text style={s.sousTitreCouv}>résidentielle à prix fixe</Text>
        <View style={s.ligneCouv} />
        <Text style={s.introCouv}>
          La présente proposition commerciale contient tous les détails relatifs à la portée du travail, aux tarifs et aux conditions tels que demandés par :
        </Text>
        <Text style={s.nomClient}>{c.client_nom}</Text>
        <Text style={s.numContrat}>CONTRAT N° {c.numero} — DÉBUT DES TRAVAUX : {c.date_debut_travaux}</Text>
        <View style={s.pied} fixed>
          <Text style={s.piedTxt}>{ENTREPRISE.nom} · {ENTREPRISE.adresse}, {ENTREPRISE.ville} {ENTREPRISE.code_postal}</Text>
          <Text style={s.piedTxt}>{ENTREPRISE.telephone} · {ENTREPRISE.courriel}</Text>
        </View>
      </Page>

      {/* IDENTIFICATION DES PARTIES */}
      <Page size="LETTER" style={s.page}>
        <View style={s.enTete} fixed>
          <View style={s.enTeteLogo}>
            <Logo size={26} />
            <View>
              <Text style={s.enTeteTitre}>REVÊTEMENT VIKING INC.</Text>
              <Text style={s.enTeteSous}>Contrat n° {c.numero}</Text>
            </View>
          </View>
          <Text style={s.enTeteSous} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
        <Text style={s.h1}>1. Identification des parties</Text>
        <View style={s.twoCol}>
          <View style={s.col}>
            <Text style={s.label}>Entrepreneur</Text>
            <Text style={s.valeur}>{ENTREPRISE.nom}</Text>
            <Text style={s.label}>Adresse de l'entreprise</Text>
            <Text style={s.valeur}>{ENTREPRISE.adresse}</Text>
            <Text style={s.label}>Province et pays</Text>
            <Text style={s.valeur}>{ENTREPRISE.province}</Text>
            <Text style={s.label}>Téléphone</Text>
            <Text style={s.valeur}>{ENTREPRISE.telephone}</Text>
            <Text style={s.label}>No de TPS</Text>
            <Text style={s.valeur}>{ENTREPRISE.tps}</Text>
            <Text style={s.label}>No de TVQ</Text>
            <Text style={s.valeur}>{ENTREPRISE.tvq}</Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>Nom du chargé du projet</Text>
            <Text style={s.valeur}>{c.charge_projet}</Text>
            <Text style={s.label}>Ville</Text>
            <Text style={s.valeur}>{ENTREPRISE.ville}</Text>
            <Text style={s.label}>Code postal</Text>
            <Text style={s.valeur}>{ENTREPRISE.code_postal}</Text>
            <Text style={s.label}>Courriel</Text>
            <Text style={s.valeur}>{ENTREPRISE.courriel}</Text>
            <Text style={s.label}>No licence de RBQ</Text>
            <Text style={s.valeur}>{ENTREPRISE.rbq}</Text>
          </View>
        </View>

        <Text style={s.h2}>Client(s)</Text>
        <View style={s.twoCol}>
          <View style={s.col}>
            <Text style={s.label}>Client</Text>
            <Text style={s.valeur}>{c.client_nom}</Text>
            <Text style={s.label}>Propriétaire</Text>
            <Text style={s.valeur}>{c.proprietaire || c.client_nom}</Text>
            <Text style={s.label}>Adresse du client</Text>
            <Text style={s.valeur}>{c.client_adresse || "—"}</Text>
            <Text style={s.label}>Province et pays</Text>
            <Text style={s.valeur}>{c.client_province || "Québec, Canada"}</Text>
            <Text style={s.label}>Téléphone</Text>
            <Text style={s.valeur}>{c.client_telephone || "—"}</Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>Locataire</Text>
            <Text style={s.valeur}>{c.locataire || "—"}</Text>
            <Text style={s.label}>Ville</Text>
            <Text style={s.valeur}>{c.client_ville || "—"}</Text>
            <Text style={s.label}>Code postal</Text>
            <Text style={s.valeur}>{c.client_code_postal || "—"}</Text>
            <Text style={s.label}>Courriel</Text>
            <Text style={s.valeur}>{c.client_courriel || "—"}</Text>
          </View>
        </View>

        {(adresseTravaux && adresseTravaux !== c.client_adresse) && (
          <>
            <Text style={s.h2}>Adresse de la propriété où sont effectués les travaux</Text>
            <View style={s.twoCol}>
              <View style={s.col}>
                <Text style={s.label}>Adresse</Text>
                <Text style={s.valeur}>{adresseTravaux}</Text>
                <Text style={s.label}>Code postal</Text>
                <Text style={s.valeur}>{c.code_postal_travaux || "—"}</Text>
              </View>
              <View style={s.col}>
                <Text style={s.label}>Ville</Text>
                <Text style={s.valeur}>{villeTravaux}</Text>
                <Text style={s.label}>Province et pays</Text>
                <Text style={s.valeur}>{c.province_travaux || "Québec, Canada"}</Text>
              </View>
            </View>
          </>
        )}
        <View style={s.pied} fixed>
          <Text style={s.piedTxt}>{ENTREPRISE.nom} · RBQ {ENTREPRISE.rbq} · {ENTREPRISE.courriel}</Text>
          <Text style={s.piedTxt}>{ENTREPRISE.telephone}</Text>
        </View>
      </Page>

      {/* DESCRIPTION + PAIEMENT + ASSURANCES */}
      <Page size="LETTER" style={s.page}>
        <View style={s.enTete} fixed>
          <View style={s.enTeteLogo}>
            <Logo size={26} />
            <View>
              <Text style={s.enTeteTitre}>REVÊTEMENT VIKING INC.</Text>
              <Text style={s.enTeteSous}>Contrat n° {c.numero}</Text>
            </View>
          </View>
          <Text style={s.enTeteSous} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
        <Text style={s.h1}>2. Description des travaux</Text>
        {c.soumission_numero && (
          <Text style={s.para}>Se référer au devis <Text style={{ fontWeight: 700 }}>{c.soumission_numero}</Text>{c.soumission_date ? ` du ${c.soumission_date}` : ""}.</Text>
        )}
        <Text style={s.para}>Les travaux débuteront le <Text style={{ fontWeight: 700 }}>{c.date_debut_travaux}</Text>.</Text>
        <Text style={s.para}>Le client doit s'assurer d'obtenir les permis de rénovation auprès de sa municipalité.</Text>
        {c.notes_travaux && <Text style={[s.para, { marginTop: 8 }]}>{c.notes_travaux}</Text>}

        <Text style={s.h1}>3. Modalité de paiement</Text>
        <Text style={[s.para, { fontStyle: "italic", color: "#475569", marginBottom: 8 }]}>
          Prière d'effectuer les paiements par VIREMENT INTERAC à l'adresse courriel suivante : {ENTREPRISE.courriel}
        </Text>
        {sig > 0 && (
          <View style={s.row}><Text>À l'envoi du contrat ({sig}%)</Text><Text style={{ fontWeight: 700 }}>{cad(montantSig)}</Text></View>
        )}
        <View style={s.row}><Text>À la signature du contrat — Dépôt ({depot}%)</Text><Text style={{ fontWeight: 700 }}>{cad(montantDepot)}</Text></View>
        <View style={s.row}><Text>Après la 1re semaine des travaux ({milieu}%)</Text><Text style={{ fontWeight: 700 }}>{cad(montantMilieu)}</Text></View>
        <View style={s.row}><Text>À la fin des travaux — Balance ({fin}%)</Text><Text style={{ fontWeight: 700 }}>{cad(montantFin)}</Text></View>
        <View style={s.rowFort}><Text>Total du contrat</Text><Text>{cad(c.prix_total)}</Text></View>

        <Text style={s.h1}>4. Assurances</Text>
        <View style={s.twoCol}>
          <View style={s.col}>
            <Text style={s.label}>Nom de la compagnie d'assurance</Text>
            <Text style={s.valeur}>{ASSURANCE.compagnie}</Text>
          </View>
          <View style={s.col}>
            <Text style={s.label}>N° de police</Text>
            <Text style={s.valeur}>{ASSURANCE.police}</Text>
          </View>
        </View>
        <View style={s.pied} fixed>
          <Text style={s.piedTxt}>{ENTREPRISE.nom} · RBQ {ENTREPRISE.rbq} · {ENTREPRISE.courriel}</Text>
          <Text style={s.piedTxt}>{ENTREPRISE.telephone}</Text>
        </View>
      </Page>

      {/* RESPONSABILITÉS */}
      <Page size="LETTER" style={s.page}>
        <View style={s.enTete} fixed>
          <View style={s.enTeteLogo}>
            <Logo size={26} />
            <View>
              <Text style={s.enTeteTitre}>REVÊTEMENT VIKING INC.</Text>
              <Text style={s.enTeteSous}>Contrat n° {c.numero}</Text>
            </View>
          </View>
          <Text style={s.enTeteSous} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
        <Text style={s.h1}>5. Responsabilités des clients</Text>
        {[
          "Toutes modifications au plan après signature de ce contrat seront considérées comme des extras et chargées en extra.",
          "Le client est responsable d'obtenir le permis nécessaire pour la réalisation des travaux.",
          "En aucun temps, il y aura des demandes faites directement aux employés ou sous-traitants.",
          "Tout problème non visible lors de la soumission sera un ajout.",
          "L'entrepreneur n'est pas responsable de déménager les meubles ou électroménagers.",
          "Le prix des travaux de peinture inclut deux couches de finition. Dans le cas d'un nouveau mur, le prix inclut une couche d'apprêt (primer) et deux couches de finition. Toutes couches additionnelles seront ajoutées au prix du contrat.",
          "L'entrepreneur ne sera pas responsable du retard dans l'exécution des travaux si ce retard provient du défaut du client de remplir ses obligations en vertu du contrat ou d'une force majeure (accident inévitable, guerre, pandémie, inondation, feu, grève, défaut de fournisseur, etc.).",
          "Dans l'éventualité où des augmentations imprévisibles du prix des matériaux auraient pour effet d'augmenter les coûts de construction avant la date de fin, l'entrepreneur aura le droit, en justifiant telle augmentation auprès du client, de réviser à la hausse le prix du contrat.",
          "Le prix de la démolition inclut une seule couche de revêtement. Les murs avec lattes de bois ou en béton sont considérés comme un extra.",
          "Les frais de résiliation sont de 25 % du prix du contrat. Aucun remboursement sur les matériaux sur mesure (fenêtres, etc.) ou sur les matériaux déjà commandés.",
        ].map((txt, i) => (
          <View key={i} style={s.puce}>
            <Text style={s.puceMarque}>•</Text>
            <Text style={s.puceTxt}>{txt}</Text>
          </View>
        ))}
        <View style={s.pied} fixed>
          <Text style={s.piedTxt}>{ENTREPRISE.nom} · RBQ {ENTREPRISE.rbq} · {ENTREPRISE.courriel}</Text>
          <Text style={s.piedTxt}>{ENTREPRISE.telephone}</Text>
        </View>
      </Page>

      {/* SIGNATURES */}
      <Page size="LETTER" style={s.page}>
        <View style={s.enTete} fixed>
          <View style={s.enTeteLogo}>
            <Logo size={26} />
            <View>
              <Text style={s.enTeteTitre}>REVÊTEMENT VIKING INC.</Text>
              <Text style={s.enTeteSous}>Contrat n° {c.numero}</Text>
            </View>
          </View>
          <Text style={s.enTeteSous} render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
        <Text style={s.h1}>6. Signatures</Text>
        <Text style={s.para}>
          Votre signature ci-dessous indique que vous acceptez la présente proposition de gestion de projet et que vous concluez un accord contractuel avec {ENTREPRISE.nom} à compter de la date de signature ci-dessous.
        </Text>

        <View style={s.sigBloc}>
          <View style={s.sigBox}>
            <Text style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>Pour l'entrepreneur</Text>
            <View style={s.sigLigne}>
              <Text style={s.sigNom}>{c.signature_entrepreneur?.nom || c.charge_projet}</Text>
              <Text style={s.sigDate}>{c.signature_entrepreneur?.date || "Date : ____ / ____ / ________"}</Text>
              <Text style={{ fontSize: 8, color: "#94a3b8", marginTop: 2 }}>{ENTREPRISE.nom}</Text>
            </View>
          </View>
          <View style={s.sigBox}>
            <Text style={{ fontSize: 10, color: "#64748b", marginBottom: 4 }}>Pour le client</Text>
            {c.signature_client_image && (
              <Image src={c.signature_client_image} style={{ width: 200, height: 60, marginBottom: -20, alignSelf: "flex-start" }} />
            )}
            <View style={s.sigLigne}>
              <Text style={s.sigNom}>{c.signature_client?.nom || c.client_nom}</Text>
              <Text style={s.sigDate}>{c.signature_client?.date || "Date : ____ / ____ / ________"}</Text>
            </View>
          </View>
        </View>

        <View style={s.pied} fixed>
          <Text style={s.piedTxt}>{ENTREPRISE.nom} · RBQ {ENTREPRISE.rbq} · TPS {ENTREPRISE.tps} · TVQ {ENTREPRISE.tvq}</Text>
          <Text style={s.piedTxt}>{ENTREPRISE.courriel} · {ENTREPRISE.telephone}</Text>
        </View>
      </Page>
    </Document>
  );
}

/** Accepte la nouvelle forme ContratData OU l'ancienne (champs DB :
 *  montant_total, date_emission, titre, etc.). Mappe vers ContratData. */
export async function genererContratBlob(brut: any): Promise<Blob> {
  const c: ContratData = {
    numero: brut.numero || brut.id ? String(brut.numero || brut.id) : "",
    charge_projet: brut.charge_projet || brut.responsable || "Francis Quinchon",
    client_nom: brut.client_nom || brut.titre || "—",
    client_adresse: brut.client_adresse,
    client_ville: brut.client_ville,
    client_province: brut.client_province,
    client_code_postal: brut.client_code_postal,
    client_telephone: brut.client_telephone,
    client_courriel: brut.client_courriel,
    proprietaire: brut.proprietaire,
    locataire: brut.locataire,
    adresse_travaux: brut.adresse_travaux || brut.adresse_chantier,
    ville_travaux: brut.ville_travaux,
    code_postal_travaux: brut.code_postal_travaux,
    province_travaux: brut.province_travaux,
    soumission_numero: brut.soumission_numero,
    soumission_date: brut.soumission_date,
    date_debut_travaux: brut.date_debut_travaux || brut.date_emission || new Date().toISOString().slice(0, 10),
    prix_total: brut.prix_total ?? brut.montant_total ?? brut.montant_avant_taxes ?? 0,
    depot_pct: brut.depot_pct,
    paiement_milieu_pct: brut.paiement_milieu_pct,
    paiement_fin_pct: brut.paiement_fin_pct,
    paiement_signature_pct: brut.paiement_signature_pct,
    notes_travaux: brut.notes_travaux || brut.description_travaux || brut.conditions,
    signature_entrepreneur: brut.signature_entrepreneur,
    signature_client: brut.signature_client,
    signature_client_image: brut.signature_client_image,
  };
  return await pdf(<ContratPDF c={c} />).toBlob();
}

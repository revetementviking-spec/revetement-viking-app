/**
 * Nouveautés de l'app — ce que la bannière du tableau de bord annonce à tout le monde.
 *
 * RÈGLE DE LIVRAISON : à chaque changement visible par les utilisateurs, ajouter une entrée
 * EN TÊTE de la liste (la plus récente en premier). La bannière montre à chaque personne
 * les entrées qu'elle n'a pas encore vues, pendant CONNEXIONS_AFFICHAGE connexions, puis
 * s'efface d'elle-même. Fermer la bannière = tout marquer comme vu.
 *
 * - `version` : la date de livraison (AAAA-MM-JJ). Un seul bloc par jour : si on livre deux
 *   fois le même jour, on complète le bloc existant.
 * - `points` : phrases courtes, du point de vue de l'utilisateur (« vous pouvez… »), pas du code.
 */
export type Nouveaute = {
  version: string;
  titre: string;
  points: string[];
};

/** Nombre de connexions pendant lesquelles une nouveauté reste affichée. */
export const CONNEXIONS_AFFICHAGE = 3;

/** Nombre maximal de blocs montrés d'un coup (au-delà, on n'annonce que les plus récents). */
export const MAX_BLOCS = 3;

export const NOUVEAUTES: Nouveaute[] = [
  {
    version: "2026-09-07",
    titre: "Paie : le bandeau d'heures dues ne compte plus la banque",
    points: [
      "Le bandeau « heures travaillées qui ne sont dans aucune paye » réclamait le surplus au-delà de 80 h, alors que ces heures sont déjà à votre crédit dans la banque d'heures juste au-dessus. Elles n'y apparaissent plus.",
      "Le bandeau garde son vrai rôle : signaler une feuille de temps saisie APRÈS qu'une période a été marquée payée — là, il s'agit bien d'argent dû.",
    ],
  },
  {
    version: "2026-09-05",
    titre: "Nouveautés visibles, fichiers joints et mise à jour automatique",
    points: [
      "Cette carte : à chaque livraison, le tableau de bord montre ce qui a changé, pendant 3 connexions.",
      "Fichiers joints (PDF, contrat signé, spécimen, devis, documents) : la limite est de 3 Mo partout, et le message le dit clairement au lieu d'une « erreur 413 ».",
      "Après une livraison, l'app se met à jour dès qu'on change d'onglet — plus besoin de recharger la page pour voir la dernière version.",
    ],
  },
  {
    version: "2026-09-04",
    titre: "Fiche projet, saisie d'heures et téléphone",
    points: [
      "Fiche projet : les notes de chantier ont leur propre onglet, à côté des heures, dépenses, extras, documents et photos.",
      "Nouvel onglet Documents dans la fiche projet : permis, plans, garanties, rapports.",
      "Saisie d'heures : les chantiers en cours sont proposés en premier, puis ceux à venir, puis les complétés.",
      "Un chantier terminé accepte encore les heures, les photos et la description pendant 14 jours, comme les dépenses.",
      "Quand un chantier est marqué complété, un rappel de facturation part par courriel à revetementviking@gmail.com.",
      "Quand un client accepte ou refuse une soumission en ligne, un avis arrive par courriel.",
      "Nouveau projet ou nouvelle soumission : la fiche client se crée au passage.",
      "Les montants acceptent la virgule (12 500,50 $) et un double clic n'enregistre plus deux fois.",
      "Sur téléphone : boutons plus faciles à toucher, plus de zoom involontaire en tapant dans un champ.",
      "La page de paie s'ouvre beaucoup plus vite, et toute erreur d'enregistrement est signalée à l'écran.",
    ],
  },
  {
    version: "2026-06-03",
    titre: "Saisie d'heures améliorée",
    points: [
      "La description se tape en paragraphe.",
      "Le projet en cours est proposé automatiquement.",
      "L'app est plus rapide.",
    ],
  },
];

/** Version la plus récente (vide si la liste est vide). */
export function derniereVersion(liste: Nouveaute[] = NOUVEAUTES): string {
  return liste[0]?.version ?? "";
}

/**
 * Blocs plus récents que `versionVue` (la dernière version que la personne a vue, ou null
 * si elle n'a jamais rien vu). Les versions sont des dates ISO : la comparaison de chaînes
 * suffit. Limité aux MAX_BLOCS plus récents.
 */
export function nouveautesNonVues(versionVue: string | null | undefined, liste: Nouveaute[] = NOUVEAUTES): Nouveaute[] {
  const vue = versionVue || "";
  return liste.filter((n) => n.version > vue).slice(0, MAX_BLOCS);
}

/** Une nouveauté reste affichée tant que le nombre de connexions ne dépasse pas la limite. */
export function encoreAffichable(connexions: number): boolean {
  return connexions >= 1 && connexions <= CONNEXIONS_AFFICHAGE;
}

/** Date lisible « 4 septembre 2026 » à partir d'une version AAAA-MM-JJ. */
export function dateLisible(version: string): string {
  const [a, m, j] = version.split("-").map(Number);
  if (!a || !m || !j) return version;
  return new Date(a, m - 1, j).toLocaleDateString("fr-CA", { day: "numeric", month: "long", year: "numeric" });
}

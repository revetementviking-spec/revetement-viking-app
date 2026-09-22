import { describe, it, expect } from "vitest";
import { estProjetActif, accepteSaisieTardive, JOURS_GRACE_SAISIE, STATUTS_PROJET, rangProjet, trierProjetsPourSaisie, transitionPermise, estReouverture } from "./statuts-projet";

describe("transitionPermise (table des changements de statut)", () => {
  it("annulé ne revient qu'à « à venir » ou « actif »", () => {
    expect(transitionPermise("annule", "a_venir")).toBe(true);
    expect(transitionPermise("annule", "actif")).toBe(true);
    for (const v of ["en_cours", "en_pause", "complete"]) expect(transitionPermise("annule", v)).toBe(false);
  });

  it("complété ne se rouvre qu'en « en_cours » ou « actif » — jamais annulé ni à venir", () => {
    expect(transitionPermise("complete", "en_cours")).toBe(true);
    expect(transitionPermise("complete", "actif")).toBe(true);
    expect(transitionPermise("complete", "annule")).toBe(false);
    expect(transitionPermise("complete", "a_venir")).toBe(false);
    expect(transitionPermise("complete", "en_pause")).toBe(false);
  });

  it("l'ordre naturel passe : à venir → actif → en pause → en cours → complété", () => {
    expect(transitionPermise("a_venir", "actif")).toBe(true);
    expect(transitionPermise("actif", "en_pause")).toBe(true);
    expect(transitionPermise("en_pause", "en_cours")).toBe(true);
    expect(transitionPermise("en_cours", "complete")).toBe(true);
  });

  it("un chantier vivant peut être annulé, un « à venir » ne peut pas être complété d'un coup", () => {
    for (const d of ["a_venir", "actif", "en_cours", "en_pause"]) expect(transitionPermise(d, "annule")).toBe(true);
    expect(transitionPermise("a_venir", "complete")).toBe(false);
  });

  it("même statut = permis ; statut cible inconnu = refusé ; origine inconnue = permis", () => {
    expect(transitionPermise("actif", "actif")).toBe(true);
    expect(transitionPermise("actif", "zzz")).toBe(false);
    expect(transitionPermise(null, "complete")).toBe(true);
    expect(transitionPermise("bidon", "complete")).toBe(true);
  });

  it("estReouverture ne vise que complété → en activité", () => {
    expect(estReouverture("complete", "en_cours")).toBe(true);
    expect(estReouverture("complete", "actif")).toBe(true);
    expect(estReouverture("en_pause", "actif")).toBe(false);
    expect(estReouverture("complete", "a_venir")).toBe(false);
  });
});

describe("estProjetActif", () => {
  it("couvre les DEUX statuts d'activité", () => {
    expect(estProjetActif("actif")).toBe(true);
    expect(estProjetActif("en_cours")).toBe(true);
  });

  it("écarte les autres", () => {
    for (const s of ["a_venir", "en_pause", "complete", "annule", "", null, undefined]) {
      expect(estProjetActif(s as any)).toBe(false);
    }
  });
});

describe("ordre des chantiers dans un sélecteur de saisie", () => {
  it("en cours d'abord, puis à venir, puis en pause, complétés en dernier", () => {
    expect(rangProjet("actif")).toBeLessThan(rangProjet("a_venir"));
    expect(rangProjet("en_cours")).toBeLessThan(rangProjet("a_venir"));
    expect(rangProjet("a_venir")).toBeLessThan(rangProjet("en_pause"));
    expect(rangProjet("en_pause")).toBeLessThan(rangProjet("complete"));
  });

  it("les deux statuts d'activité sont à égalité, tout en haut", () => {
    expect(rangProjet("actif")).toBe(rangProjet("en_cours"));
  });

  it("trie une liste mélangée dans l'ordre voulu", () => {
    const melange = [
      { id: 1, statut: "complete" },
      { id: 2, statut: "a_venir" },
      { id: 3, statut: "actif" },
      { id: 4, statut: "en_pause" },
      { id: 5, statut: "en_cours" },
    ];
    expect(trierProjetsPourSaisie(melange).map((p) => p.id)).toEqual([3, 5, 2, 4, 1]);
  });

  it("à rang égal, garde l'ordre reçu (le plus récent d'abord)", () => {
    const l = [{ id: 10, statut: "actif" }, { id: 11, statut: "en_cours" }, { id: 12, statut: "actif" }];
    expect(trierProjetsPourSaisie(l).map((p) => p.id)).toEqual([10, 11, 12]);
  });

  it("ne modifie pas le tableau d'origine", () => {
    const l = [{ id: 1, statut: "complete" }, { id: 2, statut: "actif" }];
    trierProjetsPourSaisie(l);
    expect(l.map((p) => p.id)).toEqual([1, 2]);
  });

  it("un statut inattendu passe avant les complétés, jamais avant les chantiers actifs", () => {
    expect(rangProjet("zzz")).toBeGreaterThan(rangProjet("actif"));
    expect(rangProjet(undefined)).toBeLessThan(rangProjet("complete"));
  });
});

describe("accepteSaisieTardive (dépenses ET heures — même règle)", () => {
  const LE_15_AOUT = new Date("2026-08-15T12:00:00Z").getTime();
  const jours = (n: number) => new Date(LE_15_AOUT - n * 86400000).toISOString().slice(0, 10);

  it("un chantier annulé n'accepte jamais rien", () => {
    expect(accepteSaisieTardive({ statut: "annule" }, LE_15_AOUT)).toBe(false);
    // même tout juste terminé : le refus d'un chantier annulé prime.
    expect(accepteSaisieTardive({ statut: "annule", date_fin_reelle: jours(0) }, LE_15_AOUT)).toBe(false);
  });

  it("tout chantier non complété accepte la saisie", () => {
    for (const s of STATUTS_PROJET.filter((x) => x !== "complete" && x !== "annule")) {
      expect(accepteSaisieTardive({ statut: s }, LE_15_AOUT)).toBe(true);
    }
  });

  it("un chantier complété reste saisissable pendant le délai de grâce", () => {
    expect(accepteSaisieTardive({ statut: "complete", date_fin_reelle: jours(0) }, LE_15_AOUT)).toBe(true);
    expect(accepteSaisieTardive({ statut: "complete", date_fin_reelle: jours(13) }, LE_15_AOUT)).toBe(true);
  });

  it("la borne des 14 jours est inclusive", () => {
    // Horodatage complet : sans ambiguïté sur l'heure.
    const finExacte = new Date(LE_15_AOUT - JOURS_GRACE_SAISIE * 86400000).toISOString();
    expect(accepteSaisieTardive({ statut: "complete", date_fin_reelle: finExacte }, LE_15_AOUT)).toBe(true);
    const uneSeconde = new Date(LE_15_AOUT - JOURS_GRACE_SAISIE * 86400000 - 1000).toISOString();
    expect(accepteSaisieTardive({ statut: "complete", date_fin_reelle: uneSeconde }, LE_15_AOUT)).toBe(false);
  });

  it("une date sans heure est lue à minuit UTC — le 14e jour bascule en soirée", () => {
    // `date_fin_reelle` est une date nue (« 2026-08-01 »), lue comme minuit UTC, soit
    // 20 h la veille à Montréal. Le 14e jour n'est donc couvert que jusqu'en fin de
    // journée. Écart de quelques heures, sans conséquence pratique — mais mesuré ici
    // pour que personne ne s'étonne d'un chantier qui disparaît « un jour trop tôt ».
    const minuitUTC = new Date("2026-08-15T00:00:00Z").getTime();
    expect(accepteSaisieTardive({ statut: "complete", date_fin_reelle: jours(14) }, minuitUTC)).toBe(true);
    expect(accepteSaisieTardive({ statut: "complete", date_fin_reelle: jours(14) }, LE_15_AOUT)).toBe(false);
  });

  it("passé le délai, il sort des menus", () => {
    expect(accepteSaisieTardive({ statut: "complete", date_fin_reelle: jours(15) }, LE_15_AOUT)).toBe(false);
    expect(accepteSaisieTardive({ statut: "complete", date_fin_reelle: jours(90) }, LE_15_AOUT)).toBe(false);
  });

  it("la date RÉELLE prime sur la date prévue", () => {
    // Fin prévue vieille de 3 mois, mais le chantier a réellement fermé hier.
    expect(accepteSaisieTardive(
      { statut: "complete", date_fin_reelle: jours(1), date_fin_prevue: jours(90) },
      LE_15_AOUT,
    )).toBe(true);
  });

  it("retombe sur la date prévue quand la réelle manque", () => {
    expect(accepteSaisieTardive({ statut: "complete", date_fin_prevue: jours(2) }, LE_15_AOUT)).toBe(true);
    expect(accepteSaisieTardive({ statut: "complete", date_fin_prevue: jours(30) }, LE_15_AOUT)).toBe(false);
  });

  it("sans date exploitable, le chantier complété sort des menus", () => {
    expect(accepteSaisieTardive({ statut: "complete" }, LE_15_AOUT)).toBe(false);
    expect(accepteSaisieTardive({ statut: "complete", date_fin_reelle: null }, LE_15_AOUT)).toBe(false);
    expect(accepteSaisieTardive({ statut: "complete", date_fin_reelle: "pas une date" }, LE_15_AOUT)).toBe(false);
  });
});

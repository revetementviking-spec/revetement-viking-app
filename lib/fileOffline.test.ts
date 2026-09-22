import { describe, it, expect, beforeEach, vi } from "vitest";

// localStorage minimal : le module cible tourne dans le navigateur, les tests en Node.
function installerStockage(opts: { quota?: number } = {}) {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => {
      if (opts.quota !== undefined && v.length > opts.quota) throw new Error("QuotaExceededError");
      mem.set(k, v);
    },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
  return mem;
}

async function chargerModule() {
  vi.resetModules();
  return await import("./fileOffline");
}

const reseauCoupe = () => { (globalThis as any).fetch = vi.fn().mockRejectedValue(new Error("network")); };
const reponse = (status: number, corps: any = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => corps });
const cleEnvoyee = (appel: any[]) => appel[1]?.headers?.["X-Idempotence-Cle"] as string | undefined;

describe("postOuFile", () => {
  beforeEach(() => { installerStockage(); });

  it("envoie une clé d'idempotence dès le PREMIER essai (≤ 64 caractères)", async () => {
    const m = await chargerModule();
    const f = vi.fn().mockResolvedValue(reponse(200, { ok: true }));
    (globalThis as any).fetch = f;
    await m.postOuFile("/api/heures", { heures: 8 });
    const cle = cleEnvoyee(f.mock.calls[0]);
    expect(cle).toBeTruthy();
    expect(cle!.length).toBeLessThanOrEqual(64);
    expect(f.mock.calls[0][1].headers["Content-Type"]).toBe("application/json");
  });

  it("file la saisie quand le réseau est coupé, avec la MÊME clé qu'au premier essai", async () => {
    const m = await chargerModule();
    const f = vi.fn().mockRejectedValue(new Error("network"));
    (globalThis as any).fetch = f;
    const r = await m.postOuFile("/api/heures", { heures: 8 });
    expect(r).toMatchObject({ ok: true, offline: true });
    expect(m.nbActionsEnAttente()).toBe(1);
    const clePremierEssai = cleEnvoyee(f.mock.calls[0]);

    // Rejeu : le serveur doit recevoir la même clé, sinon il ne peut pas reconnaître
    // une requête qui lui est en fait déjà arrivée.
    const g = vi.fn().mockResolvedValue(reponse(200, { ok: true }));
    (globalThis as any).fetch = g;
    await m.viderFile();
    expect(cleEnvoyee(g.mock.calls[0])).toBe(clePremierEssai);
  });

  it("ne file PAS et signale l'échec quand le serveur refuse", async () => {
    const m = await chargerModule();
    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(400, { error: "date invalide" }));
    const r = await m.postOuFile("/api/heures", { heures: 8 });
    expect(r.ok).toBe(false);
    expect(r.erreur).toBe("date invalide");
    expect(m.nbActionsEnAttente()).toBe(0);
  });

  it("stockage plein hors ligne : dit la vérité (ok: false) au lieu d'annoncer une sauvegarde", async () => {
    installerStockage({ quota: 10 });
    const m = await chargerModule();
    reseauCoupe();
    const r = await m.postOuFile("/api/depenses", { montant: 125, recu_data: "x".repeat(100) });
    expect(r.ok).toBe(false);
    expect(r.offline).toBeUndefined();
    expect(r.erreur).toMatch(/stockage plein/);
  });

  it("mémorise l'utilisateur connecté au moment de la mise en file", async () => {
    const m = await chargerModule();
    m.memoriserUtilisateur("Gabriel");
    reseauCoupe();
    await m.postOuFile("/api/heures", { heures: 8 });
    const file = JSON.parse(localStorage.getItem("vk-file-offline-v1")!);
    expect(file[0].utilisateur).toBe("Gabriel");
  });
});

describe("viderFile", () => {
  beforeEach(() => { installerStockage(); });

  it("envoie les saisies en attente et vide la file", async () => {
    const m = await chargerModule();
    reseauCoupe();
    await m.postOuFile("/api/heures", { heures: 8 });
    await m.postOuFile("/api/depenses", { montant: 120 });
    expect(m.nbActionsEnAttente()).toBe(2);

    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(200, { ok: true }));
    const r = await m.viderFile();
    expect(r).toMatchObject({ envoyees: 2, restantes: 0, abandonnees: 0 });
    expect(m.nbActionsEnAttente()).toBe(0);
  });

  it("ne retire une saisie qu'APRÈS son 2xx : la suivante reste si le réseau retombe", async () => {
    const m = await chargerModule();
    reseauCoupe();
    await m.postOuFile("/api/heures", { heures: 8 });
    await m.postOuFile("/api/depenses", { montant: 120 });

    let n = 0;
    (globalThis as any).fetch = vi.fn().mockImplementation(async () => {
      n++;
      if (n === 1) return reponse(200, { ok: true });
      // Après le premier envoi, la file sur disque ne contient DÉJÀ plus que la 2e saisie.
      expect(m.nbActionsEnAttente()).toBe(1);
      throw new Error("network");
    });
    const r = await m.viderFile();
    expect(r).toMatchObject({ envoyees: 1, restantes: 1, abandonnees: 0 });
    const file = JSON.parse(localStorage.getItem("vk-file-offline-v1")!);
    expect(file.map((a: any) => a.url)).toEqual(["/api/depenses"]);
    expect(file[0].essais).toBe(1);
  });

  it("une saisie filée PENDANT l'envoi n'est pas écrasée par la réécriture", async () => {
    const m = await chargerModule();
    reseauCoupe();
    await m.postOuFile("/api/heures", { heures: 8 });
    (globalThis as any).fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === "/api/heures") {
        // Pendant l'envoi de la première, une autre saisie arrive hors ligne.
        const f = JSON.parse(localStorage.getItem("vk-file-offline-v1")!);
        f.push({ url: "/api/extras", body: {}, method: "POST", id: "nouvelle", date: "", essais: 0 });
        localStorage.setItem("vk-file-offline-v1", JSON.stringify(f));
        return reponse(200, { ok: true });
      }
      throw new Error("network");
    });
    await m.viderFile();
    const file = JSON.parse(localStorage.getItem("vk-file-offline-v1")!);
    expect(file.map((a: any) => a.url)).toEqual(["/api/extras"]);
  });

  it.each([400, 404, 409, 413, 422])("abandonne un refus définitif (%i) dans la liste consultable, avec un contenu lisible", async (status) => {
    const m = await chargerModule();
    reseauCoupe();
    await m.postOuFile("/api/depenses", { montant: 125, date: "2026-09-20", fournisseur: "Gentek" });

    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(status, { error: "refusé" }));
    const r = await m.viderFile();
    expect(r).toMatchObject({ envoyees: 0, restantes: 0, abandonnees: 1 });
    expect(m.nbActionsEnAttente()).toBe(0);
    const abandons = m.listerAbandons();
    expect(abandons).toHaveLength(1);
    expect(abandons[0].resume).toMatch(/^Dépense 125,00\s\$ du 2026-09-20 \(Gentek\)$/);
    expect(abandons[0].raison).toBe(`HTTP ${status} : refusé`);
    expect(r.abandons[0].resume).toBe(abandons[0].resume);
    // Le contenu complet est gardé : la saisie peut être refaite sans la retaper de tête.
    expect(abandons[0].body.montant).toBe(125);
  });

  it.each([401, 408, 429, 500, 503])("n'abandonne JAMAIS sur %i, même après 30 essais", async (status) => {
    const m = await chargerModule();
    reseauCoupe();
    await m.postOuFile("/api/heures", { heures: 8 });

    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(status, {}));
    for (let i = 0; i < 30; i++) await m.viderFile();
    expect(m.nbActionsEnAttente()).toBe(1);
    expect(m.listerAbandons()).toHaveLength(0);
    const file = JSON.parse(localStorage.getItem("vk-file-offline-v1")!);
    expect(file[0].essais).toBe(30);
  });

  it("n'abandonne jamais sur erreur réseau", async () => {
    const m = await chargerModule();
    reseauCoupe();
    await m.postOuFile("/api/heures", { heures: 8 });
    for (let i = 0; i < 30; i++) await m.viderFile();
    expect(m.nbActionsEnAttente()).toBe(1);
    expect(m.listerAbandons()).toHaveLength(0);
  });

  it("refuse de rejouer la saisie d'un AUTRE utilisateur : elle va dans les abandons", async () => {
    const m = await chargerModule();
    m.memoriserUtilisateur("Gabriel");
    reseauCoupe();
    await m.postOuFile("/api/heures", { heures: 8, date: "2026-09-20", employe: "Gabriel" });

    m.memoriserUtilisateur("Francis");
    const f = vi.fn().mockResolvedValue(reponse(200, { ok: true }));
    (globalThis as any).fetch = f;
    const r = await m.viderFile();
    expect(f).not.toHaveBeenCalled();
    expect(r.abandonnees).toBe(1);
    expect(m.nbActionsEnAttente()).toBe(0);
    expect(m.listerAbandons()[0].raison).toMatch(/Gabriel.*Francis/);
    expect(m.listerAbandons()[0].resume).toMatch(/^Heures 8 h du 2026-09-20 \(Gabriel\)$/);
  });

  it("utilisateur pas encore connu : la saisie attend en file, sans envoi ni abandon", async () => {
    const m = await chargerModule();
    m.memoriserUtilisateur("Gabriel");
    reseauCoupe();
    await m.postOuFile("/api/heures", { heures: 8 });
    m.memoriserUtilisateur(null);
    const f = vi.fn().mockResolvedValue(reponse(200, { ok: true }));
    (globalThis as any).fetch = f;
    const r = await m.viderFile();
    expect(f).not.toHaveBeenCalled();
    expect(r).toMatchObject({ envoyees: 0, restantes: 1, abandonnees: 0 });
  });

  it("deux vidages simultanés n'envoient PAS la saisie deux fois", async () => {
    const m = await chargerModule();
    reseauCoupe();
    await m.postOuFile("/api/heures", { heures: 8 });

    let appels = 0;
    (globalThis as any).fetch = vi.fn().mockImplementation(async () => {
      appels++;
      await new Promise((r) => setTimeout(r, 20));
      return reponse(200, { ok: true });
    });
    // C'est le scénario réel : l'événement « online » et la minuterie partent ensemble.
    const [a, b] = await Promise.all([m.viderFile(), m.viderFile()]);
    expect(appels).toBe(1);
    expect(a.envoyees + b.envoyees).toBe(1);
    expect(m.nbActionsEnAttente()).toBe(0);
  });

  it("viderFileSansEnvoyer (déconnexion) jette la file sans rien poster", async () => {
    const m = await chargerModule();
    reseauCoupe();
    await m.postOuFile("/api/heures", { heures: 8 });
    m.viderFileSansEnvoyer();
    expect(m.nbActionsEnAttente()).toBe(0);
  });
});

describe("decrireAction", () => {
  beforeEach(() => { installerStockage(); });

  it("décrit chaque type de saisie de façon lisible", async () => {
    const m = await chargerModule();
    expect(m.decrireAction({ url: "/api/depenses", body: { montant: 1250.5, date: "2026-09-20" } })).toMatch(/^Dépense 1\s250,50\s\$ du 2026-09-20$/);
    expect(m.decrireAction({ url: "/api/heures", body: { heures: 7.5, date: "2026-09-20", employe: "Gabriel" } })).toBe("Heures 7,5 h du 2026-09-20 (Gabriel)");
    expect(m.decrireAction({ url: "/api/extras", body: { heures: 3, date: "2026-09-20", description: "Pignon plus haut" } })).toBe("Extra 3 h du 2026-09-20 : Pignon plus haut");
    expect(m.decrireAction({ url: "/api/extras", body: { montant: "", heures: "", date: "2026-09-20", description: "Sans montant" } })).toBe("Extra du 2026-09-20 : Sans montant");
    expect(m.decrireAction({ url: "/api/autre", body: {} })).toBe("Saisie /api/autre");
  });
});

describe("activerMoniteurOffline", () => {
  beforeEach(() => { installerStockage(); });

  it("un seul moniteur par onglet, et il s'arrête proprement", async () => {
    const m = await chargerModule();
    const ecouteurs: any[] = [];
    (globalThis as any).window = {
      addEventListener: (n: string, f: any) => ecouteurs.push([n, f]),
      removeEventListener: (n: string, f: any) => {
        const i = ecouteurs.findIndex(([a, b]) => a === n && b === f);
        if (i >= 0) ecouteurs.splice(i, 1);
      },
    };
    // `navigator` n'est pas réassignable en Node : on le redéfinit.
    Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

    // Navigation se remonte à chaque navigation : 3 montages ne doivent poser qu'un
    // moniteur, sinon chaque saisie hors-ligne partait autant de fois qu'il y en avait.
    const stop1 = m.activerMoniteurOffline();
    m.activerMoniteurOffline();
    m.activerMoniteurOffline();
    expect(ecouteurs.length).toBe(1);

    stop1();
    expect(ecouteurs.length).toBe(0);
    // Après l'arrêt, un nouveau montage repose bien un moniteur.
    const stop2 = m.activerMoniteurOffline();
    expect(ecouteurs.length).toBe(1);
    stop2();
  });
});

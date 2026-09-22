// Le service worker (public/sw.js) ne se charge pas dans le panneau navigateur ni dans
// vitest : on l'exécute dans une sandbox `vm` avec un faux `caches` et un faux `fetch`,
// puis on lui envoie des événements fetch comme le ferait le navigateur.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const ORIGINE = "https://app.test";

type Rep = { status: number; ok: boolean; redirected: boolean; type: string; corps: string; clone(): Rep };
const rep = (corps: string, status = 200, extra: Partial<Rep> = {}): Rep => ({
  status, ok: status >= 200 && status < 300, redirected: false, type: "basic", corps, ...extra,
  clone() { return { ...this }; },
});

function faireSandbox() {
  const handlers: Record<string, Function[]> = {};
  const magasins = new Map<string, Map<string, Rep>>();
  const cle = (r: any) => (typeof r === "string" ? r : r.url);
  const ouvrir = (nom: string) => {
    if (!magasins.has(nom)) magasins.set(nom, new Map());
    const m = magasins.get(nom)!;
    return {
      put: async (r: any, v: Rep) => { m.set(cle(r), v); },
      match: async (r: any) => m.get(cle(r)),
      keys: async () => [...m.keys()],
      delete: async (r: any) => m.delete(cle(r)),
      addAll: async () => {},
    };
  };
  const reseau = { reponses: new Map<string, Rep | Error>(), appels: [] as string[] };
  const sandbox: any = {
    self: { addEventListener: (n: string, f: Function) => { (handlers[n] ||= []).push(f); }, skipWaiting: () => {}, clients: { claim: () => {} }, registration: {} },
    location: { origin: ORIGINE },
    caches: {
      open: async (nom: string) => ouvrir(nom),
      keys: async () => [...magasins.keys()],
      delete: async (nom: string) => magasins.delete(nom),
      match: async (r: any) => { for (const m of magasins.values()) { const v = m.get(cle(r)); if (v) return v; } return undefined; },
    },
    fetch: async (r: any) => {
      reseau.appels.push(cle(r));
      const v = reseau.reponses.get(cle(r));
      if (v instanceof Error) throw v;
      return v ?? rep("réponse réseau par défaut");
    },
    URL, console,
  };
  sandbox.self.location = sandbox.location;
  vm.createContext(sandbox);
  // SW_FICHIER permet de faire tourner le banc sur une AUTRE version du fichier
  // (ex. : l'ancienne, pour prouver que le banc attrapait bien le défaut).
  vm.runInContext(readFileSync(join(process.cwd(), process.env.SW_FICHIER || "public/sw.js"), "utf8"), sandbox);

  async function requete(url: string, mode = "cors"): Promise<Rep | undefined> {
    let promesse: Promise<Rep> | undefined;
    const event = { request: { method: "GET", url: ORIGINE + url, mode }, respondWith: (p: Promise<Rep>) => { promesse = p; } };
    for (const h of handlers.fetch) h(event);
    if (!promesse) return undefined; // le SW a laissé passer (réseau normal)
    const r = await promesse;
    // Laisse finir les mises en cache lancées sans await. (setImmediate, pas setTimeout :
    // sous Windows, setTimeout(0) attend ~15 ms → 305 requêtes = 5 s de banc.)
    await new Promise((res) => setImmediate(res));
    await new Promise((res) => setImmediate(res));
    return r;
  }
  /** Déclenche l'événement « install » comme le navigateur, et attend son waitUntil. */
  async function installer(): Promise<void> {
    let promesse: Promise<unknown> = Promise.resolve();
    for (const h of handlers.install) h({ waitUntil: (p: Promise<unknown>) => { promesse = p; } });
    await promesse;
  }
  const precacher = async (nomCache: string, url: string, corps: string) => { await ouvrir(nomCache).put(ORIGINE + url, rep(corps)); };
  const contenu = async (nomCache: string) => [...(magasins.get(nomCache) || new Map()).keys()];
  return { requete, installer, reseau, precacher, contenu, magasins };
}

const RUNTIME = "viking-v7-runtime";
const STATIC = "viking-v7-static";
let sb: ReturnType<typeof faireSandbox>;
beforeEach(() => { sb = faireSandbox(); });

describe("service worker — quoi mettre en cache, et dans quel ordre", () => {
  it("la charge utile d'une navigation interne (?_rsc=) vient du RÉSEAU, même si une version est en cache", async () => {
    // Avant : cache d'abord → l'ancienne page était servie tant qu'on ne rechargeait pas.
    await sb.precacher(RUNTIME, "/projets?_rsc=abc", "ANCIENNE page");
    sb.reseau.reponses.set(ORIGINE + "/projets?_rsc=abc", rep("NOUVELLE page"));
    const r = await sb.requete("/projets?_rsc=abc", "cors");
    expect(r?.corps).toBe("NOUVELLE page");
    expect(sb.reseau.appels).toContain(ORIGINE + "/projets?_rsc=abc");
  });

  it("hors ligne, la navigation interne retombe sur la copie en cache", async () => {
    await sb.precacher(RUNTIME, "/projets?_rsc=abc", "copie hors ligne");
    sb.reseau.reponses.set(ORIGINE + "/projets?_rsc=abc", new Error("réseau coupé"));
    const r = await sb.requete("/projets?_rsc=abc", "cors");
    expect(r?.corps).toBe("copie hors ligne");
  });

  it("un fichier haché de Next (/_next/static/…) est servi du cache SANS toucher au réseau", async () => {
    await sb.precacher(RUNTIME, "/_next/static/chunks/abc123.js", "chunk en cache");
    const r = await sb.requete("/_next/static/chunks/abc123.js", "cors");
    expect(r?.corps).toBe("chunk en cache");
    expect(sb.reseau.appels).toEqual([]);
  });

  it("un fichier haché absent du cache est téléchargé puis gardé", async () => {
    sb.reseau.reponses.set(ORIGINE + "/_next/static/chunks/neuf.js", rep("chunk neuf"));
    const r = await sb.requete("/_next/static/chunks/neuf.js", "cors");
    expect(r?.corps).toBe("chunk neuf");
    expect(await sb.contenu(RUNTIME)).toContain(ORIGINE + "/_next/static/chunks/neuf.js");
  });

  it("une page (mode navigate) vient du réseau d'abord, et une page complète et directe est gardée", async () => {
    await sb.precacher(RUNTIME, "/projets", "vieille page HTML");
    sb.reseau.reponses.set(ORIGINE + "/projets", rep("page HTML fraîche"));
    const r = await sb.requete("/projets", "navigate");
    expect(r?.corps).toBe("page HTML fraîche");
    expect((await sb.magasins.get(RUNTIME)!.get(ORIGINE + "/projets"))?.corps).toBe("page HTML fraîche");
  });

  it("une navigation REDIRIGÉE (session expirée → /login) n'est PAS mise en cache", async () => {
    // Avant : la page de connexion prenait la place de /projets dans le cache, et c'est
    // elle qu'on resservait hors ligne.
    sb.reseau.reponses.set(ORIGINE + "/projets", rep("page de connexion", 200, { redirected: true }));
    const r = await sb.requete("/projets", "navigate");
    expect(r?.corps).toBe("page de connexion");
    expect(await sb.contenu(RUNTIME)).not.toContain(ORIGINE + "/projets");
  });

  it("une page en erreur (500) ou opaque n'est pas mise en cache", async () => {
    sb.reseau.reponses.set(ORIGINE + "/projets", rep("erreur serveur", 500));
    await sb.requete("/projets", "navigate");
    sb.reseau.reponses.set(ORIGINE + "/clients", rep("opaque", 200, { type: "opaque" }));
    await sb.requete("/clients", "navigate");
    expect(await sb.contenu(RUNTIME)).toEqual([]);
  });

  it("hors ligne sans copie de la page : la page /hors-ligne dédiée, PAS l'accueil", async () => {
    await sb.precacher(RUNTIME, "/", "tableau de bord périmé");
    await sb.precacher(STATIC, "/hors-ligne", "page hors ligne");
    sb.reseau.reponses.set(ORIGINE + "/projets/12", new Error("réseau coupé"));
    const r = await sb.requete("/projets/12", "navigate");
    expect(r?.corps).toBe("page hors ligne");
  });

  it("hors ligne avec une copie de la page : c'est elle qu'on sert", async () => {
    await sb.precacher(RUNTIME, "/projets", "copie de /projets");
    await sb.precacher(STATIC, "/hors-ligne", "page hors ligne");
    sb.reseau.reponses.set(ORIGINE + "/projets", new Error("réseau coupé"));
    const r = await sb.requete("/projets", "navigate");
    expect(r?.corps).toBe("copie de /projets");
  });

  it("à l'installation, /hors-ligne est mise en cache — seulement si la réponse est complète et directe", async () => {
    sb.reseau.reponses.set(ORIGINE + "/hors-ligne", rep("page hors ligne"));
    await sb.installer();
    expect(await sb.contenu(STATIC)).toContain(ORIGINE + "/hors-ligne");

    // Session expirée au moment de l'installation : la page de connexion ne doit PAS
    // devenir la page « hors ligne ».
    const sb2 = faireSandbox();
    sb2.reseau.reponses.set(ORIGINE + "/hors-ligne", rep("page de connexion", 200, { redirected: true }));
    await sb2.installer();
    expect(await sb2.contenu(STATIC)).not.toContain(ORIGINE + "/hors-ligne");

    // Réseau coupé pendant l'installation : elle ne doit pas échouer pour autant.
    const sb3 = faireSandbox();
    sb3.reseau.reponses.set(ORIGINE + "/hors-ligne", new Error("réseau coupé"));
    await expect(sb3.installer()).resolves.toBeUndefined();
  });

  it("les API de lecture viennent du réseau d'abord ; les autres API ne passent pas par le SW", async () => {
    await sb.precacher("viking-v7-api", "/api/projets", "liste périmée");
    sb.reseau.reponses.set(ORIGINE + "/api/projets", rep("liste fraîche"));
    expect((await sb.requete("/api/projets"))?.corps).toBe("liste fraîche");
    expect(await sb.requete("/api/paies")).toBeUndefined();
    expect(await sb.requete("/login")).toBeUndefined();
  });

  it("le cache d'exécution est plafonné : les plus anciens fichiers partent", async () => {
    for (let i = 0; i < 305; i++) {
      const u = `/_next/static/chunks/c${i}.js`;
      sb.reseau.reponses.set(ORIGINE + u, rep(`c${i}`));
      await sb.requete(u);
    }
    const cles = await sb.contenu(RUNTIME);
    expect(cles.length).toBe(300);
    expect(cles).not.toContain(ORIGINE + "/_next/static/chunks/c0.js");
    expect(cles).toContain(ORIGINE + "/_next/static/chunks/c304.js");
  });
});

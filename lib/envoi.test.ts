import { describe, it, expect, vi, afterEach } from "vitest";
import { envoyer, lireJson, lireListe } from "./envoi";

function reponse(status: number, corps: any, brut?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (brut !== undefined ? brut : JSON.stringify(corps)),
  };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("lireJson — lecture avec filet", () => {
  it("renvoie les données sur un 200 JSON", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(200, [{ id: 1 }]));
    const r = await lireJson("/api/x");
    expect(r).toEqual({ ok: true, data: [{ id: 1 }] });
  });

  it("signale un 500 avec le message du serveur, sans lever", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(500, { error: "base indisponible" }));
    const r = await lireJson("/api/x");
    expect(r).toEqual({ ok: false, erreur: "base indisponible", statut: 500 });
  });

  it("ne plante pas sur une page d'erreur HTML (non-JSON)", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(502, null, "<html>Bad Gateway</html>"));
    const r = await lireJson("/api/x");
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.statut).toBe(502); expect(r.erreur).toBe("erreur 502"); }
  });

  it("retourne statut 401 sans message inventé (Garde401 redirige)", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(401, { error: "Non authentifié" }));
    const r = await lireJson("/api/x");
    expect(r).toEqual({ ok: false, erreur: "Non authentifié", statut: 401 });
  });

  it("réseau coupé : statut 0, message lisible", async () => {
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const r = await lireJson("/api/x");
    expect(r).toEqual({ ok: false, erreur: "réseau indisponible", statut: 0 });
  });

  it("un corps { ok:false } est un échec même en 200", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(200, { ok: false, error: "refus" }));
    const r = await lireJson("/api/x");
    expect(r).toEqual({ ok: false, erreur: "refus", statut: 200 });
  });
});

describe("lireListe — garantit un tableau", () => {
  it("refuse un objet là où une liste est attendue", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(200, { error: "x" }));
    const r = await lireListe("/api/x");
    expect(r.ok).toBe(false);
  });
  it("accepte un tableau", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(200, [1, 2]));
    const r = await lireListe<number>("/api/x");
    expect(r).toEqual({ ok: true, data: [1, 2] });
  });
});

describe("envoyer — en-têtes supplémentaires", () => {
  it("expose le statut HTTP et le corps d'un refus (409 = conflit de version)", async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue(reponse(409, { message: "modifiée ailleurs", quantite_actuelle: 4 }));
    const r = await envoyer("/api/x", { methode: "PATCH", corps: { id: 1 } });
    expect(r.ok).toBe(false);
    expect(r.statut).toBe(409);
    expect(r.erreur).toBe("modifiée ailleurs");
    expect(r.data?.quantite_actuelle).toBe(4);
  });

  it("transmet X-Idempotence-Cle avec le Content-Type JSON", async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { ok: true, id: 7 }));
    (globalThis as any).fetch = f;
    const r = await envoyer("/api/heures", { corps: { heures: 8 }, entetes: { "X-Idempotence-Cle": "abc" } });
    expect(r.ok).toBe(true);
    const init = f.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "X-Idempotence-Cle": "abc", "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ heures: 8 }));
  });

  it("un DELETE sans corps ne pose aucun en-tête", async () => {
    const f = vi.fn().mockResolvedValue(reponse(200, { ok: true }));
    (globalThis as any).fetch = f;
    await envoyer("/api/heures?id=1", { methode: "DELETE" });
    expect(f.mock.calls[0][1]).toEqual({ method: "DELETE" });
  });
});

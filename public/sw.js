// Service Worker — Revêtement Viking
// Cache-first pour les assets, network-first pour les pages, fallback offline

const CACHE_VERSION = "viking-v7";
// Nombre maximal de fichiers gardés dans le cache d'exécution. Sans plafond, chaque
// déploiement ajoutait son jeu de fichiers hachés et rien n'était jamais retiré.
const MAX_ENTREES_RUNTIME = 300;

async function mettreEnCache(nomCache, request, response, max) {
  const c = await caches.open(nomCache);
  await c.put(request, response);
  if (!max) return;
  const cles = await c.keys();          // ordre d'insertion : les plus anciennes d'abord
  for (let i = 0; i < cles.length - max; i++) await c.delete(cles[i]);
}
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const API_CACHE = `${CACHE_VERSION}-api`;

// Assets à pré-cacher pour démarrage rapide
const PRECACHE_URLS = [
  "/manifest.json",
];
// Page de repli hors ligne (app/hors-ligne/page.tsx) : statique, sans données. Avant, le
// repli était le HTML de « / » — des chiffres périmés présentés comme frais, ou la page de
// connexion si c'est elle qui avait été mise en cache. URL absolue : c'est la clé du cache.
const PAGE_HORS_LIGNE = self.location.origin + "/hors-ligne";

/** Une réponse ne vaut d'être mise en cache que si elle est COMPLÈTE et DIRECTE : une
 *  redirection (session expirée → /login) ou une erreur 500 resservie hors ligne prenait
 *  la place de la page demandée. */
function reponseCachable(res) {
  return !!res && res.ok && res.type === "basic" && !res.redirected;
}

async function precacherPageHorsLigne(cache) {
  try {
    const res = await fetch(PAGE_HORS_LIGNE, { cache: "no-store" });
    if (reponseCachable(res)) await cache.put(PAGE_HORS_LIGNE, res);
  } catch (e) { /* l'installation ne doit pas échouer pour ça */ }
}

// Endpoints API en LECTURE SEULE (GET) servis en stale-while-revalidate :
// affichage instantané même en réseau faible/chantier. (Pas d'auth ni de mutations.)
const API_LECTURE = [
  "/api/dashboard", "/api/finances", "/api/soumissions", "/api/heures-sommaire",
  "/api/extras", "/api/projets", "/api/relances", "/api/mes-taches",
];
function estApiLecture(pathname) {
  return API_LECTURE.includes(pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS).then(() => precacherPageHorsLigne(cache)))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (url.pathname.startsWith("/login")) return;

  // API : stale-while-revalidate pour les endpoints de lecture (instantané),
  // réseau direct pour le reste (mutations, auth, photos binaires…).
  if (url.pathname.startsWith("/api/")) {
    if (estApiLecture(url.pathname)) {
      // RÉSEAU D'ABORD : on sert toujours la réponse fraîche du serveur. Le cache ne
      // sert QU'EN REPLI hors-ligne — ainsi un cache périmé/corrompu ne peut jamais
      // casser l'app. (L'affichage instantané vient du cache localStorage côté app.)
      event.respondWith(
        fetch(request)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") {
              const copy = res.clone();
              caches.open(API_CACHE).then((c) => c.put(request, copy));
            }
            return res;
          })
          .catch(() => caches.open(API_CACHE).then((c) => c.match(request)))
      );
    }
    return;
  }

  // Network-first for HTML pages
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (reponseCachable(res)) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request).then((res) => res || caches.match(PAGE_HORS_LIGNE)))
    );
    return;
  }

  // Fichiers de Next au nom haché (/_next/static/…) : IMMUABLES pour une URL donnée →
  // cache d'abord, sans jamais revalider.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((res) => {
          if (res && res.status === 200) mettreEnCache(RUNTIME_CACHE, request, res.clone(), MAX_ENTREES_RUNTIME);
          return res;
        });
      })
    );
    return;
  }

  // TOUT LE RESTE — en particulier la charge utile des navigations internes de Next
  // (« /projets?_rsc=… », mode « cors », pas « navigate ») : RÉSEAU D'ABORD, cache en
  // repli hors-ligne seulement. Avant, ces réponses tombaient dans le « cache d'abord »
  // des fichiers : après un déploiement, cliquer un onglet servait l'ANCIENNE page tant
  // qu'on ne rechargeait pas complètement — et une nouveauté restait invisible.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") mettreEnCache(RUNTIME_CACHE, request, res.clone(), MAX_ENTREES_RUNTIME);
        return res;
      })
      .catch(() => caches.match(request))
  );
});

// === PUSH PWA ===
self.addEventListener("push", (event) => {
  let data = { title: "Revêtement Viking", body: "Notification", url: "/", icon: "/logo-viking.svg", badge: "/logo-viking.svg", tag: "viking-notif" };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      data: { url: data.url },
      vibrate: [80, 40, 80],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsList) => {
      for (const c of clientsList) {
        if ("focus" in c) { c.focus(); if ("navigate" in c) c.navigate(url); return; }
      }
      return self.clients.openWindow(url);
    })
  );
});

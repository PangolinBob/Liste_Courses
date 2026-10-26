/* Copie locale du programme uniquement. Les courses restent dans lc_appData_v1. */
const ROOT = new URL("./", self.location.href);
const INDEX = new URL("index.html", ROOT).href;
const CACHE_PREFIX = `liste-courses:${self.registration.scope}:`;
// Changer cette version si les fichiers du shell ou leur liste changent.
const CACHE_NAME = CACHE_PREFIX + "shell-v1";
const FILES = ["index.html", "IconCourses.png", "fonts/syne-latin.woff2",
  "fonts/syne-latin-ext.woff2", "fonts/syne-greek.woff2"];
const ASSETS = new Set(FILES.map(file => new URL(file, ROOT).href));

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll est atomique : un fichier manquant fait échouer la nouvelle installation.
    await cache.addAll([...ASSETS].map(url => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name)));
    // Prendre en charge la prochaine requête, sans recharger une liste ouverte.
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== ROOT.origin) return;

  const home = request.mode === "navigate" &&
    (url.pathname === ROOT.pathname || url.pathname === new URL(INDEX).pathname);
  if (home) {
    const cache = caches.open(CACHE_NAME);
    // Répondre depuis l’iPhone ; préparer la version suivante en arrière-plan.
    const refresh = fetch(new Request(INDEX, { cache: "no-cache" })).then(async response => {
      if (response.ok && !response.redirected &&
          response.headers.get("Content-Type")?.includes("text/html")) {
        await (await cache).put(INDEX, response.clone());
      }
      return response;
    });
    event.waitUntil(refresh.then(() => {}, () => {}));
    event.respondWith(cache.then(async store => (await store.match(INDEX)) || refresh));
    return;
  }

  if (!ASSETS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && !response.redirected) await cache.put(request, response.clone());
    return response;
  })());
});

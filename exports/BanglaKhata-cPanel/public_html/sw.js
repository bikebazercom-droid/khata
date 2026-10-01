
// Shared by the generated worker and policy tests. No API, auth, object, or
// third-party responses are ever put into CacheStorage.
function isShellRequest(url, origin, base, assets) {
  const parsed = new URL(url);
  return parsed.origin === origin && parsed.pathname.startsWith(base) &&
    assets.includes(parsed.pathname);
}

function isAppNavigation(url, origin, base) {
  const parsed = new URL(url);
  if (parsed.origin !== origin || !parsed.pathname.startsWith(base)) return false;
  const route = parsed.pathname.slice(base.length);
  return route === '' || route === 'index.html' ||
    route === 'sign-in' || route === 'sign-up' ||
    route === 'access' || route === 'reports' || route === 'staff-deployment' ||
    /^party\/[^/]+(?:\/(?:entry\/[^/]+|profile|report))?$/.test(route);
}
const BASE = "/";
const ASSETS = ["/assets/index-CojSBV0Q.js","/assets/index-CyDZttXR.css","/assets/index.es-B0Z-dlcQ.js","/assets/purify.es-VaSPOPhr.js","/fonts/NotoSansBengali-Regular.ttf","/icon-192.png","/icon-512.png","/index.html","/logo-icon.svg","/logo.svg","/manifest.webmanifest"];
const SHELL = BASE + 'index.html';
const CACHE_PREFIX = 'banglakhata-shell:' + BASE + ':';
const CACHE = CACHE_PREFIX + "2c8358d9a93090db";
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      // All-or-nothing: never activate a worker with mismatched HTML and JS.
      await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
      // Do not skipWaiting: existing tabs may still need their old hashed
      // dynamic chunks. Activate only when those tabs have closed.
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !isAppNavigation(request.url, self.location.origin, BASE) && !isShellRequest(request.url, self.location.origin, BASE, ASSETS)) return;
  if (request.mode === 'navigate') {
    if (!isAppNavigation(request.url, self.location.origin, BASE)) return;
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.open(CACHE).then(cache => cache.match(SHELL));
      return cached || Response.error();
    }));
  } else if (isShellRequest(request.url, self.location.origin, BASE, ASSETS)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(request)).then(cached => cached || fetch(request)));
  }
});

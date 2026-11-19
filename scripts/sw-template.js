// Service worker for Mekoniq Solar Lab. The three double-underscore constants below are filled in by scripts/make-sw.mjs at build time.
//
// Updates are atomic: a new version downloads EVERY asset into its own cache and checks each one against the sha256 the build
// recorded. If any file is missing, truncated or replaced (a captive-portal page answering 200 instead of the file), the new
// cache is thrown away and install fails, so the previous version keeps serving from its untouched cache. The old cache is
// deleted only after the new version has activated. A waiting version never takes over by itself: the page asks for it
// (SKIP_WAITING) after the draft is saved, so an update never swaps code under an open editing session.
const VERSION = '__VERSION__';
const BUILD = '__BUILD__';
const ASSETS = __ASSETS__; // [[path relative to the scope, sha256 hex]]
const PREFIX = 'mekoniq-shell-';
const CACHE = PREFIX + VERSION;
const at = (p) => new URL(p, self.registration.scope).href;

async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function install() {
  const cache = await caches.open(CACHE);
  try {
    await Promise.all(ASSETS.map(async ([path, sha]) => {
      const res = await fetch(new Request(at(path), { cache: 'reload' })).catch((e) => { throw new Error(`${path}: ${e && e.message ? e.message : 'không tải được'}`); });
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      if ((await sha256Hex(await res.clone().arrayBuffer())) !== sha) throw new Error(`${path}: nội dung không khớp bản build`);
      await cache.put(at(path), res);
    }));
  } catch (err) {
    await caches.delete(CACHE);
    throw err;
  }
}

async function activate() {
  for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
}

async function respond(req) {
  const cache = await caches.open(CACHE);
  if (req.mode === 'navigate') { const page = await cache.match(at('index.html'), { ignoreVary: true }); if (page) return page; }
  // ignoreVary: the static server may answer with Vary: Origin, and a module script request carries an Origin header the stored copy was not asked with.
  const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
  return hit || fetch(req);
}

self.addEventListener('install', (e) => e.waitUntil(install()));
self.addEventListener('activate', (e) => e.waitUntil(activate()));
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'VERSION' && e.source) e.source.postMessage({ type: 'VERSION', version: VERSION, build: BUILD });
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(respond(req));
});

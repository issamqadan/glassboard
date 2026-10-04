// Glassboard offline service worker — "download for the plane."
// Caches the whole Play-AI app (engine WASM + Stockfish + scripts) so it loads and
// plays with NO network. Cache-first with ignoreSearch so the ?v=<sha> cache-busted
// URLs still hit the cache. The cache name carries the deploy version, so a new
// deploy (online) installs fresh assets and drops the old cache.
const VERSION = "__GBVER__";
const CACHE = "gb-" + VERSION;

// Core assets a Play-AI game needs to run fully offline. Base paths (no ?v query) —
// requests carry ?v=<sha>, matched via ignoreSearch at fetch time.
const CORE = [
  "./", "./index.html", "./portal.html",
  "./main.js", "./style.css", "./nav.js", "./sf.js", "./theme.js",
  "./pieces.js", "./pieceinfo.js", "./rating.js", "./feedback.js", "./strategies.js", "./gb-assist-ui.js", "./gb-sound.js", "./gb-board-input.js", "./gb-recap.js", "./gb-capture.js", "./engine-worker.js",
  "./pkg/glassboard_wasm.js", "./pkg/glassboard_wasm_bg.wasm",
  "./vendor/stockfish/stockfish.js", "./vendor/stockfish/stockfish.wasm",
  "./manifest.webmanifest", "./icon.svg", "./version.txt",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))) // don't fail the whole install on one 404
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return; // only our own assets
  // version.txt must be fresh when online (drives the auto-updater), cached only as
  // an offline fallback.
  if (url.pathname.endsWith("/version.txt")) {
    e.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  // Everything else: cache-first (works offline), then network (and cache it).
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit); // offline and not cached → let it fail
    })
  );
});

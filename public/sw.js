// Hyphon app-shell service worker.
//
// The page runs under Cross-Origin-Embedder-Policy: require-corp (needed for
// SharedArrayBuffer / threaded hyphon_native.wasm — see
// docs/deployment/ADR_PWA_SERVICE_WORKER_COEP.md). Under require-corp, some
// browser-internal response reconstructions (byte-range reads used by
// WebAssembly.instantiateStreaming, and Range requests against cached
// audio/wasm) can hand back a response whose original same-origin "basic"
// type has been lost, and COEP then blocks it as if it were an
// unauthorized cross-origin load. So every response this worker stores or
// replays is re-wrapped with an explicit Cross-Origin-Resource-Policy header
// before it ever reaches the page — cheap insurance against that class of
// failure, same-origin or not.
//
// This file's own bytes are stamped with a build id at build time (see the
// `hyphon-precache-manifest` Vite plugin in vite.config.ts), so the browser's
// normal service-worker update check — which byte-compares this exact file —
// notices a new release even though everything else it needs (the actual
// hashed asset list) is fetched fresh from precache-manifest.json rather than
// hardcoded here.
//
// Caching strategy (see the ADR for the full per-asset-class rationale):
//   - "shell": index.html, manifest.webmanifest, the built JS/CSS bundle and
//     everything else the boot path needs offline — hyphon_native*.{wasm,js},
//     rubberband.wasm and the other small wasm engines, the default oscillator
//     .wav samples, osc/ art, the vowel pack, the WASM export maps. All of it is
//     precached eagerly at install time from precache-manifest.json (the
//     hyphon-precache-manifest plugin lists it, ~7 MB in all). The page's first
//     load is never controlled by this worker, so none of it could be left to
//     the runtime cache: whatever the page fetched before the worker claimed it
//     was simply never cached (#1659).
//   - Same-origin assets the manifest leaves out — the vendored Pyodide runtime
//     (~76 MB) and anything over the plugin's size cap — are cache-first at
//     runtime: cached the first time a controlled page fetches them and served
//     from cache on every load after, offline included.
//   - Cross-origin requests (Google Fonts, the onnxruntime-web CDN JS/WASM
//     Supertonic loads at runtime) are never intercepted. Under COEP
//     require-corp they need a Cross-Origin-Resource-Policy header from the
//     CDN itself, which this worker cannot supply, so they are left to the
//     network exactly as an uncontrolled page would leave them.

const BUILD_ID = '__HYPHON_BUILD_ID__';
const PRECACHE_NAME = `hyphon-precache-${BUILD_ID}`;
const RUNTIME_CACHE_NAME = `hyphon-runtime-${BUILD_ID}`;
const MANIFEST_URL = './precache-manifest.json';
const SHELL_URLS = ['./', './index.html', './manifest.webmanifest', './precache-manifest.json'];

// Resolve a public/-relative path against this worker's own scope, not the
// origin root — a deployment under a subdirectory (docs/deployment/
// DEPLOYMENT_CONFIG.md's `/hyphon/`) registers this worker with a scope of
// `/hyphon/`, so a root-relative pattern like `^/pyodide/` would never match
// the real request path `/hyphon/pyodide/...`.
function scopedPath(path) {
  return new URL(path, self.registration.scope).pathname;
}

const RUNTIME_CACHE_DIR_PREFIXES = ['pyodide/', 'wam/', 'osc/'].map(scopedPath);

// Same-origin paths cached opportunistically (first fetch wins), never
// eagerly precached — matched against the request URL's pathname.
const RUNTIME_CACHE_PATTERNS = [/hyphon_native.*\.(wasm|js)$/, /\.wasm$/, /\.(wav|mp3)$/];

// Cache lookups ignore `Vary`. The static host answers every asset with
// `Vary: Origin`, and Chromium attaches an `Origin` request header to
// same-origin `crossorigin` requests (every module script and stylesheet of the
// Vite bundle). The entries below are stored from this worker's own
// `fetch(url)`, which carries no `Origin`, so a plain `cache.match(request)`
// misses every precached JS/CSS file: the handler then falls through to the
// network and, offline, rejects respondWith() (net::ERR_FAILED, #1659). Matching
// by URL string hit, matching by the real request did not. `Vary` says nothing
// useful about same-origin build output, so it is not part of the cache key.
const MATCH_OPTIONS = { ignoreVary: true };

// An absolute, scope-relative cache key. `cache.put('./x')` would resolve
// against this script's URL, which is the scope only for the default scope; this
// states it.
function shellKey(path) {
  return new URL(path, self.registration.scope).href;
}

function withCorp(response) {
  if (!response || !response.ok) return response;
  if (response.headers.get('Cross-Origin-Resource-Policy')) return response;
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function precacheShell() {
  const cache = await caches.open(PRECACHE_NAME);
  let shell = SHELL_URLS;
  try {
    const manifestRes = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (manifestRes.ok) {
      const manifest = await manifestRes.json();
      if (Array.isArray(manifest.shell) && manifest.shell.length > 0) {
        shell = manifest.shell;
      }
    }
  } catch (err) {
    // Rare (install always needs network at least once) or an old deploy
    // without a manifest yet — fall back to the static shell list.
    console.warn('[sw] could not fetch precache-manifest.json, using static shell list', err);
  }

  // A partial shell would leave the worker serving a page that 404s some of
  // its own JS/CSS offline, so a failure on any required entry fails the
  // whole install — the browser then keeps the previous worker (or none) in
  // control and retries this install on the next registration/update check,
  // rather than activating with holes in the shell.
  const failed = [];
  await Promise.all(
    shell.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'network error'}`);
        await cache.put(shellKey(url), withCorp(res.clone()));
      } catch (err) {
        console.error(`[sw] failed to precache required shell entry ${url}`, err);
        failed.push(url);
      }
    }),
  );
  if (failed.length > 0) {
    throw new Error(`[sw] install aborted — could not precache: ${failed.join(', ')}`);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('hyphon-') && key !== PRECACHE_NAME && key !== RUNTIME_CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Network conditions that never actually reject `fetch()` — a captive
// portal, a silently dropped connection, or (observed in CI) Playwright's
// CDP offline emulation not always propagating to a fetch() issued from the
// worker's own thread — leave `fetch()` pending forever instead of
// rejecting. Every network attempt below is bounded so a "fetch never
// settles" condition still falls back to cache within a few seconds rather
// than hanging the page (worst case: a permanently blank screen offline).
const NETWORK_TIMEOUT_MS = 4000;

function fetchWithTimeout(request, ms = NETWORK_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sw: network timed out')), ms);
    fetch(request).then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function isRuntimeCacheable(pathname) {
  if (RUNTIME_CACHE_PATTERNS.some((re) => re.test(pathname))) return true;
  return RUNTIME_CACHE_DIR_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Takes the FetchEvent (not just the request) so the write can be attached
// via event.waitUntil() — without it, the browser is free to kill this
// worker right after respondWith()'s promise resolves, before a large
// hyphon_native.wasm or Pyodide asset finishes writing to Cache Storage.
async function cacheFirst(event, cacheName) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, MATCH_OPTIONS);
  if (cached) return cached;
  // Deliberately unbounded: on a cold cache there is nothing to fall back to,
  // so a timeout can only convert a slow-but-working download (a ~47 MB scipy
  // wheel took ~7 s under `vite preview`) into net::ERR_FAILED for the page.
  const response = await fetch(request);
  if (response && response.ok) {
    event.waitUntil(cache.put(request, withCorp(response.clone())));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin (fonts, CDN)

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetchWithTimeout(request);
        } catch {
          const cache = await caches.open(PRECACHE_NAME);
          return (await cache.match(shellKey('./index.html'), MATCH_OPTIONS)) ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const precached = await (await caches.open(PRECACHE_NAME)).match(request, MATCH_OPTIONS);
      if (precached) return precached;

      try {
        if (isRuntimeCacheable(url.pathname)) {
          return await cacheFirst(event, RUNTIME_CACHE_NAME);
        }
        return await fetchWithTimeout(request);
      } catch {
        const runtimeCached = await (await caches.open(RUNTIME_CACHE_NAME)).match(request, MATCH_OPTIONS);
        if (runtimeCached) return runtimeCached;
        // Not cached and the network is gone: answer with an explicit network
        // error (what the page would see anyway) instead of rejecting the
        // respondWith() promise.
        return Response.error();
      }
    })(),
  );
});

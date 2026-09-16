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
//   - "shell": index.html, manifest.webmanifest, and the built JS/CSS bundle
//     — precached eagerly at install time from precache-manifest.json, since
//     Vite hashes those filenames and this static file can't know them.
//   - Same-origin runtime assets (hyphon_native*.{wasm,js} and their worklet
//     glue, wam/, osc/, pyodide/, default oscillator .wav samples) are
//     cache-first but NOT eagerly precached — several run multiple MB
//     (hyphon_native's threaded build, the vendored Pyodide runtime) — so
//     they are cached the first time the page actually fetches them and
//     served from cache on every load after, offline included.
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
        await cache.put(url, withCorp(res.clone()));
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
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetchWithTimeout(request);
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
          return (await cache.match('./index.html')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const precached = await (await caches.open(PRECACHE_NAME)).match(request);
      if (precached) return precached;

      if (isRuntimeCacheable(url.pathname)) {
        return cacheFirst(event, RUNTIME_CACHE_NAME);
      }

      try {
        return await fetchWithTimeout(request);
      } catch (err) {
        const runtimeCached = await (await caches.open(RUNTIME_CACHE_NAME)).match(request);
        if (runtimeCached) return runtimeCached;
        throw err;
      }
    })(),
  );
});

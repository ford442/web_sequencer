# ADR: PWA service worker under COEP `require-corp`

**Status:** Accepted
**Date:** 2026-09-15

## Context

Hyphon needs `crossOriginIsolated === true` for `SharedArrayBuffer`, which the
threaded `hyphon_native.wasm` build and several worklets depend on. The dev
and preview servers already send `Cross-Origin-Opener-Policy: same-origin`
and `Cross-Origin-Embedder-Policy: require-corp` (`vite.config.ts`), and the
production host is expected to send the same pair.

Before this change, `public/sw.js` did not exist: there was no offline
support, and a reload after a crash lost embedded sample banks because
autosave went through `localStorage` with a 512 KB cap that strips
`embeddedSamples`/`backgroundImage` before writing (see
`src/utils/projectPersistence.ts`, still used only as a migration source —
the live autosave path is now `src/services/ProjectStore.ts`, over
OPFS/IndexedDB, with no size cap). This ADR covers the service-worker half:
what gets cached, how, and why — including the parts of the feature request
that turned out not to match this codebase (there was no earlier sw.js to
"register"; it's new).

## Decision

### Precache is manifest-driven, not hand-listed

`public/sw.js` is a static file — Vite copies it to `dist/sw.js` unhashed and
never rewrites its contents. It cannot hardcode the hashed asset filenames a
build produces. Instead:

- A new Vite plugin (`hyphonPrecacheManifestPlugin`, `vite.config.ts`) walks
  `dist/` after the bundle is written and emits `dist/precache-manifest.json`
  — the list of shell URLs to precache, plus a `version` (a SHA-256 of that
  list, truncated).
- `sw.js` fetches `./precache-manifest.json` with `cache: 'no-store'` at
  install time and precaches exactly what it lists, falling back to a
  minimal static list (`['./', './index.html', './manifest.webmanifest',
  './precache-manifest.json']`) only if the fetch itself fails.
- The same plugin stamps that build's `version` into the copy of `sw.js` it
  writes to `dist/`, replacing a `__HYPHON_BUILD_ID__` placeholder in the
  source file. `sw.js`'s *logic* never needs to change release to release,
  but its *bytes* now do — which matters because the browser's
  install/waiting/activate update lifecycle is triggered by byte-comparing
  the registered script. Without this stamp, an unchanged `sw.js` would never
  be seen as updated and the "new version available" flow would never fire.
  `main.tsx` registers with `updateViaCache: 'none'` so that byte comparison
  always hits the network instead of a stale HTTP cache.
- `scripts/check-release-dist.mjs` fails the release build if `dist/sw.js`,
  `dist/manifest.webmanifest`, `dist/precache-manifest.json`, or any file the
  manifest's `shell` array names is missing — the same class of gate that was
  missing for the export-map/worklet regressions (#1176, #1177) this issue
  cites.

### Per-asset-class caching policy

| Asset class | Example | Policy | Why |
|---|---|---|---|
| App shell (HTML, JS/CSS bundle chunks, UI images) | `index.html`, `assets/index-*.js`, `assets/index-*.css`, `assets/knob-bezel-*.png` | **Precache**, install-time | Small enough in aggregate (a few MB) to precache eagerly; required for the app to boot at all. Includes the worklet processor chunks (`open303-processor-*.js`, `drumkit-processor-*.js`, …) — they are ordinary Vite `?worker&url` output living in `assets/` alongside everything else. |
| Native audio engine | `hyphon_native.wasm`, `hyphon_native.js`, `hyphon_native.st.wasm`, `hyphon_native.st.js` | **Runtime cache-first**, not precached | Built separately (`emscripten/build.sh`) and copied into `public/` root, not through Rollup's hashed `assets/` pipeline, so there is no content hash to key a precache entry on — and the threaded build runs several MB. `main.tsx` always fetches one of the two profiles during a normal boot (`loadHyphonNative()`), so the SW's runtime cache-first strategy (`RUNTIME_CACHE_PATTERNS` in `sw.js`) has it cached after the very first successful load. |
| Default oscillator/sample assets | `saw.wav`, `square.wav`, `wam/*`, `osc/*` | **Runtime cache-first**, not precached | Fetched during normal boot the same way; caching them opportunistically means the second (offline) load already has what a fresh pattern needs, without bloating the eager precache with audio data. |
| Vendored Pyodide runtime | `pyodide/*` (CPython + numpy/scipy, tens of MB) | **Runtime cache-first**, not precached | Same-origin (`window.HYPHON_PYODIDE_BASE_URL` in `index.html` points at `${BASE_URL}pyodide/`, not a CDN — see below), so it *can* be cached under `require-corp`, but it is large and only the Pyodide DSP/drums fallback path touches it. Precaching it unconditionally would multi-megabyte-tax every install for a path most sessions never exercise; caching on first actual use gets the same offline guarantee for the sessions that do. |
| `onnxruntime-web` WASM (Supertonic / neural TTS voice mixing) | `ort-wasm-simd-threaded.jsep-*.wasm` (~23 MB in `dist/assets/`) | **Never cached** by this worker | `src/services/Supertonic.ts` pins `ort.env.wasm.wasmPaths` to `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/` at runtime, so the copy Vite bundles into `dist/assets/` is never actually fetched same-origin — it ships dead weight, and the *live* WASM load is a cross-origin CDN request the SW cannot intercept usefully (see below). **Follow-up filed separately**: either vendor `onnxruntime-web`'s WASM under `public/` and point `wasmPaths` at it (making it cacheable and dropping the CDN dependency), or stop bundling the unused copy. Out of scope here. |
| Google Fonts | `fonts.googleapis.com` (CSS), `fonts.gstatic.com` (font files) | **Never cached**, request not intercepted | Cross-origin. Under `require-corp`, a cross-origin response needs a `Cross-Origin-Resource-Policy` header from the *origin serving it* — this worker cannot add one on the CDN's behalf, and forging one on a same-origin opaque replay would be a lie the browser is right to reject. `sw.js`'s `fetch` handler explicitly skips any request whose origin isn't `self.location.origin`, leaving cross-origin loads exactly as an uncontrolled page would leave them. Offline, the page falls back to the `monospace` stack already declared next to the `@font-face` import in `index.html` — no additional handling needed. |

`ort-*.wasm` and the Pyodide runtime are the two "must be opt-in/on-demand"
items called out in the originating feature request; both are same-origin in
this codebase already (Pyodide was already vendored, not CDN-loaded — the
request's proposed "self-host or accept degraded offline Pyodide" decision
point does not apply here), so the only asset actually blocked from caching
by cross-origin CORP is Google Fonts (and, incidentally, `onnxruntime-web`'s
CDN JS/WASM, which was already going to be an unauthenticated network
dependency regardless of this ADR).

### COEP-safety of cached/replayed responses

Every response this worker stores or replays — precached or runtime-cached —
is re-wrapped with an explicit `Cross-Origin-Resource-Policy: cross-origin`
header (`withCorp()` in `sw.js`) before it is written to Cache Storage or
handed back to `respondWith()`. All of it is same-origin, so this is not
strictly required by the COEP spec for a straightforward `fetch` → cache →
replay — but two browser-internal cases can reconstruct a `Response` in a way
that drops its original "basic" (same-origin) type, at which point `require-corp`
treats it as an unauthorized cross-origin load even though the bytes are
same-origin:

- Range requests (byte-range reads against a cached `hyphon_native.wasm`, or
  `<audio>` seeking within a cached sample) — the browser synthesizes a new
  `206` response from the cached entry.
- `WebAssembly.instantiateStreaming()` reading a cached response as it
  streams.

Adding the header on write costs nothing and closes that gap unconditionally
rather than per-code-path, which is worth it given how load-bearing
`crossOriginIsolated` is here (every threaded worklet depends on it).

### Base-path portability

`docs/deployment/DEPLOYMENT_CONFIG.md` documents (and `tests/deploy-smoke.spec.ts`
exercises) a subdirectory deployment target (`/hyphon/`); the current
`vite.config.ts` does not set `base` and defaults to root, which is a
pre-existing inconsistency this ADR does not resolve. Everything added here
is written to work under either: `main.tsx` registers the worker at
`` `${import.meta.env.BASE_URL}sw.js` ``, `index.html`'s manifest `<link>`
and the manifest's own `start_url`/`scope` use relative paths, and `sw.js`'s
own shell/manifest URLs are `./`-relative to its own script location (whose
default scope is the directory it's served from, `/` or `/hyphon/`
alike).

### Update flow

New release → `precache-manifest.json`'s content (and therefore its
`version`) changes → the plugin stamps a different build id into `sw.js` →
the browser's next update check sees different bytes → the new worker
installs in the background and parks in `waiting` (it never calls
`skipWaiting()` on its own) → `main.tsx` notifies `swUpdateStore`, and
`UpdateAvailableToast` offers "Reload"; clicking it posts `SKIP_WAITING` to
the waiting worker, and the resulting `controllerchange` event triggers a
single `location.reload()`. `activate` also deletes any `hyphon-*` cache
whose name doesn't match the current build id, so the old precache/runtime
caches are dropped once the new worker takes over — a stale JS chunk is
never served after that reload.

### Registration is env-gated, not global in E2E

`main.tsx` only registers the worker in production builds, and skips
registration under Playwright's `?e2e=1` unless `?pwa=1` is also present.
The existing E2E matrix (audio engine boot, worklets, automation, session
launcher, …) never passes `?pwa=1`, so it is unaffected by this change; the
two specs that exercise the worker (`tests/pwa.spec.ts`) opt in explicitly.

## Consequences

- A second, offline load now boots the shell and plays a pattern with the
  default oscillator/sample assets — see `tests/pwa.spec.ts`.
- `build:release` now fails closed if the PWA shell is incomplete, instead of
  shipping a service worker (or manifest) that 404s part of its own precache
  list.
- Sessions that never touch Pyodide DSP fallbacks or the Supertonic neural
  voice path do not pay their storage cost offline; sessions that do pay it
  once, on first use, same as they already pay the network cost once today.
- Google Fonts and the `onnxruntime-web` CDN dependency remain network-only;
  neither regressed by this change (both were already network dependencies),
  and both are called out above as separate follow-up candidates.

# ADR 0001: WAM2 host loading and security model

**Status:** Accepted for Phase A; **Phase B addendum accepted** (see the end of this document)  
**Date:** 2026-08-17  
**Supersedes (executable slice):** closed roadmap #882 (unrestricted remote URL host)  
**Builds on:** #1038 declarative audio graph / compiler

## Context

Hyphon already labels AssemblyScript oscillators as `wam` (`wam-saw`, engine id `wam`). This ADR is about **Web Audio Modules 2.0**. The host uses `wam2` identifiers so the two systems never collide.

The long-term studio goal is first-party AssemblyScript / Rust / Emscripten / WebGPU engines coexisting with standardized community instruments and effects — on **one** declarative graph, not a parallel router.

## Decision

### SDK pin

| Item | Choice |
|------|--------|
| Package | `@webaudiomodules/sdk` |
| Version | **0.0.12** (published 2024-07-26) |
| License | **MIT** (WebAudioModules Working Group) |
| Unpacked size | **375.5 KB** (49 files, 0 dependencies) |
| Load | **Lazy only** via `src/audio/wam/sdk/loadOfficialSdk.ts` (`import(/* @vite-ignore */)`) |

Phase A does **not** add the SDK to `package.json`. First-party fixtures implement the WAM2 *contract* (descriptor, initialize with abort/timeout, `audioNode`, MIDI notes, one automatable param, getState/setState, dispose) using native `OscillatorNode` / `GainNode`. Community plugins stay behind the lazy loader until Phase B’s allowlisted installer exists.

### Loading model

- **Local-first and allowlisted.** v1 loads bundled packages `hyphon.tone` and `hyphon.gain` only. There is no remote JavaScript URL field.
- Packages are identified by `{ id, version, integrity }`. Integrity is SHA-256 of a canonical fingerprint when `crypto.subtle` is available, otherwise FNV-1a 32-bit in tests.
- Initialization is bounded (`WAM2_INIT_TIMEOUT_MS = 2000`) and cancellable (`AbortSignal`). Failure/timeout/missing identity leaves a **bypass placeholder**; transport and master output continue.
- **Never silently substitute** another plugin or first-party engine when a saved plugin is missing or the hash/version does not match.

### Graph integration

WAM nodes are factories on the existing compiler (`wamInstrumentSlot`, `wamTrackInsert`, `wamMasterInsert`, `wamSendReturn`) with dual ports (`input` / `output`). Cycles are rejected unless a `delay` node sits on the cycle (classic Electribe feedback remains legal).

Notes and automation use current paths: sequencer `useStepHandler` + `AutomationScheduler` (`target: 'wam'`, `parameter: 'slotId/paramId'`).

### Security / CSP / isolation

| Surface | Phase A policy |
|---------|----------------|
| Network | Denied (`permissions.network: false`). No plugin `fetch`. |
| Cloud tokens / filesystem | Denied. Plugins never receive `CloudStorage` or project FS abstractions. |
| CSP | Same-origin scripts/worklets only. Do not add `unsafe-eval` or remote `script-src` for plugins. |
| COOP/COEP | Unchanged Vite headers (`same-origin` / `require-corp`). Required for threaded WASM; WAM2 fixtures do not need `SharedArrayBuffer`. Runtime probe: `crossOriginIsolated` + `BASE_URL` in Engine HUD. |
| Worklet / Worker | Fixtures do not spawn extra worklets/workers. Community SDK plugins that do must remain same-origin. |
| Subdirectory deploy | Descriptors live under `public/wam/` and are resolved with `resolvePublicAsset` / Vite `base: './'`. |
| Package integrity | Fingerprint hash stored on the song; mismatch → missing placeholder, not a substitute. |

### Lifecycle

Mount → integrity check → initialize (timeout) → attach to slot ports → restore state → telemetry. Dispose disconnects AudioNodes deterministically. A crash in one slot sets bypass gain; other slots and the master chain stay connected.

### Offline render / freeze

| Fixture | Position |
|---------|----------|
| `hyphon.tone` / `hyphon.gain` | `offline: 'native'` (same Web Audio nodes work in `OfflineAudioContext`) |
| Official SDK / community WAMs | **Unsupported** in Phase A — show an explicit unsupported badge. Do not fake freeze with a different engine. |

### Bundle impact

| Chunk | Cost |
|-------|------|
| Main entry (`main.tsx` / `App.tsx`) | **0 bytes** of `@webaudiomodules/sdk` (static import forbidden; unit-tested). Phase B: re-measured on a real build, see the addendum. |
| Official SDK if lazy-loaded | 375.5 KB unpacked. Phase B measurement: **60.27 kB bundled / 10.89 kB gzip** in its own async chunk. |
| First-party host + fixtures | TypeScript in `src/audio/wam/**` compiled into the app chunk that already owns the audio engine (~small; no extra WASM) |

## Consequences

- Phase B can install the pinned SDK as a dependency and lazy-import it for allowlisted community packages without changing song schema.
- Product work (browser/install/update, generic editor, CPU meters from worklets) stays out of Phase A.
- Naming: UI copy for Web Audio Modules must say **WAM2**, not **WAM**, until the AssemblyScript oscillator family is renamed.


---

# Phase B addendum: allowlisted installer, SDK pin, CSP

**Status:** Accepted
**Date:** 2026-08-25
**Amends:** the Phase A decisions above. Where the two differ, this section wins.

## What changed, and why

Phase A shipped the host but not the product. Three things were nominally decided and not actually true:

1. **The SDK pin was fictional.** `loadOfficialWamSdk()` lazy-imported `@webaudiomodules/sdk@0.0.12`, but the package was not in `package.json`, so the import always failed and every caller fell into the catch. Worse, the Phase A implementation could not have worked even once the package existed: a bare specifier behind a `vite-ignore` pragma is left untransformed, and a browser cannot resolve a bare specifier.
2. **"Allowlisted" meant "two hardcoded fixtures."** There was no installer, no way to enable anything, and no code path that loaded bytes it did not already contain.
3. **The CSP claim was contradicted by `index.html`**, which loaded Pyodide from jsDelivr and used a `new Function` importer.

### SDK pin (supersedes "Phase A does not add the SDK to package.json")

`@webaudiomodules/sdk@0.0.12` is now a pinned **devDependency**, present in `pnpm-lock.yaml`.

`src/audio/wam/sdk/loadOfficialSdk.ts` imports it with a **literal** specifier and **no** `vite-ignore` pragma. A literal dynamic import is a Rollup chunk boundary: the SDK becomes its own async chunk, the main entry keeps **zero** SDK bytes, and — unlike Phase A — the load actually resolves. `WamHost.test.ts` asserts both halves; `sdkLoad.test.ts` asserts the pin, the lockfile entry, and a real successful load.

Measured on a probe build whose entry imports the loader eagerly (the worst case for the bundle rule):

| Chunk | Size | Contents |
|---|---|---|
| entry | 1.44 kB | the loader, plus `import("./<sdk-chunk>.js")` — a genuine async boundary |
| split chunk | 60.27 kB (10.89 kB gzip) | the SDK itself |

The only occurrence of an SDK symbol in the entry chunk is the string list
`REQUIRED_SDK_EXPORTS = ["WebAudioModule", "WamNode", "addFunctionModule"]`, which
is host code. In the app's own build the loader is not currently reachable from
the entry at all, so the main bundle contains nothing SDK-related whatsoever.

One property worth recording because it is not obvious: the SDK evaluates `class WamNode extends AudioWorkletNode` at module scope. Importing it therefore throws a `ReferenceError` in Node, in jsdom, and inside an AudioWorklet global scope — anywhere that constructor is undefined. The loader checks for it first and returns a stated reason rather than a stack trace. **Consequence: the official SDK can only ever be loaded on a browser main thread.**

### Allowlisted installer

`public/wam/catalog.json` is schema **2**. An entry is `{ id, version, kind, title, vendor, license, origin, capabilities, params }`, plus, for `origin: "community"`, `{ entry, integrity }`.

| Property | How it is held |
|---|---|
| **No arbitrary URL field** | `entry` must match `^wam/community/<pkg>/<file>.js$`. Strings containing `:`, `%`, `..`, `\\`, `?`, `#`, or a leading `/` are rejected before the shape check. A catalog carrying `url` / `src` / `href` / `remote` / `cdn` on any entry is **rejected outright**, not ignored — silently dropping the field would let a catalog look like it grants remote loading. |
| **Same-origin only** | The entry path is resolved with `resolvePublicAsset`, so it is always a file under the deploy's own `public/`. |
| **Integrity over real bytes** | The installer fetches the file, SHA-256s **the bytes the browser would execute**, and compares against `integrity`. This is strictly stronger than the bundled fixtures' descriptor fingerprint, which proves nothing about file contents. |
| **Mismatch never runs** | On mismatch the installer throws before the dynamic import. Nothing is executed, and the slot bypasses. |
| **User opt-in** | A community package must be enabled (`setPackageEnabled`), which itself refuses ids that are not in the catalog. So the enabled set can never name something the allowlist does not. |
| **No eval** | Loading is a plain same-origin dynamic `import()`. No `eval`, no `new Function`, no `script-src` beyond self. |
| **Build-time enforcement** | `pnpm run check:wam` (in CI and in `lint`) fails if any package's bytes do not hash to its catalog value, so an edited package fails the build instead of failing in a browser. |

A community module must export `wam2ApiVersion: 1` and `createWam2Plugin(descriptor)`. Anything else is rejected as `bad-module`.

`hyphon.pulsar` ships as the first non-fixture package: a plain ES module under `public/wam/community/`, travelling this entire path.

### CSP (supersedes the Phase A CSP row)

The two Phase A violations are gone: `index.html` has no remote `<script src>` and no `new Function` importer, and Pyodide is vendored same-origin. `scripts/check-release-dist.mjs` re-checks both against the **built** `dist/index.html`.

The intended policy is therefore now expressible:

```
default-src 'self';
script-src 'self';
worker-src 'self' blob:;
connect-src 'self';
object-src 'none';
base-uri 'self';
```

`blob:` in `worker-src` is required by Emscripten's pthread workers, not by WAM2.

**Not yet enforced.** This repository has no place to configure a response header — Vite's dev server headers cover COOP/COEP only, and the deploy target is outside the repo. So this is a documented target policy that the code no longer violates, not a shipped header. Adding the header belongs with the Phase B host deployment work.

### Offline render / freeze (unchanged, now enforced)

Bundled fixtures remain `offline: 'native'`. Community packages and anything built on the official SDK are `offline: 'unsupported'`, surfaced as a "no freeze" badge in both the Engine HUD and the generic editor. `descriptorFromCatalogEntry()` will not grant `native` to a community package even if its catalog entry claims the `offline-native` capability — freeze is not a claim a package gets to make about itself.

### Restore, and the no-substitution rule

`planWam2Restore` now covers community packages and reports **why** a slot could not be restored: `not-allowlisted`, `version-mismatch`, or `integrity-mismatch`. The distinction reaches the HUD as `missing` (we do not have this package) versus `failed` (we have it, but not the one the song saved). Neither ever loads a different plugin.

For a community package the saved integrity is the file hash, so "the bytes changed since you saved this song" is detected, reported, and bypassed.

### Slot control and telemetry

`WamHost` gains `setBypass` (keeps the plugin mounted and its state intact — a monitoring control, not an unload) and `restartSlot` (a full re-verified remount, the recovery path for a failed or timed-out slot). Both are exposed per-slot in the Engine HUD.

Per-slot CPU is reported as `number | null`, and **null means "no meter", not "free"**. Only a plugin owning its own worklet can measure its DSP load; the bundled fixtures and `hyphon.pulsar` are built from native `AudioNode`s that the main thread cannot time individually. The HUD renders null as "—". Reporting `0%` — which is what Phase A did — is a fabricated measurement.

### Generic editor

`src/components/Wam2GenericEditor.tsx` builds controls from the descriptor, so a package needs no UI of its own to be usable or automatable. Automation goes through the existing lane path (`target: 'wam'`, `parameter: 'slotId/paramId'`) — no second router.

## Consequences

- A community package can be added by dropping a file under `public/wam/community/`, adding a catalog entry, and running `pnpm run wam:integrity`. Vendoring a third-party MIT build is that same drop, plus a license note.
- The song schema is unchanged (`WAM2_SONG_SCHEMA = 1`): a community package's identity uses the same `{ packageId, version, integrity }` triple, only with a different meaning for `integrity`.
- Still out of scope: remote marketplace, plugin-to-plugin MIDI, undo across plugin internal state, VST bridges.

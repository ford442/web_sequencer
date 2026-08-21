# ADR 0001: WAM2 host loading and security model (Phase A)

**Status:** Accepted for Phase A  
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
| Main entry (`main.tsx` / `App.tsx`) | **0 bytes** of `@webaudiomodules/sdk` (static import forbidden; unit-tested) |
| Official SDK if lazy-loaded | 375.5 KB unpacked (~gzip well under that; measure again when added to lockfile) |
| First-party host + fixtures | TypeScript in `src/audio/wam/**` compiled into the app chunk that already owns the audio engine (~small; no extra WASM) |

## Consequences

- Phase B can install the pinned SDK as a dependency and lazy-import it for allowlisted community packages without changing song schema.
- Product work (browser/install/update, generic editor, CPU meters from worklets) stays out of Phase A.
- Naming: UI copy for Web Audio Modules must say **WAM2**, not **WAM**, until the AssemblyScript oscillator family is renamed.

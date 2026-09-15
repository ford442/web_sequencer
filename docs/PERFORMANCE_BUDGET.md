# Performance Budget & Auto-Degrade Order

## Bundle-size budget

Enforced by `scripts/check-release-dist.mjs` (part of `build:release`) against
`dist-budget.json`. Scoped to **`dist/assets/`** — the directory Vite's bundler
actually controls — not all of `dist/`:

| What's excluded | Why |
|---|---|
| `hyphon_native*`, `jc303*`, `rubberband.wasm`, `*.wav` (dist root) | Vendored native-build/audio artifacts copied from `public/`, outside Vite's bundling |
| `dist/pyodide/` (~75 MB) | Vendored CPython/WASM runtime for the Pyodide oscillator engine; a fixed cost unrelated to app code splitting |
| any `*.wasm` inside `dist/assets/` (incl. `ort-wasm-simd-threaded.jsep-*.wasm`, ~24 MB) | Runtime-fetched by `onnxruntime-web` on first TTS use, or by the AssemblyScript oscillators — not part of what every visitor downloads on load |

| Budget | Value | Measured (2026-09-15) |
|---|---|---|
| Entry chunk (`dist/index.html`'s `<script type="module">`) | < 1.65 MB raw | ~1.50 MB |
| Any single image asset (png/jpg/gif/webp/avif, anywhere in `dist/`) | < 512 KB | 31.7 KB (`knob-bezel.webp`) |
| `dist/assets/` total, excluding `.wasm` | < 4.4 MB | ~4.06 MB |

`build:release` fails with the offending asset(s) and sizes when a budget is
exceeded, plus the ten largest `dist/assets/` files for context.

### How the entry chunk got from 2.75 MB to ~1.5 MB

- `vite.config.ts` pins `react`/`react-dom`/`scheduler` to their own
  `vendor-react` chunk (long-term cache stability across deploys).
- `three`/`@react-three/*` were already isolated automatically — nothing
  outside `Studio3D.tsx` imports `three`, and `Studio3D` is the app's one
  `React.lazy()` split point.
- `onnxruntime-web` (`src/services/Supertonic.ts`,
  `src/engines/rubberband/alignment/ctcForcedAligner.ts`) now loads via a
  dynamic `import()` on first actual use instead of a static top-level
  import, so Rollup gives it its own async chunk (`ort.bundle.min-*.js`,
  ~575 KB) instead of folding it into the entry.
- The RBS import/export surface (`src/importers/rbs/**`, ~9K lines) is no
  longer statically imported from `useSongStorage.ts`; `exportRbsToFile()`
  dynamically imports it, and `RbsImportModal` (which does its own static
  import of the parser) is now behind `React.lazy()`.
- The AI-song importer is reachable only from `useAISongModal.ts`, so making
  `AISongModal` lazy already isolated it — no source change needed there.
- `xmExport.ts`/`xm_save_lib/**` (XM export) is now dynamically imported
  inside `handleExportXM()` instead of statically imported by
  `useSongHandlers.ts`.
- `CloudLibrary`, `AISongModal`, `RbsImportModal`, `ExportModal`,
  `VoiceEditor`, `ShortcutsHelp`, `MidiMapPanel`, `GamepadDebugger`, and the
  `?visual-review` dev view are all `React.lazy()` + `Suspense` in
  `src/App.tsx`, mounted only while their `isOpen`/toggle condition is true
  (matching the unmount-on-close pattern those components already used) so
  the dynamic `import()` fires on first open, not on app boot.

**Gap to the aspirational 900 KB entry target:** not closed. The remaining
~1.5 MB is core, always-visible sequencer/synth-panel UI and engine code
(`PhonemePainter`, `SamplerVoicePanel`, the `note-selector/Synth*Effects`
panels, `HardwareKnob`/`KnobGPUContext`, `Open303Manager`, etc.) — a long
tail of legitimately-core modules, not one droppable outlier. Closing the
rest of the gap needs component-level work (e.g. lazy-loading inactive
`note-selector` effect tabs), not another import-graph fix, and was left for
a follow-up.

### Image assets

`src/components/assets/knob-bezel.png` (860 KB) and `public/osc/*.jpg`
(~2.6 MB total) were converted to WebP (`knob-bezel.webp` 31.7 KB;
`public/osc/*.webp` ~530 KB total) — visually lossless at their display
size. `CppPanel.tsx`'s `<img>` also got `loading="lazy" decoding="async"`.
Note: only `OSCILLATOR_PANEL_IMAGES.cpp` is actually referenced from code —
the other eight `public/osc/*.webp` entries (plus the unreferenced
`dwgs.webp`) are dead weight shipped either way; left in place since
deleting unreferenced assets was out of scope here.

### Source maps

`vite.config.ts`'s `build.sourcemap` already defaults to `false` (opt in via
`HYPHON_SOURCEMAP=1`/`'hidden'`) — no change needed for this pass.

---

Hyphon monitors per-worklet `process()` wall time on the audio rendering thread and
aggregates a **master budget** (% of each 128-sample quantum consumed across all
instrumented worklets). When the budget exceeds **80%**, features are disabled in a
fixed order until headroom recovers below **60%** (hysteresis).

## Instrumented worklets

| Worklet ID   | Processor              | Telemetry key |
|--------------|------------------------|---------------|
| Sequencer clock | `clock-processor`   | `clock`       |
| TB-303       | `open303-processor`    | `open303`     |
| Rubber Band  | `RubberBandProcessor`  | `rubberband`  |
| Vocoder STFT | `vocoder-processor`    | `vocoder`     |
| Master loudness | `master-loudness-processor` | `masterLoudness` |

Metrics are throttled to the main thread at ~10 Hz via `MessagePort` (`worklet-perf`
messages). Underruns are counted when `process()` wall time exceeds the quantum
duration for a block.

## Master budget

```
masterBudgetPercent = min(100, Σ workletCpuPercent)
```

All worklets share the same audio rendering thread; their CPU costs add within each
quantum.

## Master loudness / true-peak limiter

`master-loudness-processor` runs the BS.1770-5 meters and the true-peak limiter for
the single stereo master pair (post-panner, pre-destination). Measured cost of one
128-frame quantum — limiter plus meter, the same code path the worklet runs — is
**~0.35 ms**, i.e. **~13 % of the 2.67 ms budget** at 48 kHz. The figure comes from
the `audio-thread budget` case in
`src/audio/loudness/__tests__/exportLoudness.perf.test.ts` (perf tier), which enforces
a **0.5 ms functional ceiling** and a **median-vs-baseline regression** policy (see
[Test tiers](#test-tiers) below).

Where the cost goes: the limiter detects inter-sample peaks at 8× and the meter at
4× (ITU minimum), so each frame costs ~384 FIR taps per channel. Two knobs exist if
this budget ever needs reclaiming, in order of preference:

1. drop the limiter's detection to 4× (costs ~0.2 dB of ceiling accuracy on
   near-Nyquist transients, which the internal headroom already absorbs);
2. move the DSP to a SharedArrayBuffer-backed worker — deliberately **deferred**,
   since a single stereo pair does not justify the lock-free ring buffers and the
   COOP/COEP-safe, zero-network posture is easier to keep inside one worklet.

Bypassing the limiter (`enabled: false`) makes the stage a near-free pass-through,
but the meters stop as well.

## Glitch detection

The HUD / session report also tracks:

1. **AudioContext state** — non-`running` transitions (interruptions)
2. **Output latency spikes** — jumps ≥ 20 ms between polls
3. **Artifact detector** — `artifact-detected` and elevated `artifactRate` from
   `artifact-detector-processor` (when wired)

## Live high-fid 303 voice gate (Phase-L1)

The `live-highfid` voice runs the diode-ladder DSP inside `open303-processor`.
It carries its **own** gate, separate from the master ladder below: the master
ladder sheds global features when the *sum* of worklets overruns, while this
gate sheds a single voice that is individually too expensive.

| Signal | Default | Action |
|--------|---------|--------|
| Rolling CPU (EMA) ≥ 60 % of the quantum for 24 consecutive blocks | ~64 ms @ 48 kHz | Fall back to Stock Open303 |
| ≥ 8 blocks over 100 % of the quantum inside a 200-block window | — | Fall back to Stock Open303 |
| First 32 blocks after activation | — | Ignored (JIT / cache warm-up) |

The gate trips once per session and posts `live-highfid-degraded` to the main
thread, which records `liveHighFid*` telemetry, raises a degradation banner, and
shows `stock (degraded)` in the Engine HUD's **Live 303 path** section.
Implementation: `src/audio-worklets/liveHighFid303.ts`; details in
[303-realtime-highfid.md](audio-engine/303-realtime-highfid.md).

Stock voices never enter this path — the WASM instance is created lazily on
first selection of the live voice.

## Auto-degrade order

Applied **one step at a time** when `masterBudgetPercent ≥ 80`. Recovered **one step
at a time** (reverse order) when `masterBudgetPercent ≤ 60`.

| Step | ID                  | Action                                      | Rationale                          |
|------|---------------------|---------------------------------------------|------------------------------------|
| 1    | `spectral-pan`      | `spectralPanDepth × 0` (global multiplier)  | Main-thread-adjacent, high STFT cost |
| 2    | `granular-quality`  | Rubber Band `setStretchProfile: fast`         | Largest sustained worklet savings  |
| 3    | `vocoder-stft`      | Vocoder bypass (`setPerfBypass`)            | STFT overlap-add is expensive      |
| 4    | `webgpu-knobs`      | Dispatch `hyphon-perf-degrade` → CSS knobs  | GPU scope still runs on rAF thread |

Implementation: `src/utils/performanceBudget.ts` (`DEGRADE_ORDER`).

## HUD & export

- Toggle HUD: **Ctrl+Shift+E** or `?hud=1`
- **Download Report** / **Copy JSON** include `runtime` block (budget, underruns,
  glitches, per-worklet CPU, offline 303 oversample/threads/latency)
- Dev console: `window.__devtools.exportEngineReport()` when `?devtools` or dev build

## Offline 303 rendering (does not affect audio-thread budget)

Heavy offline jobs (freeze, export, multisample, 4× oversampled 303, and
high-fid CPU/GPU authenticity tiers) run on a **worker pool** /
`WebGpu303Engine` (`src/audio/OfflineRenderer.ts`). Telemetry fields:

| Field | Meaning |
|-------|---------|
| `offlineRenderOversample` | Last render factor (`1` / `2` / `4`) |
| `offlineRenderThreadCount` | Worker / OpenMP thread hint used |
| `offlineRenderLatencyMs` | Wall-clock latency of last offline render |
| `gpuRenderLatencyMs` / `gpuReadbackBytes` / `gpuUsedGpu` | GPU high-fid path (Phase-3) |
| `gpuFallbackReason` | Why GPU fell back to `highfid-cpu` (null if GPU used) |

These are shown in Engine HUD under **Offline 303**. They never feed
`masterBudgetPercent` — only AudioWorklet `process()` cost does. The live
diode-ladder voice *does* feed it: it renders inside `open303-processor` and is
reported under the `open303` worklet key, plus its own `liveHighFid*` fields.

See [OFFLINE_303_OVERSAMPLE.md](audio-engine/OFFLINE_303_OVERSAMPLE.md),
[303-gpu-highfid.md](audio-engine/303-gpu-highfid.md) and
[303-realtime-highfid.md](audio-engine/303-realtime-highfid.md).

## Synthetic stress test

`src/__tests__/workletPerf.test.ts` drives `WorkletPerfReporter` with an artificial
slow `process()` loop and asserts the underrun counter increments.

## React render budget (UI thread)

Unlike the audio-thread budgets above, this section tracks **main-thread React
re-render fan-out** — how many times the app's top-level UI regions
(`TransportHeader`, `BottomBar`, `RackNode`, `SequencerNode`, `KeyboardNode`) get
called by React while the user edits a pattern.

### Why this exists

`useAppState()` (`src/hooks/useAppState.tsx`) composes ~25 sub-hooks into one
~835-line hook and returns a single flat object, which `AppStateContext`
(`src/contexts/AppStateContext.tsx`) hands to `React.createContext` unmemoized.
Because that object is a fresh reference on every render of `AppStateProvider`,
**every** component that reads anything off `useAppStateContext()` re-renders on
**every** state change anywhere in the app — a knob turn, a step toggle, a
transport tick — regardless of which field it actually reads.

`useAppState.tsx`'s module doc and the stores under `src/stores/` (e.g.
`uiModalsStore.ts`) describe the fix: split the mega-context's surface into
external `useSyncExternalStore`-backed slice stores (the same pattern already
used for `automationStore`, `midiMapStore`, `transportSyncStore`, etc.) that
components can subscribe to directly, bypassing the shared context entirely for
the fields they need.

### Baseline: full 32-step edit pass

`src/__tests__/appRenderBudget.test.tsx` mounts the real `<App/>` and performs
32 sequential `handleStepToggle` calls — one full pass over a track's steps,
each its own commit (not batched together), matching a real step edit, a MIDI
event, or a recorded step. Each region is `React.memo(fn)`; the test patches
`.type` on that same singleton object so the real render function still runs
— subject to memo's prop-equality bailout and the region's own
`useAppStateContext()`/store subscriptions — with only the call itself also
counted. (An earlier version of this test replaced each region with a stub
component instead; that measured whether `App` re-renders and passes a new
element, not whether the real region actually re-renders, so a future fix
that stopped `App`'s cascade without also fixing a region's own context
subscription could have passed unnoticed. Patching `.type` avoids that gap.)

| Metric | Value |
|--------|-------|
| Regions instrumented | `TransportHeader`, `RackNode`, `SequencerNode`, `KeyboardNode`, `BottomBar` (5) |
| Edits per pass | 32 (one per sequencer step) |
| **Measured baseline (this PR)** | **128 renders**: `TransportHeader`, `RackNode`, `SequencerNode`, `BottomBar` re-render on all 32 edits (4 × 32 = 128); `KeyboardNode` renders **0** times |
| Enforced budget | ≤ 145 renders (small headroom over the measured baseline) |

`KeyboardNode` already sits at 0 because it takes its props from `App`
instead of reading `useAppStateContext()` itself, and none of those props
(`selectedTrack`, the keyboard/drum-pad handlers) change for a step edit —
`React.memo`'s prop-equality bailout does the rest. It's a preview of what
the other four regions look like once they've made the same move: they still
read the shared context directly and re-render on every edit regardless of
whether they use `pattern`. This is **today's starting point, not a
target**: the budget exists so a future change can't make fan-out *worse*
without failing CI, while each migration phase below should drive the
measured number down toward `KeyboardNode`'s 0.

`src/stores/uiModalsStore.ts` is the first slice moved off the mega-context (the
`is3DMode` flag `TransportHeader`, `RackNode` and `App` now read directly via
`useUIModalsStore(selector)` instead of `useAppStateContext()`).
`src/__tests__/uiModalsStore.renderIsolation.test.tsx` locks in that this slice
is fully isolated: a component subscribed only to the store does not re-render
on a pattern edit. `TransportHeader`/`BottomBar`/`RackNode` don't reach 0 in the
32-step budget yet because they still read most of their other fields off the
shared context — that requires the remaining migration phases (transport/mix,
sampler banks, pattern edit, instrument state, session/song) described in
`useAppState.tsx`'s module doc, each landing as its own PR.

### Test tier note

`appRenderBudget.test.tsx` and `uiModalsStore.renderIsolation.test.tsx` live in
the **unit** tier (`test:unit`), not `test:perf`: mounting `<AppStateProvider>`
pulls in `useAudioEngine`, which imports real `.wasm?init` modules that only the
unit tier's Vite config stubs out (`vitest.unit.config.ts`'s
`wasm-stub-resolve` plugin). The perf tier intentionally does *not* stub WASM —
`exportLoudness.perf.test.ts` and `wasmMigration.bench.test.ts` need the real
modules to produce meaningful timings — so adding the stub there would corrupt
those benchmarks. Render-count assertions are deterministic (no wall-clock
sampling needed), so the unit tier is the right home for them regardless.

## Test tiers

Hyphon splits Vitest into tiers so PR gates stay fast and deterministic while
heavier checks run in follow-up jobs.

| Tier | Command | What it covers |
|------|---------|----------------|
| **Unit** | `pnpm run test:unit` | Pure logic, DOM with mocks, strict fetch guard (no real HTTP) |
| **Integration** | `pnpm run test:integration` | Generated WASM/emcc glue, baseline WAV fixtures, Python 303 metrics |
| **Perf** | `pnpm run test:perf` | Wall-clock benchmarks — warm-up, median samples, baseline regression |
| **Native** | `pnpm run test:native` | Host C++ 303 LEVEL sweep (`emscripten/tests/`) |
| **E2E** | `pnpm run test:e2e` | Playwright browser behaviour |

### Functional invariants vs environment-sensitive benchmarks

| Category | Examples | Gate |
|----------|----------|------|
| **Functional invariants** | LUFS parity ±0.1 LU, non-finite sample checks, authenticity thresholds | `test:unit` / `test:integration` |
| **Environment-sensitive benchmarks** | Master loudness quantum median, WASM migration speedup ratios, offline `latencyMs` ceilings | `test:perf` / scheduled `test-perf.yml` |
| **Native host** | TB-303 LEVEL sweep across realtime voices | `test:native` |

### Perf policy (`test:perf`)

- **Warm-up:** 200 iterations (master loudness) / 10 (WASM migration benches)
- **Samples:** 7–11 timed runs; report **median** and p95
- **Regression:** `median <= baseline.medianMs * 1.25` when a baseline JSON exists under `src/test/perf-baselines/`
- **Isolation:** single fork, `fileParallelism: false`
- **Artifacts:** `perf-summary.json` uploaded from scheduled / `perf`-labeled PR workflows

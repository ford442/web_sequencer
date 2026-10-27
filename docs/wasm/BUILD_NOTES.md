# WASM Build Notes

Covers `public/hyphon_native.wasm` (Emscripten: Open303 / JC303 / Prophecy /
HighFid303 / analog drumkit / macro), `public/rubberband.wasm`, the offline
`public/mix_bus.wasm`, and the AssemblyScript modules under `assembly/`.

- [Build profiles](#build-profiles)
- [Toolchain pin](#toolchain-pin)
- [Render parity (the wasm-side gate)](#render-parity)
- [Sizes: 3.1.51 `-O1` → 6.0.9 `-O3 -flto`](#sizes)
- [Module split](#module-split)
- [Offline mix bus](#mix-bus)
- [Plaits sources (macro voices)](#plaits-sources)
- [Which engine renders a basic wave](#basic-wave-engines)
- [Four Worlds memory budget](#four-worlds-memory-budget)
- [`-ffast-math`](#fast-math)
- [wasm-opt / link optimisation](#wasm-opt)
- [Export surface + export map](#export-surface)
- [Worklet import table](#worklet-import-table)
- [AssemblyScript browser matrix](#assemblyscript-browser-matrix)
- [Standalone JC-303 memory budget](#standalone-jc-303-memory-budget)
- [Pyodide + the CSP boot path](#pyodide-csp)
- [Appendix: Rubber Band integration notes](#appendix-rubber-band-integration-notes)

---

## Build profiles

```bash
pnpm run build:emcc          # release (default)
pnpm run build:emcc:debug    # debug
pnpm run build:wasm:rubberband   # the separate Rubber Band module
pnpm run vendor:pyodide          # same-origin Pyodide runtime (setup, not build)
pnpm run build:native        # every world
pnpm run build:native:changed
pnpm run check:native        # fail closed + print the targeted rebuild command
pnpm run dev:fast            # preflight then Vite — no native compile when hashes match
bash emscripten/build.sh debug
HYPHON_BUILD_PROFILE=debug bash emscripten/build.sh
```

### Command layers

| Script | What it does |
|---|---|
| `build:web` | `tsc -b` + Vite using already-built artifacts. No JS source maps. |
| `build:web:debug` | Same with `HYPHON_SOURCEMAP=1`. |
| `build:native` | Rebuild AssemblyScript, Rust, standalone JC-303, and `hyphon_native`. |
| `build:native:changed` | Content-hash incremental; only stale/missing worlds. |
| `check:native` | Preflight only. |
| `build:release` | Native + `check:exports --glue` + web + `dist/native-artifacts.json`. |
| `dev` | Full native then Vite (first run). |
| `dev:fast` | `check:native` then Vite. |

Stamps live in `.cache/native/stamps.json` (gitignored). The generated inventory is `.cache/native/native-artifacts.json`, copied to `dist/native-artifacts.json` after Vite. Schema: `docs/schemas/native-artifacts.schema.json`.

There is no separate optimisation step: the release link runs the pinned emsdk's
own `wasm-opt` in-band (see [wasm-opt](#wasm-opt)). `tools/optimize.sh` is gone.

| | release | debug |
|---|---|---|
| Compile | `-O3 -funroll-loops -flto` (IEEE math, no `-ffast-math`) | `-O1 -g3 -fno-omit-frame-pointer` |
| Link | `-O3 -flto` | `-O1 -g3 -gsource-map` |
| Assertions | `-s ASSERTIONS=0` | `-s ASSERTIONS=2` |
| Stack checks | off | `-s STACK_OVERFLOW_CHECK=2` |

Shared by both profiles: `-msimd128`, `-std=c++17 -fno-exceptions -fno-rtti`,
`-s ALLOW_MEMORY_GROWTH=1`, `-s EXPORT_ES6=1`, `--no-entry`, `-lexports.js`.
No `--bind` (there is no embind surface — every caller uses the C exports) and no
`WASM=1` / `WASM_BIGINT=1` (6.x defaults). `-lexports.js` links no code; it is
emcc's documented switch for keeping wasm import/export **names** unminified at
`-O2+`, which the hand-instantiating worklets rely on (see
[Worklet import table](#worklet-import-table)). Threading is per *threading
profile*, not per build profile — every `build.sh` run emits both, see
[Threading profiles](#threading-profiles).

<a id="toolchain-pin"></a>
### Toolchain pin

**One place:** `emscripten/toolchain.json#emscripten.version` (**6.0.9**).

- Every em++ script — `build.sh`, `build_rubberband.sh`, `build_mix_bus.sh`,
  `tools/build_jc303_omp.sh` — sources `emscripten/toolchain_env.sh`. It accepts an
  `emcc` already on `PATH` whose `-dumpversion` matches, otherwise tries
  `$HYPHON_EMSDK` and the usual emsdk checkouts, and **exits 1** naming what it
  found when none matches. A mismatched compiler used to build silently.
  `HYPHON_ALLOW_UNPINNED_EMCC=1` builds anyway, loudly; do not ship that.
- Every workflow that installs emsdk (`ci.yml`, `303-quality-benchmarks.yml`,
  `playwright-e2e.yml`, `test-perf.yml`) reads the field with `jq` and passes it to
  `setup-emsdk` and its native cache key. `.jules/setup.sh` reads it too.
- `scripts/native-worlds.mjs` hashes `toolchain.json` + `toolchain_env.sh` into
  every em++ world, so moving the pin rebuilds all four of them.
- `src/__tests__/wasmCompileFlags.test.ts` fails if a workflow hard-codes a version
  or a build script sources `emsdk_env.sh` directly.

To bump: change the field, rebuild (`pnpm run build:native`), then run the
[render-parity](#render-parity) gate before committing the new export maps.

<a id="render-parity"></a>
### Render parity (the wasm-side gate)

`pnpm run test:native` and `scripts/generate_303_baselines.sh` compile the DSP
with the **host** `g++`, so they cannot see anything em++, LTO or `wasm-opt` do to
the shipped binary. `tools/render_hyphon_native_parity.mjs` renders through the
built wasm the way the worklets do (no glue, hand-built imports, export map):

```bash
P=tools/render_hyphon_native_parity.mjs
node $P render --wasm public/hyphon_native.st.wasm --map public/hyphon_wasm_export_map.st.json --out /tmp/new
node $P compare /tmp/old /tmp/new             # bit-for-bit vs a previous build
node $P baselines /tmp/new --max-lsb 1        # vs docs/audio-engine/303-baseline/*.wav
node $P heap --wasm … --map …                 # heap high-water (memory budget evidence)
```

It renders the canonical Phase-0 pattern through every open303-family model,
jc303 and highfid-cpu (4×), plus a Prophecy phrase and both drum kits.

**Result of the 3.1.51 `-O1` → 6.0.9 `-O3 -flto` move (2026-10-13):** all 12
renders are **bit-identical** between the old and new ST builds and between the new
pthread and ST builds. Against the committed host-g++ baselines both the old and
the new binary sit at **≤ 1 LSB (24-bit)** on every voice — the same samples
differ by the same amount, i.e. LTO moved nothing. No TU had to be excluded from
LTO and no threshold was touched. (Without `-ffast-math` the compiler may not
reassociate floating point, and wasm has no implicit FMA contraction, so this is
the expected outcome rather than luck.)

<a id="sizes"></a>
### Sizes: 3.1.51 `-O1` → 6.0.9 `-O3 -flto`

Release build, same sources (#1341's `audio_dsp.cpp` removal already applied to
both columns), bytes:

| Artifact | 3.1.51, `-O1` link, embind, `main()` | 6.0.9, `-O3 -flto`, no embind / `main()` | Δ |
|---|---:|---:|---:|
| `hyphon_native.wasm` (pthread) | 215,818 | 137,625 | −36.2 % |
| `hyphon_native.st.wasm` | 195,208 | 124,088 | −36.4 % |
| `hyphon_native.js` (glue) | 99,498 | 27,010 | −72.9 % |
| `hyphon_native.st.js` (glue) | 84,924 | 14,509 | −82.9 % |
| `hyphon_native.worker.js` | 5,195 | — (inlined) | |

Intermediate data point — 6.0.9 with the *old* flags (`-O1`, embind, `main()`):
158,266 / 138,935 wasm, 118,574 / 65,545 glue. So roughly half of the wasm saving
is the compiler, half is `-O3` + LTO + dropping embind. `dist-budget.json` carries
the new numbers.

**Macro voices (2026-10-19).** Linking the Plaits DSP (24 models, its wavetables
and LUTs) grows the module; same flags, bytes:

| Artifact | before | with `macro-*` | Δ |
|---|---:|---:|---:|
| `hyphon_native.wasm` (pthread) | 134,186 | 357,536 | +218 KiB (59 → 182 KB gzipped) |
| `hyphon_native.st.wasm` | 121,286 | 343,980 | +217 KiB |
| `hyphon_native.js` (glue) | 26,979 | 28,427 | +1.4 KB (the new export names) |
| `hyphon_native.st.js` (glue) | 15,127 | 16,575 | +1.4 KB |

That is under the 250 KB go/no-go the family was given, so it ships inside
`hyphon_native` rather than as its own module ([macro-voices.md](../audio-engine/macro-voices.md#measurements-p0)).
The `dist-budget.json` native rows were raised to ~5 % above these in their own
commit.

### Threading / OpenMP: the single source of truth

Nothing in the repo uses OpenMP any more, and the committed `emscripten/libomp.a`,
`omp.h` and `openmp_patches.sh` are deleted. Until #1341, `audio_dsp.cpp` was linked
together with `libomp.a`, but because `-fopenmp` was never passed, `_OPENMP` was
undefined, every `#pragma omp` was dead, and the archive never contributed an object
(no `__kmpc_*` symbol was ever in the binary). The standalone JC-303 "threaded"
variant (`tools/build_jc303_omp.sh`, name kept for its callers) linked `libomp.a`
too, but `jc303_wasm/src` has no OpenMP pragma either; it is plain `-pthread` now.
The pthread pool exists for Emscripten's own runtime work. Rubber Band is a separate
module and is built `-DNO_THREADING` — it runs single-threaded inside the worklet.
Comments elsewhere that describe Rubber Band as OpenMP-parallel are stale; this
section is authoritative.

`tools/check_hyphon_st_module.mjs` fails the build if `__kmpc_*` / `KMP_AFFINITY` /
`OMP_NUM_THREADS` (libomp), `_embind_*` / `_emval_*` (embind) or
`emscripten_run_script` appear anywhere in either voice wasm — a byte scan that sees
the same import / export / name-section strings `wasm-objdump -x` lists, plus the
runtimes' own data strings, without needing wabt on the runner.

The pinned 6.x emcc inlines pthread workers into the glue; there is no
`*.worker.js` to ship, cache or precache, and the stamp shim that used to fake one
(`scripts/ensure-pthread-worker-stamp.mjs`) is gone.

<a id="threading-profiles"></a>
### Threading profiles: pthread and single-threaded (ST)

Every `emscripten/build.sh` run links the voice sources **twice**, into separate
object directories (pthread objects carry the atomics feature and cannot be linked
into a non-pthread module):

| | pthread | single-threaded (ST) |
|---|---|---|
| Artifacts | `public/hyphon_native.{js,wasm}` | `public/hyphon_native.st.{js,wasm}` |
| Export map | `public/hyphon_wasm_export_map.json` | `public/hyphon_wasm_export_map.st.json` (byte-identical) |
| Threading | `-pthread -s PTHREAD_POOL_SIZE=4` | none |
| Memory | imported, `shared: true` — budget key `hyphonNative` | imported, plain `ArrayBuffer` — budget key `hyphonNativeSt` |
| Sources / exports | voices only, `--no-entry` | identical |
| Link opt | `-O3 -flto` (see [wasm-opt](#wasm-opt)) | identical |

Since the [Pyodide split](#pyodide-split) the two profiles differ **only** in
threads and memory.

Both builds get the full `wasm_export_manifest.json` check against their own glue
and binary. The ST glue quotes its export assignments with `'`, which
`tools/extract_wasm_export_map.mjs` and `parseHyphonGlueExportMap` both parse.
`tools/check_hyphon_st_module.mjs` then parses the ST import section and fails the
build if the memory import is shared or any pthread/worker import slipped in.
`check:native` lists both builds' outputs under the `emcc` world, and
`scripts/check-release-dist.mjs` repeats all of these checks against `dist/`.

**Which one loads.** `src/engines/hyphonNativeVariant.ts` decides once per
AudioContext, and every Open303 / Prophecy voice on that context follows. They
share one instance (`hyphonNativeSession.ts`), so a context cannot mix builds:

1. `Open303Config.forceSingleThreaded` → ST
2. WebKit (Safari / Playwright WebKit) → ST
3. not `crossOriginIsolated`, or no `SharedArrayBuffer` → ST
4. otherwise → pthread

`FallbackBassSynth` (JS) runs only when the chosen module fails to fetch,
instantiate or report ready. The Engine HUD's "Voice WASM heap → Build" row and the
`open303` / `prophecy` telemetry resolution (`wasm-native` vs `wasm-native-st`)
name the build that actually loaded.

**ST memory budget — measured.** Release ST build under Node (2026-09-14): 3×
Open303 at 4× oversample, 3× JC303, 3× live high-fid at 2×, and 2× Prophecy, at
192 kHz with 4096-frame blocks, peak about **2 MB** of heap above the 1 MB
stack + data. Re-measured 2026-10-13 on the 6.0.9 `-O3 -flto` build with the drum
kit added (`render_hyphon_native_parity.mjs heap`): 0.45 MB of voice heap, 1.47 MB
high-water. `initialMemoryMb: 16` is 8× the older, larger figure. Because the memory is not
shared, growing toward the 512 MB ceiling is an ordinary buffer grow, not a new
SharedArrayBuffer reservation.

**WebKit evidence.** In a standalone AudioWorklet probe on Playwright WebKit 26.5
(v2311) and Chromium, `hyphon_native.st.wasm` instantiates with plain memory,
renders Open303 at the same peak as the pthread build and runs Prophecy, with
and without COOP/COEP. The same probe also instantiated the **pthread** module
inside the WebKit worklet without error. So the historical WebKit abort is not
reproduced by the raw pthread module in a worklet; the main-thread Emscripten
glue that `src/main.tsx` used to instantiate was the more likely trigger, and
nothing instantiates it on the main thread any more (see
[Pyodide split](#pyodide-split)). ST is still the WebKit choice
because it removes shared memory and the pthread runtime from the worklet
entirely.

**Standalone `public/jc303*`.** Still built and still the fourth world. Retire it
only once ST plus the shared heap are proven on WebKit end to end (tracked in the
issue, not done here).

---

<a id="module-split"></a>
## Module split

`hyphon_native.wasm` is the **voice** module: Open303, JC303, Prophecy,
HighFid303, the analog drumkit and the macro voices. Neither Rubber Band nor
the offline [mix bus](#mix-bus) is in it.

### Why Rubber Band moved out

Two independent reasons, one of which is simply that it was never used there:

1. **Nothing called it.** `src/audio-worklets/rubberband-processor.ts` and
   `sustain-processor.ts` instantiate `createRubberBandModule()` — the glue from
   `emscripten/build_rubberband.sh` — and fetch `public/rubberband.wasm`. The
   embind `RubberBandStretcher` class linked into `hyphon_native` had no caller in
   the app at all. `main.cpp` and `audio_dsp.cpp` never referenced Rubber Band.
2. **It shared a heap with live playback.** The finer-engine stereo stretch is
   ~40 MB, the largest single transient in the app. Inside `hyphon_native` that
   transient could force the *voice* module to grow while 303s were sounding —
   `ALLOW_MEMORY_GROWTH` on a `shared: true` memory is not free at audio rate.
   Separate modules mean separate heaps: a stretch cannot move the voice heap.

| Module | Built by | Memory | Imported memory? |
|---|---|---|---|
| `public/hyphon_native.wasm` | `emscripten/build.sh` | `wasm_memory_budget.json#hyphonNative` | **yes** — the worklets pass one in, so `initial` must match exactly |
| `public/rubberband.wasm` | `emscripten/build_rubberband.sh` | `wasm_memory_budget.json#rubberband` | no — the module owns its memory |
| `public/mix_bus.wasm` | `emscripten/build_mix_bus.sh` | `#mixBus` — fixed, never grows | no — owns it, zero imports |
| `public/jc303-*.wasm` | `tools/build_jc303_omp.sh` | `#standaloneJc303` | no |
| `src/wasm/*.wasm` | `asc` (see the AS matrix) | `#assemblyScript` (pages) | no |

Each has exactly one imported-memory contract, and no script carries memory
literals — every one reads the budget JSON. `src/__tests__/wasmMemoryBudget.test.ts`
enforces both.

<a id="offline-vocal-host"></a>
### Offline vocal host: a second Rubber Band instance (V2)

Freeze and stem export of a stretch-mode sampler bank
(`src/audio/offline/vocal/offlineVocalHost.ts`) host Rubber Band the way live
does: `SingingVoiceManager` voices on the export's `OfflineAudioContext`, each
loading the same `RubberBandProcessor` worklet and sent the same `INIT_WASM`
with the `rubberband.wasm` bytes. That is a separate AudioWorkletGlobalScope,
so every offline voice has **its own module instance and heap** — not the live
voices' and never `hyphon_native`'s. Nothing about the build changed:
`emscripten/build.sh` has no Rubber Band sources and
`tools/check_wasm_export_map.mjs` still finds no `rubberband` export in
`hyphon_native.wasm`. If the module cannot load offline the bank is reported
unsupported and its stem is left out, never replaced by the dry phrase. WebKit
is reported unsupported up front, as the live engine skips the worklet there.

It is not in `src/workers/renderer.worker.ts`: browsers do not run an
`AudioWorklet` (and Chromium no `OfflineAudioContext`) inside a dedicated
worker, and the live processor is a worklet. The offline context's worklet
thread is already off the main thread.

`build_rubberband.sh` also grew the things it was missing: an `emsdk_env.sh`
search matching `build.sh`, the correct repo-root source path (it used to look
for `emscripten/rubberband/`, which does not exist), release/debug profiles, and
patching a **copy** of the submodule rather than the checkout — its two `sed`
fixes are not idempotent and were dirtying `rubberband/`.

<a id="vocal-fx"></a>
### Singing-voice FX live in the Rubber Band module

`emscripten/rubberband_fx.{h,cpp}` link into `public/rubberband.wasm` next to the
stretcher: 3-band spectral compressor, freeze granulator (velocity-scaled jitter,
spiral-LFO pan spread, consonant time smear, table-lookup windows), vocal chorus, sub
harmonics, consonant transient shaper and transient extractor, phoneme tone / syllable
filters, trance gate, drum duck (gain + 350 Hz dynamic EQ) and bitcrusher. The
transient stages and time smear arrived on `main` as TS worklet code (#1303, #1314,
#1318, #1336) while #1273 was open and were ported in ABI 3. They are not in `hyphon_native`, and they do not share the 303 heap.
Same flags as the stretcher: `-msimd128`, `-DNO_THREADING`, no `-ffast-math`.

- **API.** `rb_fx_create` / `rb_fx_params` (a block of `RB_FX_PARAM_COUNT` doubles) /
  `rb_fx_render_grains` / `rb_fx_process(handle, ioL, ioR, n)` / `rb_fx_destroy`.
  `rubberband-processor.ts` only schedules: it fills the param block, copies 128
  frames in and out, and feeds the granulator output to the stretcher.
- **Oracle and fallback.** The TS modules in `src/audio-worklets/rubberband/` are the
  golden reference (`src/__tests__/nativeVocalFx.integration.test.ts`) and the
  fallback when the exports are missing. That fallback is reported as a `vocal-fx`
  degradation and is never silent. `?vocalFx=ts` pins the TS chain for A/B testing.
- **Spectral path.** One crossover split and one compressor per band, in both chains.
  The unregistered `spectralCompression` "leveler" (a second compressor on the same
  bands) was deleted from the TS oracle in #1273. The "Band Dyn" knob that wrote it
  never reached the worklet and is gone too (sampler panel and note editor); the one
  band compressor is **Spectral Comp** (`spectralComp`). `spectralEffects.test.ts`
  fails if a second stage comes back.
- **SIMD.** The stereo stages whose L/R channels share coefficients (drum-duck dynamic
  EQ, sub harmonics) run both channels in `f64x2` lanes under `__wasm_simd128__`, with
  a scalar fallback. Lane math is the same IEEE double arithmetic, so the golden test
  stays bit-exact. The mono recursive filters (crossover, tone, granulator low-pass)
  are sample-serial and stay scalar.
- **ABI drift.** `RB_FX_PARAM` in `nativeVocalFx.ts`, `RB_FX_EXPORTS` in the build
  script and `enum RbFxParam` are checked against each other by
  `src/audio-worklets/rubberband/__tests__/nativeVocalFx.test.ts`. Bump
  `RB_FX_ABI_VERSION` whenever the layout changes. The worklet refuses a mismatched
  module and falls back to TS.
- **Memory.** One stretcher, one FX chain and a 30 s vocal fit in the 64 MB initial
  heap with no growth (asserted by the integration test), so the `rubberband` budget
  is unchanged.
- **emcc 4+ glue.** `build_rubberband.sh` now declares `INCOMING_MODULE_JS_API`
  (`wasmBinary`, `locateFile`, …) and exports `HEAPF32` / `HEAPF64`. Without the
  first, the glue ignores `Module.wasmBinary` and aborts inside the AudioWorklet,
  which cannot fetch. Without the second, `module.HEAPF32` is undefined. A glue
  generated by an older emsdk worked by accident; any rebuild on emcc 6 broke both
  worklets.

---

<a id="mix-bus"></a>
## Offline mix bus

`public/mix_bus.wasm` (#1341) sums stems for stem export: the drum stem from
its four tracks, and the dry master from every audible stem. It replaced
`audio_dsp.cpp`, which was linked into the pthread voice module with no caller
(the main-thread bridge was deleted in #1229). The ST build never had it.

**Shape.** One translation unit, `emscripten/mix_bus.cpp`, built by
`emscripten/build_mix_bus.sh` as a standalone reactor (`STANDALONE_WASM`,
`--no-entry`):

- **Zero imports and no Emscripten JS glue.** `src/audio/offline/mixBus/mixBusKernel.ts`
  instantiates it directly, so nothing can drift between emcc versions.
- **Fixed, unshared memory** (`ALLOW_MEMORY_GROWTH=0`, budget key `mixBus`). It
  holds two static 64k-frame scratch blocks and the stack. Stems stream through
  the scratch one block at a time, so a long song never grows the heap. The
  whole-stem accumulator lives in the worker's JS heap.
- **Worker only.** `src/workers/mixBus.worker.ts` hosts it. It is loaded with
  `?worker&url`, and the main thread passes the wasm URL already resolved against
  the deploy base, so a `/hyphon/` deploy works. Nothing on the main thread binds
  it (`mainThreadNativeModuleGuard.test.ts`).
- **The one `-ffast-math` TU** (see [`-ffast-math`](#fast-math)). There is no
  OpenMP: block mixing is memory-bound, and the worker is not CPU-bound.

`tools/check_mix_bus_module.mjs` runs after every build and again in
`check-release-dist.mjs`. It fails a module that has any import, a shared or
growable memory, a missing export, or the wrong ABI.

**How export uses it.** `exportStemsToZip` streams each audible stem into the bus
right after it renders. The C++ sum therefore runs in the worker while the next
stem renders, not in a main-thread loop afterwards. Silenced stems are not added
at all (they are zeros). Summation order is still `STEM_RENDER_ORDER`.

**Fallback.** `createMixBus()` falls back to the in-thread JS kernel, and reports it
through `logEngineFallback('mixbus-wasm', …)` (the Engine HUD), when any of these
happens:

- there is no Worker or WebAssembly;
- the module fails to load;
- the worker does not answer within 3 s.

If the worker dies mid-export, the open sessions re-mix their retained
sources in JS, so the master is never partial. `metadata.json` and
`StemExportReport.mixBus` record which engine summed the stems, the reason for
any fallback, and the dry master's per-channel peaks.

**Numerical contract** (`src/__tests__/mixBus.integration.test.ts`, run against
the emcc 3.1.51 and 6.0.6 builds):

| | native vs JS |
|---|---|
| gain = 1 (every gain stem export uses today) | **bit-identical**. Switching engines never changes a stem. |
| other gains (future channel-strip faders) | ≤ `1e-6` per sample: an f32 multiply-add against JS's f64-then-round |
| peak | identical |

**Measured** (Node 24, x86-64, 48 kHz, 180 s, stereo):

| | JS | wasm (as shipped: streamed through the scratch) |
|---|---|---|
| 12-stem sum | ~650 ms | ~500–570 ms |
| peak, one 8.6 M-sample channel | ~100 ms | ~18 ms |

The arithmetic gain is modest, because the streaming copies dominate. The point
is that roughly 0.6 s of `+=` per export leaves the main thread and overlaps rendering.
Blocks-outer mixing with every stem resident runs at about 430 ms, but needs all stems in one
message, which doubles peak memory. That is not worth 100 ms.

---

<a id="basic-wave-engines"></a>

## Which engine renders a basic wave

**One always-on path plus one WASM wavetable engine. Not nine.** (#1294)

`src/engines/backends/engineCatalog.ts` maps every waveform prefix to exactly
one renderer, and `BackendRegistry` owns the only fallback order there is:

```
WebGPU → WASM OSC (AssemblyScript) → Pyodide → WAV PCM → JS oscillator
```

| Family | Prefix | Renderer | Kind |
|---|---|---|---|
| JS oscillator | *(none — `sawtooth`/`square`/…)* | `OscillatorNode` | graph-native, sample-accurate, **always available** |
| WASM OSC | `wam-*` | `assembly/oscillators.ts` via `WasmOscillator` | the one WASM wavetable kernel |
| WAV PCM | `wav-*` | decoded `public/assets/*.wav` | asset |
| WebGPU | `wgsl-*` | `WebGpuOscillator`, tables pre-rendered at init | offline pre-render |
| Pyodide | `pyodide-*` | NumPy/SciPy in the vendored CPython | offline pre-render |
| Open303 / JC303 | `303-*` | `hyphon_native` AudioWorklet | native worklet |
| Prophecy | `prophecy-*` | `hyphon_native` AudioWorklet | native worklet |
| Macro (Plaits) | `macro-*` | `hyphon_native` AudioWorklet, stereo, 8 voices per part | native worklet ([macro-voices.md](../audio-engine/macro-voices.md)) |

### The choice, and why

`OscillatorNode` stays the always-on path: it is graph-native, sample-accurate,
costs nothing to keep, and is the only renderer that cannot fail. Everything
below it is a *table* producer, resampled by `playbackRate`.

There is **one** WASM wavetable engine, and it is the AssemblyScript kernel
(`assembly/oscillators.ts`). It was kept over a C++ wavetable in `hyphon_native`
because it already has a validated Safari feature intersection (`simd` +
`bulk-memory`, no WasmGC — see the [AS browser
matrix](#assemblyscript-browser-matrix)) and because `hyphon_native`'s budget is
sized for *voices* — recursive filters, 303/Prophecy, analog drums — not for
basic-wave tables. Putting a wavetable there would have widened the voice heap
contract (`wasm_memory_budget.json`) for no DSP that needs it.

`wam-*` is **not** Web Audio Modules 2.0. WAM2 is a separate system
(`src/audio/wam`, ADR 0001); the UI labels this family **"WASM OSC"** and the
HUD gives WAM2 slots their own badge, so the two cannot be read as one. The
waveform ids keep the `wam-` prefix only so saved projects keep loading.

### What was removed

- **`rust-*`** — `rust-audio/src/lib.rs` produced a naive saw/square plus a
  biquad on the **main thread**, looped through an `AudioBufferSourceNode`: no
  SIMD, no worklet, and a duplicate of the AssemblyScript kernel above.
  `rust-audio/` remains as a bench crate. It is not built into the app and is
  not in the fallback order.
- **`cpp-*`** — never existed. The selector, panel and HUD copy shipped; the
  renderer did not, so selecting it silently played an `OscillatorNode`. There
  is no `CppOscillator.ts` and `src/engines/backends/__tests__/oscillatorEngineContract.test.ts`
  fails the build if one appears.

Both are rewritten onto `wam-*` by `LEGACY_WAVEFORM_ALIASES`
(`src/utils/waveformParser.ts`) so existing songs keep playing, and the rewrite
is reported through `logWaveformSubstitution` rather than applied silently.

### Rules for adding one

A new basic-wave engine needs a reason the table above does not already cover,
and then:

1. It renders **in an AudioWorklet**, or it is a documented offline/pre-render
   producer like WebGPU. A main-thread `generate()` into an
   `AudioBufferSourceNode` is not a new engine — that is the pattern #1294
   removed, and the import-graph guard rejects it.
2. It registers as an `OscillatorBackend` and appears in
   `BACKEND_FALLBACK_ORDER`. `VoiceManager` must not learn its name.
3. If it is C++, it compiles under `compile_cpp` (IEEE). Nothing in
   `hyphon_native` uses `-ffast-math`; the offline `mix_bus.cpp` is the only
   translation unit that does. See [`-ffast-math`](#fast-math).
4. If it is a worklet with imported memory, it reads
   `emscripten/wasm_memory_budget.json`, never a literal.

---

## Four Worlds memory budget

**Source of truth: `emscripten/wasm_memory_budget.json`.** `emscripten/build.sh`
reads it for `-s INITIAL_MEMORY` / `-s MAXIMUM_MEMORY` / `-s STACK_SIZE`, and
`src/audio-worklets/hyphonNativeImports.ts` mirrors it for the imported
`WebAssembly.Memory`. `src/__tests__/wasmMemoryBudget.test.ts` fails CI if the two
drift apart — this matters because the worklets instantiate the module with an
*imported* memory, so an `initial` below the module's declared minimum does not
degrade, it fails instantiation outright.

| Setting | Before | Now |
|---|---|---|
| `INITIAL_MEMORY` | 512 MB (8192 pages), then 128 MB | **32 MB (512 pages)** — measured, see below |
| `MAXIMUM_MEMORY` | unset (16384 pages in JS only) | 1024 MB (16384 pages) |
| `STACK_SIZE` | default (64 KB) | 8 MB |

### Why 512 MB was the wrong default

`ALLOW_MEMORY_GROWTH=1` was already set, so the 512 MB was never a cap — it was an
*upfront reservation*. With `shared: true` (the COOP/COEP threaded path) that
reservation is committed address space in every context that touches the module:
the main thread, each AudioWorklet global scope, and each pthread worker. On
memory-constrained mobile Safari and 4 GB Chromebooks this is a common hard
failure that looks like a COOP/COEP problem but is not — hence the improved error
in `createHyphonMemory()`, which now distinguishes "no SharedArrayBuffer" from
"SharedArrayBuffer present, this reservation was refused".

### Working budget (Four Worlds peak)

| Consumer | Steady | Peak | Notes |
|---|---|---|---|
| Emscripten runtime + static data | ~6 MB | ~6 MB | glue, wavetables (analytic; measured below: < 0.1 MB) |
| Stack (`STACK_SIZE`) | 8 MB | 8 MB | reserved; the 64 KB default is what the `__handle_stack_overflow` workaround in `open303-processor.ts` was fighting |
| 3 × Open303 / JC303 voices | ~2 MB | ~4 MB | per-instance state + oversampled scratch |
| Prophecy voice | ~1 MB | ~2 MB | |
| Analog drumkit (one handle) | ~0.5 MB | ~1 MB | kick/snare/hats share the voice module |
| 2 × macro part (8 voices each) | ~0.4 MB | ~0.5 MB | 16 KB engine RAM + ~11 KB state per voice; measured +0.52 MB peak with 16 voices sounding ([macro-voices.md](../audio-engine/macro-voices.md#measurements-p0)) |
| ~~Rubber Band stretch (finer, stereo)~~ | — | — | **moved to its own module** — see [Module split](#module-split). It was ~12 MB steady / ~40 MB peak here, and the reason a stretch could grow the voice heap mid-playback. |
| Offline/export scratch buffers | 0 | ~24 MB | `malloc`'d per render, freed after |
| Headroom / allocator fragmentation | — | ~30 MB | |
| **Total** | ~17 MB | **~74 MB** | was ~29 MB / ~114 MB with Rubber Band linked in |

That table is the analytic budget the 128 MB came from. The measurement below
replaced it.

**One heap per audio session.** This table sums every voice into a single heap,
and since `src/audio-worklets/hyphonNativeSession.ts` that is how the worklets
run: bass1 / bass2 / lead303, Prophecy A / B and any live high-fid voice all take
handles on one `hyphon_native` instance per AudioContext (they share the
AudioWorkletGlobalScope). Before that, each of the five processors instantiated
the module with its own 128 MB `shared: true` memory. The Engine HUD's
"Voice WASM heap" row reports the live heap count (expected `1`), and
`src/audio-worklets/__tests__/hyphonNativeSession.sharedHeap.test.ts` fails if a
second memory is allocated during init.

### Measured: 128 MB → 32 MB (2026-10-13)

The 128 MB was kept "until someone has a measurement". Here it is, on the 6.0.9
`-O3 -flto` pthread build, with the worst-case live voice set every worklet could
hold at once — 3× Open303 at 4× oversample, 3× JC303, 3× high-fid at 2×,
2× Prophecy and the drum kit, at 192 kHz with 4096-frame blocks, each voice having
rendered 8 blocks (`node tools/render_hyphon_native_parity.mjs heap`):

| | pthread | ST |
|---|---:|---:|
| Stack + static data (first heap address) | 8.02 MB | 1.02 MB |
| Voice heap (12 voices) | 0.45 MB | 0.45 MB |
| High-water | **8.47 MB** | 1.47 MB |

The 3.1.51 `-O1` build measures the same 0.45 MB of voice heap. Almost all of the
pthread figure is the 8 MB `STACK_SIZE`. `initialMemoryMb: 32` leaves ~23 MB of
heap — about 50× the measured voice set — before the first grow, which is still
available up to 1 GB. A quarter of the old `shared: true` reservation is what
mobile Safari and 4 GB Chromebooks fail on.

TTS/Pyodide is **not** in this budget: Pyodide is a separate WASM runtime with its
own heap (`src/pyodide/bootstrap.ts` loads it; it never shared a heap with
hyphon_native). A warm TTS adds tens of MB of *browser* memory but zero bytes of
hyphon_native heap.

### Caveat

The measurement is Node, not a device capture. On hardware:

```js
// In the page console, with 3×303 playing and a rubberband stretch running
// (they are separate heaps now — check both):
performance.measureUserAgentSpecificMemory?.().then(console.log);
// In the worklet (open303-processor), the authoritative number for this module:
console.log('hyphon heap MB', memory.buffer.byteLength / 1048576);
```

If the worklet reports growth past 32 MB during normal playback, raise
`initialMemoryMb` in the budget JSON. The test caps it at 256 MB deliberately:
going above that should be a measured decision, not a default.

---

<a id="plaits-sources"></a>
## Plaits sources (macro voices)

The `macro-*` voices compile Mutable Instruments' Plaits DSP from two pinned,
shallow submodules: `third_party/eurorack` (only `plaits/dsp` and
`plaits/resources.*` are used) and `third_party/stmlib`. Both are MIT; the
notices ship as `dist/THIRD_PARTY_NOTICES.md` and `check-release-dist.mjs`
fails a release without them.

- **Translation units** come from `tools/plaits_sources.mjs`, not a glob in
  `build.sh`: every `plaits/dsp/**/*.cc` except `voice.cc` (the wrapper carries
  its own adaptation of `Voice::Render`), `resources.cc`, and stmlib's
  `dsp/units.cc` and `utils/random.cc`. The same module lists the hash inputs
  `scripts/native-worlds.mjs` adds to the emcc world, and the CI native cache
  keys hash the same trees.
- **`-DTEST`** selects stmlib's portable C++ paths instead of the Cortex-M4
  inline assembly. It changes no DSP.
- **`-isystem`** for both trees, so upstream warnings do not drown the build log.
- **Staged, patched copy.** WebAssembly has no flush-to-zero, and Plaits' filters,
  resonators and envelopes ring down into subnormals the M4 flushed for free —
  8 modal voices cost 46 % of a render quantum before the guards.
  `node tools/plaits_sources.mjs --stage DIR` copies the hashed sources into the
  build's temp directory and applies `tools/plaits_wasm_patches.mjs`: named,
  exact-count find/replace guards that zero recursive state below 1e-15. The
  submodules stay pristine, and an upstream bump that moves a guarded line fails
  the build by patch id instead of silently losing a guard. The host test
  (`emscripten/tests/macro_offline_test.cpp`) builds the same staged copy and
  fails when any model runs > 2× (and > 30 µs) slower without x86 FTZ.
- **IEEE, like the rest of the module.** `compile_plaits` uses the profile's
  `CXXFLAGS` (the same ones `compile_cpp` uses) plus the two above; no
  `-ffast-math`.

Checkout: `git submodule update --init --depth 1 third_party/eurorack third_party/stmlib`.
A checkout without them cannot build `hyphon_native`; the host test runner skips.

---

<a id="fast-math"></a>
## `-ffast-math`

`-ffast-math` used to be a global release compile flag. It is now confined to
**one translation unit outside the voice module**: `emscripten/mix_bus.cpp`,
built by `build_mix_bus.sh` (#1341). `emscripten/build.sh` passes it nowhere.
Its previous single user, `audio_dsp.cpp`, and the `compile_cpp_fast` helper
were deleted.

### Why it was wrong globally

`-ffast-math` turns on, among others, `-ffinite-math-only` (the compiler may
assume no operand is ever NaN or Inf) and `-fno-signed-zeros`, and it permits
reassociation of float arithmetic. Applied to this codebase that hits two things:

- **Recursive filters.** The rosic Open303 / JC303 filter sections and the
  HighFid303 diode ladder feed their own output back in. Under
  `-ffinite-math-only` a NaN that does appear — a denormal flushed at a
  resonance sweep, a division by a momentarily-zero coefficient — is never
  checked for and simply latches: the voice goes silent and stays silent until
  the instance is recreated. Without the flag the same value settles.
- **Baseline comparability.** Reassociated accumulation changes results in the
  low bits. The 303 spectrogram baselines
  (`scripts/generate_303_baselines.sh`, `scripts/303_metrics_cli.py`) compare
  renders against committed references; drifting them silently is a worse
  outcome than the few percent of throughput the flag buys on this code.

### What still uses it

`mix_bus.cpp`: a multiply-add and a max-reduction over stateless `float`
blocks. It has no recursive state and no baseline contract. The accumulate is
one operation per element, so reassociation cannot reorder anything across
samples, and the max-reduction is the loop the flag lets the compiler vectorise.
At unity gain the result is bit-identical to the JS path (see
[mix bus](#mix-bus)). The **debug** profile drops the flag, so a debug build is
IEEE by construction.

`build_rubberband.sh` never enables it either: phase-vocoder accumulators and the
resampler are the same class of code as the filters above.

### Re-running the baselines

`scripts/generate_303_baselines.sh` renders with the host `g++`; it documents the
DSP, not the binary. Whether the **shipped** wasm still matches it is
[render parity](#render-parity): as of the 6.0.9 `-O3 -flto` build every voice is
within 1 LSB (24-bit) of the committed baselines, unchanged from 3.1.51.

```bash
bash scripts/generate_303_baselines.sh      # host reference WAVs + spectra
node tools/render_hyphon_native_parity.mjs baselines <render dir> --max-lsb 1
```

---

## wasm-opt

The release link is **`-O3 -flto`**, and the pinned emsdk's bundled `wasm-opt` runs
in-band as part of it. There is no out-of-band pass any more.

History: under emsdk 3.1.51, em++ at `-O2`/`-O3` ran its bundled `wasm-opt` with a
feature set that did not match this module (pthreads + SIMD + bigint) and the link
failed. The link was therefore held at `-O1` (no cross-TU inlining, no LTO), and
`tools/optimize.sh` re-ran a separately pinned binaryen 119 over the linked binary
as an opt-in step that `build:release` never ran. On 6.0.9 the in-band `-O3` link
passes on both threading profiles, so `optimize.sh`, its `optimize` script and the
`binaryen` block in `toolchain.json` are deleted.

**LTO.** Every wrapper is its own translation unit, so before this nothing inlined
across `open303_wrapper.cpp` and the rosic DSP. `-flto` on compile and link fixes
that. [Render parity](#render-parity) is the gate: the output is bit-identical to
the `-O1` build, so no TU needed excluding.

**Names stay unminified.** At `-O2+` emcc would also minify wasm import and export
names. The worklets do not use the glue, so they would have to guess
`emscripten_resize_heap` / `abort` from single letters and could not find
`__wasm_call_ctors`. `-lexports.js` keeps the names (see `tools/link.py`:
it clears `MINIFY_WASM_EXPORT_NAMES` and therefore `MINIFY_WASM_IMPORTS_AND_EXPORTS`)
while linking no code, and the export maps stay identity maps — byte-identical
between the two profiles and between any two machines on the pin.

### Why the export map is checked against the binary too

`tools/extract_wasm_export_map.mjs` parses the **glue** (`hyphon_native.js`). Any
pass that rewrote the `.wasm` without touching the glue and renamed exports would
leave `check_wasm_export_map.mjs --glue` passing while the worklets could no longer
resolve a single function. `check_wasm_export_map.mjs` therefore also takes
`--wasm`, compiles the binary, and asserts every name in the map is a real export;
`build.sh` and `build:release` pass both.

---

## Export surface

`emscripten/wasm_export_manifest.json` declares the module's contract, and is
the **only** list of it: `build.sh` passes exactly `required` + `optional` to
`EXPORTED_FUNCTIONS` via `tools/hyphon_native_exports.mjs` (#1344). Add an
export to the manifest, never to `build.sh`.

- **required** — called by shipped worklet/engine code. A build missing one is broken.
- **optional** — built, but not (yet) called by shipped code.
- **runtime** — added by Emscripten itself (pthread internals, `main`); never requested.
- anything else present is flagged as export bloat.

Engines on the shared voice core get their generic exports from
`HYPHON_EXPORT_VOICE(prefix, …)` — `prefix_create`, `_destroy`, `_init`,
`_push_event`, `_render`, `_cancel_notes` — and
`src/__tests__/wasmExportManifest.voices.test.ts` fails if any of them is
missing from the manifest. See [VOICE_CORE.md](VOICE_CORE.md).

```bash
pnpm run check:exports                                                # validate committed map
node tools/check_wasm_export_map.mjs --glue public/hyphon_native.js   # + drift check
```

CI runs `check:exports` (see `.github/workflows/ci.yml`); `build.sh` runs it with
`--glue` after every link, so a rebuild that forgets to regenerate
`public/hyphon_wasm_export_map.json` fails at build time rather than silently
shipping a stale map to the worklets. When WASM artifacts are absent the check
exits 0 with a warning, so source-only CI jobs stay green.

### Removed: legacy single-instance `jc303_*`

`jc303_noteOn/noteOff/allNotesOff`, `jc303_set{Waveform,Cutoff,Resonance,EnvMod,
Decay,Accent,Volume,FilterMode}`, `jc303_process` and the single-instance
`jc303_init(sampleRate, bufferSize)` are gone from `emscripten/jc303_wrapper.cpp`,
along with the `HYPHON_LEGACY_JC303` switch that kept them in debug builds (#1344).
`jc303_init` is now the voice core's handle-based init,
`jc303_init(handle, sampleRate, maxFrames)`.

They were never reachable in hyphon_native: `open303-processor.ts` only falls back
to that API when `open303_*` is missing, which describes the standalone
`jc303-single.wasm` artifact (`tools/build_jc303_omp.sh`), not this module — that
fallback path is unchanged. The worklet's `JC303_PARAM_MAP` message names
(`jc303_setCutoff`, …) are unaffected too: they are *message* names translated
into `open303_set_param` / `jc303_set_param` param IDs, not exports.

`highfid303_*` is kept but marked optional: the shipped realtime path does not call
it (`OfflineHighFid303Engine.ts` and the WGSL shader mirror it in TS/GPU instead).

---

<a id="worklet-import-table"></a>
## Worklet import table

AudioWorklets cannot load `hyphon_native.js` (the Emscripten glue), so
`src/audio-worklets/hyphonNativeImports.ts` builds the WASM import object.

**The table is derived from the compiled module**, not from a hand-maintained
allowlist. `buildHyphonWasmImports()` walks `WebAssembly.Module.imports()`,
keeps the explicit implementations (`emscripten_resize_heap`, `invoke_*`,
`__cxa_throw`, `emscripten_date_now`, `_emscripten_get_now_is_monotonic`, the
a–z / A–Z minified aliases, …) and installs a typed no-op stub (`() => 0`) for
every remaining `kind: 'function'` import, `console.warn`-ing once per new
symbol. Instantiation cannot fail because Emscripten grew the import section;
at worst the new symbol is inert and the log names it.

Adding an Emscripten `env` symbol therefore **does not require a source edit**.
Put a real implementation in `createEmscriptenEnv()` only when the symbol must
do something (time, heap growth, exceptions).

Guards:

- `src/__tests__/hyphonNativeImports.test.ts` synthesises a tiny module that
  imports an unknown `env` symbol and asserts instantiation + one warning
  (runs in the no-WASM `test:unit` tier).
- The same file instantiates the real `public/hyphon_native.wasm` when present.
  `HYPHON_REQUIRE_NATIVE=1` (set by the integration job and
  `vitest.setup.integration.ts`) fails if that artifact is missing, so the
  handshake cannot silently no-op in CI.

---

## AssemblyScript browser matrix

Current flags (`package.json`), one script per module:

```
--optimize --converge --optimizeLevel 3
--enable simd --enable bulk-memory
--enable threads          (oscillators only)
--initialMemory 128–384 pages
--exportRuntime --bindings esm
```

Page counts are mirrored in `emscripten/wasm_memory_budget.json#assemblyScript`
and asserted by `src/__tests__/wasmMemoryBudget.test.ts`; the feature set is
asserted by `src/__tests__/wasmCompileFlags.test.ts`.

| Feature | Chrome / Edge | Firefox | Safari | Shipped? |
|---|---|---|---|---|
| SIMD (`simd128`) | ✅ 91+ | ✅ 89+ | ✅ 16.4+ | ✅ |
| Bulk memory | ✅ | ✅ | ✅ 15+ | ✅ |
| Threads + SharedArrayBuffer | ✅ (COOP/COEP) | ✅ (COOP/COEP) | ⚠️ COOP/COEP required; historically flaky inside AudioWorklets on iOS | ✅ oscillators only |
| Reference types | ✅ | ✅ | ✅ 15+ | ❌ dropped — nothing needs it |
| Relaxed SIMD | ✅ 114+ | ✅ 120+ | ⚠️ recent only | ❌ dropped — see below |
| **WasmGC (`--target wasm-gc`)** | ✅ 119+ | ✅ 120+ | ⚠️ **the risk** — trails the others; older supported Safari refuses the module outright | ❌ dropped |

### Applied: MVP target, no WasmGC

The recommendation this file carried is now in effect. `--target wasm-gc`,
`--enable gc`, `--enable reference-types` and `--enable relaxed-simd` are gone
from every AS module.

WasmGC was the binding constraint. Nothing in `assembly/` needs GC semantics —
these are numeric DSP kernels over linear memory — so it bought nothing, while
costing older Safari *the whole module* rather than one degraded feature.

### Measured: the relaxed-SIMD dual build was not worth building

The alternative on the table was to dual-build `oscillators.wasm` (MVP) alongside
`oscillators.relaxed.wasm` and pick at load time. That was built and then
measured, and the measurement says don't:

```
$ asc assembly/oscillators.ts -o oscillators.wasm         ... --enable simd
$ asc assembly/oscillators.ts -o oscillators.relaxed.wasm ... --enable simd --enable relaxed-simd
$ sha256sum oscillators.wasm oscillators.relaxed.wasm
fca5cd6665bb553331db5e364f785b75c11eb5141d2eb9ba17d91552f6365ce0  oscillators.wasm
fca5cd6665bb553331db5e364f785b75c11eb5141d2eb9ba17d91552f6365ce0  oscillators.relaxed.wasm
```

Byte-identical. `assembly/oscillators.ts` contains no SIMD intrinsics at all —
it is scalar code — and `asc` does not invent relaxed instructions that were not
written. The "relaxed build" would have been a duplicate artifact, a second
download, and a second thing to keep in sync, for a guaranteed zero difference.

**What was kept:** `supportsRelaxedSimd()` in
`src/engines/WasmOscillator.ts` — a `WebAssembly.validate` probe on a
minimal `i8x16.relaxed_swizzle` module — and the variant-selecting retry loop in
`init()`, which currently has one candidate. The probe result is reported to
engine telemetry, so whether a relaxed kernel is worth writing can be answered
from field data instead of guessed. Adding the sibling later is a script, a world
entry in `scripts/native-worlds.mjs`, an import, and one line in `loadOrder()`.

### Loader behaviour to keep in mind

A `CompileError` from an unsupported feature surfaces at `WebAssembly.compile`,
before any worklet exists, so the fallback has to live in the engine wrapper
(`src/engines/*Oscillator.ts`), not the worklet. That is why the probe is in
`WasmOscillator.ts` and why any future variant must be a *built* artifact — a
conditional `import()` of a file the build may not have produced trades a runtime
fallback for a bundle-time failure.

---

## Standalone JC-303 memory budget

**This is not `hyphon_native`.** The live 303 path is `public/hyphon_native.wasm`.
Standalone `public/jc303-*.wasm` is still built for fallback/compat.

**Source of truth:** `emscripten/wasm_memory_budget.json#standaloneJc303`, consumed by
`tools/build_jc303_omp.sh` and `tools/jc303_cmake/CMakeLists.txt` (Hyphon-owned
overlay — the submodule `jc303_wasm/wasm/CMakeLists.txt` is not used).

| Setting | Value |
|---|---|
| `INITIAL_MEMORY` | 16 MB |
| `MAXIMUM_MEMORY` | 256 MB |
| `STACK_SIZE` (release / debug) | 4 MB / 2 MB |
| Threaded `PTHREAD_POOL_SIZE` | 4 |

These are the settings that actually shipped when CMake last-won over the
script banner that advertised 64 / 32 / 256. Raise them in the JSON if the
standalone fallback overflows; do not put a second set of literals in the
shell script.

`src/jc303-single.wasm` is a stale tracked leftover and is no longer part of
the runtime or the commit set. Generated JC-303 binaries stay in `public/`.

Contract: `src/__tests__/wasmMemoryBudget.test.ts` + `src/__tests__/jc303LinkFlags.test.ts`.

<a id="pyodide-csp"></a>
## Pyodide + the CSP boot path

ADR 0001 (WAM2 host) requires **same-origin scripts and worklets only, and no
`unsafe-eval`**. `index.html` violated both. Both are fixed, and both are guarded.

### What changed

| Was | Now |
|---|---|
| `<script src="https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js">` | vendored to `public/pyodide/`, loaded same-origin |
| `pyodide_bootstrap.js` injecting the same jsDelivr URL | same-origin, from `${BASE_URL}pyodide/` |
| `loadPyodide()` with no `indexURL` | `loadPyodide({ indexURL: base })` |
| `new Function('url', 'return import(url)')` | nothing: no `public/` script is `import()`ed any more ([split](#pyodide-split)) |

`new Function` is `eval` as far as CSP is concerned, so the old importer required
`unsafe-eval` for the whole document. It existed only to import
`public/hyphon_native.js` without Vite rewriting the URL.

<a id="pyodide-split"></a>
### Pyodide split out of `hyphon_native`

The bootstrap used to be `emscripten/pyodide_bootstrap.js`, glued onto the pthread
`hyphon_native.js` with `--post-js`, and started by an `emscripten/main.cpp` whose
only job was `emscripten_run_script("initPyodideSystem()")`. `src/main.tsx`
therefore `import()`ed and instantiated the **pthread voice module on the main
thread** — spinning up its pthread pool — just to reach Python. (Playwright WebKit
crashed doing it, which is why `main.tsx` carried a WebKit E2E stub.)

Now:

- `src/pyodide/bootstrap.ts` is a plain ES module; the engine's Python is
  `src/pyodide/hyphon_engine.py`, imported with `?raw`. `usePyodideEngine` imports
  the bootstrap lazily, so both land in their own chunk. The global contract
  (`hyphonPyodide`, `hyphonPyodideReady`, the `hyphon-pyodide-ready` / `-error`
  events) is unchanged.
- `emscripten/main.cpp` and `pyodide_bootstrap.js` are deleted; both voice
  profiles link `--no-entry` and export the same functions.
- The StartOverlay's "NATIVE MODULE" line comes from
  `src/engines/hyphonNativeProbe.ts`: it fetches the profile the first voice will
  select and `WebAssembly.validate`s it — no instantiation, and the bytes warm the
  HTTP / service-worker cache for the worklet. `mainThreadNativeModuleGuard.test.ts`
  fails if main-thread code `import()`s the glue or reads a global `Module` again.
- The inline `HYPHON_PYODIDE_BASE_URL` script in `index.html` is gone; the
  bootstrap derives the base from `import.meta.env.BASE_URL` (the global still
  overrides it).

`indexURL` matters as much as the `<script>` tag: without it Pyodide derives its
asset base from wherever its script came from and can still leave the origin.

### Vendoring

```bash
pnpm run vendor:pyodide            # ~76 MB into public/pyodide/
pnpm run vendor:pyodide -- --force # re-download
PYODIDE_BASE_URL=https://mirror/... pnpm run vendor:pyodide
```

Version and file list are pinned in `emscripten/toolchain.json#pyodide` — the same
file the Emscripten pin lives in. `scripts/fetch-pyodide.mjs` also resolves the
transitive closure of `packages` (`numpy`, `scipy` → `openblas`) from the
downloaded `pyodide-lock.json` and fetches those wheels. That is not optional:
once `indexURL` is same-origin, `loadPackage(['numpy','scipy'])` resolves against
*our* origin, so a runtime shipped without the wheels would 404 rather than
quietly fall back to a CDN — which is the point.

`public/pyodide/` is gitignored. It is a **setup step, not a build step**: no
build script runs it, because a 76 MB download does not belong in an incremental
build.

### Guards

- `src/__tests__/wasmCompileFlags.test.ts` → no remote `<script src>`, no
  `new Function` / `eval`, `indexURL` set, base derived from `BASE_URL`, and no
  main-thread `import()` of the voice glue.
- `scripts/check-release-dist.mjs` → the same two checks against the **built**
  `dist/index.html`, plus a warning when `dist/pyodide/` is empty.

### Not done here

`docs/adr/0001-wam2-host.md` can now claim same-origin + no-eval for the boot
path. It is not yet enforced by an actual `Content-Security-Policy` header —
there is no header configuration in this repo to put one in. That belongs with
the Phase B host work (#1137); this change removes the violations that would have
made such a header fail.

---

## Appendix: Rubber Band integration notes

> **Stale below this line.** This appendix is an imported enhancement-plan dump
> kept for its Rubber Band API notes. It predates the [module split](#module-split)
> and describes Rubber Band as part of `hyphon_native`; it is not. For anything
> about how Rubber Band is built or sized, the Module split and Four Worlds
> sections above are authoritative.

## Completed Changes ✅

### 1. Fixed Sampler Audio Bug
- **File**: `src/hooks/useAudioEngine.ts`
- **Issue**: AudioBuffer was created but channel data was never set
- **Fix**: Added `buffer.getChannelData(0).set(audioSamples)` in both:
  - `playSampler()` function (line ~638)
  - `noteOnSampler()` function (line ~741)
- **Result**: Sampler should now produce audio when samples are loaded

### 2. Enhanced Rubberband WASM Wrapper
- **File**: `emscripten/rubberband_wrapper.cpp`
- **Changes**:
  - Added `setFormantOption()` method for dynamic formant control
  - Exported all Rubberband option constants:
    - Process options (RealTime, Offline)
    - Stretch options (Elastic, Precise)
    - Transient options (Crisp, Mixed, Smooth)
    - Phase options (Laminar, Independent)
    - Formant options (Shifted, Preserved)
    - Engine options (Faster, Finer)
    - Pitch options (HighSpeed, HighQuality, HighConsistency)
    - Channel options (Apart, Together)

## Required Build Steps 🔨

### 1. Rebuild Rubberband WASM Module
**Command**: `pnpm run build:wasm:rubberband` (or `bash emscripten/build_rubberband.sh [release|debug]`)

**Requirements**:
- Emscripten SDK installed
- Git submodules initialized

**What it does**:
- Clones/updates rubberband library
- Compiles C++ wrapper with Emscripten
- Generates `src/audio-worklets/rubberband-lib.js` and `public/rubberband.wasm`

### 2. Compile Rubberband Audio Worklet
**Source**: `src/audio-worklets/rubberband-processor.ts`
**Target**: `public/rubberband-processor.js`

**Current Status**: TypeScript source exists but needs to be compiled

**Options**:
1. Add to Vite build process
2. Use `tsc` to compile manually
3. Bundle with esbuild/rollup

**Manual compile command** (if needed):
```bash
npx tsc src/audio-worklets/rubberband-processor.ts --outDir public --target es2020 --module es2020 --lib es2020,dom --skipLibCheck
```

## Testing Checklist 🧪

After building:
- [ ] Load a sample in the sampler
- [ ] Play notes - verify audio output works
- [ ] Test TTS generation
- [ ] Test singing voice synthesis with Rubberband
- [ ] Verify formant preservation works
- [ ] Test multi-resolution pitch caching

## Next Steps from Enhancement Plan 📋

According to `RUBBERBAND_ENHANCEMENT_PLAN.md`:

### Immediate (Section 1 & 2 - Already Implemented)
- ✅ Vocal fidelity tuning in rubberband-processor.ts
- ✅ Multi-resolution pitch caching in SingingVoice.ts

### Short-term (To Implement)
- [ ] **Section 3**: Phoneme-aware time stretching
  - File: `src/engines/rubberband/PhonemeAligner.ts` (stub exists)
  - Integrate Montreal Forced Aligner
  
- [ ] **Section 5**: Expressiveness layer (vibrato, dynamics)
  - File: `src/engines/rubberband/ExpressiveVoiceProcessor.ts` (stub exists)
  - Add to AudioWorklet

### Medium-term
- [ ] **Section 4**: Formant shifting for vocal character
- [ ] **Section 6**: Hybrid neural pipeline (requires HiFi-GAN WASM)
- [ ] **Section 7**: Performance optimizations

### Long-term
- [ ] **Section 8**: Concatenative hybrid (blend with real samples)
- [ ] **Section 9**: Latency synchronization
- [ ] **Section 10**: Artifact detection

## Known Issues ⚠️

1. **Rubberband worklet not compiled**: The TypeScript source exists but JS file is missing
2. **Option constants not available yet**: Need to rebuild WASM to access new constants
3. **Build environment**: Emscripten not available in current CI environment

## Integration Status 📊

| Component | Status | Notes |
|-----------|--------|-------|
| Sampler Audio | ✅ Fixed | Missing buffer data assignment |
| Rubberband Wrapper | ✅ Enhanced | Needs rebuild |
| SingingVoice Engine | ✅ Implemented | Ready to use |
| RingBuffer Utility | ✅ Working | Lock-free SPSC buffer |
| Audio Worklet | ⚠️ Needs Build | TS source exists |
| Option Constants | ⚠️ Needs Rebuild | Added to C++ wrapper |


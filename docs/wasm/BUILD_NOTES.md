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
- [The WASM OSC filter (LP / BP / HP, usable by any oscillator)](#wam-filter)
- [The Rust filter (same idea, in the Rust kernel)](#rust-filter)
- [Four Worlds memory budget](#four-worlds-memory-budget)
- [Fixed voice memory (no growth)](#fixed-voice-memory)
- [Denormal guards](#denormal-guards)
- [`-ffast-math`](#fast-math)
- [wasm-opt / link optimisation](#wasm-opt)
- [Rubber Band + mix bus at `-O3 -flto`](#standalone-link-profiles)
- [Export surface + export map](#export-surface)
- [Worklet import table](#worklet-import-table)
- [Worklet global scope (typing)](#worklet-global-scope)
- [AssemblyScript browser matrix](#assemblyscript-browser-matrix)
- [Standalone JC-303 (retired)](#standalone-jc-303-memory-budget)
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
| `build:native` | Rebuild AssemblyScript, `hyphon_native`, Rubber Band and the mix bus. |
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

- Every em++ script — `build.sh`, `build_rubberband.sh`, `build_mix_bus.sh` —
  sources `emscripten/toolchain_env.sh`. It accepts an
  `emcc` already on `PATH` whose `-dumpversion` matches, otherwise tries
  `$HYPHON_EMSDK` and the usual emsdk checkouts, and **exits 1** naming what it
  found when none matches. A mismatched compiler used to build silently.
  `HYPHON_ALLOW_UNPINNED_EMCC=1` builds anyway, loudly; do not ship that.
- Every workflow that installs emsdk (`ci.yml`, `303-quality-benchmarks.yml`,
  `playwright-e2e.yml`, `test-perf.yml`) reads the field with `jq` and passes it to
  `setup-emsdk` and its native cache key. `.jules/setup.sh` reads it too.
- `scripts/native-worlds.mjs` hashes `toolchain.json` + `toolchain_env.sh` into
  every em++ world, so moving the pin rebuilds all three of them.
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
variant (`tools/build_jc303_omp.sh`, since deleted) linked `libomp.a` too, but
`jc303_wasm/src` has no OpenMP pragma either.
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
| Threading | `-pthread -s PTHREAD_POOL_SIZE=0` (shared memory + atomics, no workers) | none |
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
high-water. Since #1596's follow-up the ST memory is **fixed** at 16 MB like the
pthread one — no growth, see [Fixed voice memory](#fixed-voice-memory) for the
all-slots ceiling it holds.

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

**Standalone `public/jc303*`.** Retired: nothing in `src/` loaded it, and JC303
has run inside `hyphon_native` (both threading profiles) since voice core P3. See
[Standalone JC-303 (retired)](#standalone-jc-303-memory-budget).

---

<a id="module-split"></a>
## Module split

`hyphon_native.wasm` is the **voice** module: Open303, JC303, Prophecy,
HighFid303, the analog drumkit and the macro voices. Neither Rubber Band nor
the offline [mix bus](#mix-bus) is in it.

### Why Rubber Band moved out

Two independent reasons, one of which is simply that it was never used there:

1. **Nothing called it.** `src/audio-worklets/rubberband-processor.ts` and
   `sustain-processor.ts` instantiate `public/rubberband.wasm` from
   `emscripten/build_rubberband.sh` (by hand since
   [#1596 follow-up P3](#rubberband-no-glue); through its glue before). The
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
| `public/rubberband.wasm` | `emscripten/build_rubberband.sh` | `wasm_memory_budget.json#rubberband` — fixed, never grows | no — the module owns its memory |
| `public/mix_bus.wasm` | `emscripten/build_mix_bus.sh` | `#mixBus` — fixed, never grows | no — owns it, zero imports |
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
- **Memory.** One stretcher, one FX chain and a 30 s vocal fit in the 64 MB heap
  (asserted by the integration test). The heap is fixed now:
  [Rubber Band: plain C ABI, fixed memory](#rubberband-fixed-memory).
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
the emcc 3.1.51 and 6.0.6 builds, and the 6.0.9 `-O3 -flto` build):

| | native vs JS |
|---|---|
| gain = 1 (every gain stem export uses today) | **bit-identical**. Switching engines never changes a stem. |
| other gains (future channel-strip faders) | ≤ `1e-6` per sample: an f32 multiply-add against JS's f64-then-round |
| peak | identical, NaN samples skipped as in JS (explicit `f32x4.pmax`) |

**Measured** (Node 24, x86-64, 48 kHz, 180 s, stereo; `-O1` link — for the
`-O3 -flto` numbers see [Rubber Band + mix bus at `-O3 -flto`](#standalone-link-profiles)):

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

**One always-on path, one WASM wavetable engine, and — one family at a time
(#1663) — real native-language voices. Not nine labels over one oscillator.**
(#1294)

`src/engines/backends/engineCatalog.ts` maps every waveform prefix to exactly
one renderer, and `BackendRegistry` owns the only fallback order there is:

```
(DWGS) → WebGPU → Rust OSC → C++ OSC → WASM OSC (AssemblyScript) → Pyodide → WAV PCM → JS oscillator
```

A family enters that chain at its own backend and can only step *down* it,
every step published to telemetry and the HUD (`BackendRegistry.sourceFrom`).
DWGS heads it as an **entry-only** backend (`BackendCapabilities.entryOnly`):
`dwgs-*` parts enter there and walk everything below with each wave's nearest
basic shape, but no other family ever falls *onto* DWGS, and the generic
`resolve()` / `generate()` do not consider it ([below](#dwgs-osc)).

| Family | Prefix | Renderer | Kind |
|---|---|---|---|
| JS oscillator | *(none — `sawtooth`/`square`/…)* | `OscillatorNode` | graph-native, sample-accurate, **always available** |
| Rust OSC | `rust-*` | `rust-audio/` → `public/rust_osc.wasm`, one `rust-osc-processor` AudioWorklet per voice | **worklet-resident** realtime voice ([below](#rust-osc)) |
| C++ OSC | `cpp-*` | `emscripten/cpp_osc.cpp` → `public/cpp_osc.wasm` (standalone, not `hyphon_native`), one `cpp-osc-processor` AudioWorklet per voice | **worklet-resident** realtime voice ([below](#cpp-osc)) |
| DWGS | `dwgs-*` | `dwgs-audio/` → `public/dwgs_osc.wasm`, one `dwgs-osc-processor` AudioWorklet per voice | **worklet-resident**, entry-only: its own waves, not basic shapes ([below](#dwgs-osc)) |
| WASM OSC | `wam-*` | `assembly/oscillators.ts` via `WasmOscillator` | the one WASM wavetable kernel |
| WAV PCM | `wav-*` | decoded `public/assets/*.wav` | asset |
| WebGPU | `wgsl-*` | `WebGpuOscillator`, band-limited octave tables pre-rendered at init in one dispatch | offline pre-render ([below](#wgsl-gpu)) |
| Pyodide | `pyodide-*` | NumPy/SciPy in the vendored CPython | offline pre-render |
| Open303 / JC303 | `303-*` | `hyphon_native` AudioWorklet | native worklet |
| Prophecy | `prophecy-*` | `hyphon_native` AudioWorklet | native worklet |
| Macro (Plaits) | `macro-*` | `hyphon_native` AudioWorklet, stereo, 8 voices per part | native worklet ([macro-voices.md](../audio-engine/macro-voices.md)) |

### The choice, and why

`OscillatorNode` stays the always-on path: it is graph-native, sample-accurate,
costs nothing to keep, and is the only renderer that cannot fail. Everything
below it is a *table* producer, resampled by `playbackRate`.

<a id="js-osc"></a>

### The JS oscillator: the terminal path, and how you know you are on it

`js` is the last step of `BACKEND_FALLBACK_ORDER` and cannot fail: `Voice`
builds a native `OscillatorNode` (`shapeToOscillatorType`) when
`BackendRegistry.sourceFrom` runs out of backends. Audit of what it covers:

| Concern | Status |
|---|---|
| Shapes | `saw`, `sqr`, `tri`, `sin` map 1:1 to `sawtooth`/`square`/`triangle`/`sine`. A `dwgs-*` wave lands on its nearest basic shape (the step is reported). |
| Pitch / slides | `frequency` is an a-rate `AudioParam`; legato slides use the same `exponentialRampToValueAtTime` as a worklet voice. |
| Detune | Not used: `Voice` transposes in Hz (`transposeFrequency`) and never touches `OscillatorNode.detune`. |
| Band-limiting | Browser-native (PeriodicWave), not the Rust/C++ kernels. |
| Filter | The voice's 2-pole `BiquadFilterNode`, as for every family. |

**When you are hearing it.** Either the part is a plain waveform (no prefix:
`sawtooth`, `square`, …) — then it is the preferred path and nothing is flagged —
or a prefixed family (`rust-*`, `cpp-*`, `wam-*`, `wgsl-*`, …) could not get
its engine. In the second case it is never silent:

- `console.warn` `[BackendRegistry] oscillator backend fell back <requested> → JS oscillator (<why each step was skipped>)`;
- telemetry: `registerResolution('oscillators', 'js', …)` + `recordDegradation`;
- the degradation banner / status pill: *"Oscillators running on JS oscillator instead of …"*;
- the EngineHUD "Oscillator backends" section, which reads
  `BackendRegistry.getLastResolution()`. The realtime path records its
  resolution there too (it used to update only telemetry and the banner, so the
  HUD could keep naming a backend that was not sounding).

Families that never enter the registry (`303-*`, `prophecy-*`, `macro-*` are
owned by their native-worklet managers) report through `logEngineFallback`
instead, and a missing registry (engine not initialised) is reported the same way.

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

<a id="rust-osc"></a>

### `rust-*`: the first family restored (#1664)

#1294 removed `rust-*` because `rust-audio/src/lib.rs` produced a naive
saw/square plus a biquad on the **main thread**, looped through an
`AudioBufferSourceNode`: no SIMD, no worklet, and a duplicate of the
AssemblyScript kernel. It is back as the thing that review said it would have
to be:

| | Retired bench (≤ #1294) | Rust OSC (#1664) |
|---|---|---|
| Where it runs | main thread, `generate()` → looped buffer | `rust-osc-processor` AudioWorklet, **one node per voice**, pooled across notes |
| Pitch | baked into a table, resampled by `playbackRate` | a-rate `frequency` AudioParam, rendered per sample (slides / automation are continuous) |
| Note timing | buffer `start(when)` | a-rate `gate` param: opens on the exact frame, resets phase on the edge |
| Band-limiting | none (naive saw/square) | PolyBLEP (saw, square), PolyBLAMP (triangle), degree-11 polynomial sine |
| SIMD | none | `simd128` throughout: 4 samples per iteration, phases from an in-register prefix sum |
| Memory | wasm-bindgen + allocator, growable | `no_std`, no allocator, **fixed 2 pages** (`wasm_memory_budget.json#rustOsc`) |
| Shapes | saw, square | saw, square, triangle, sine |
| Filter | biquad baked into the table | none in the oscillator: the voice's filter follows, as for every family. The kernel also carries the selectable **Rust filter** ([below](#rust-filter), #1672) |

Pieces:

- **Kernel** — `rust-audio/src/lib.rs`, a `no_std` cdylib with a plain C ABI
  (`rosc_*`, listed in `wasm_export_manifest.json#rustOsc`). No imports.
  `rosc_render` is the v128 path; `rosc_render_scalar` performs the same
  operations in the same order and is the reference the SIMD path is held
  **bit-identical** to (`rustOscVoice.realWasm.test.ts`). Host `cargo test`
  covers alias energy (saw/square ≈ 14 dB, triangle ≈ 10 dB below naive at
  3.5 kHz / 48 kHz), sine accuracy (< 2e-6), DC, and hostile input.
- **Build** — `pnpm run build:wasm:rust` (`scripts/build-rust-osc.mjs`): `cargo
  build --release --locked --target wasm32-unknown-unknown` with
  `+simd128`, `--initial-memory = --max-memory` and `-zstack-size` taken from the
  budget, then `tools/check_rust_osc_module.mjs` (no imports, fixed unshared
  memory of the budgeted size, exact export surface (`rosc_*` + `rflt_*`), ABI 2, SIMD compiled in,
  and a smoke call of the filter).
  It is the `rust-osc` native world; `check-release-dist.mjs` re-checks
  `dist/rust_osc.wasm` and budgets it (`dist-budget.json#native`).
  Needs `rustup target add wasm32-unknown-unknown`; no wasm-pack.
- **Worklet** — `src/audio-worklets/rust-osc-processor.ts` instantiates the
  module synchronously from a `WebAssembly.Module` passed in `processorOptions`
  (compiled once on the main thread), so a voice plays from its first block.
  A closed gate writes nothing; `process()` allocates nothing.
- **Bridge** — `src/engines/RustOscillator.ts`: fetch, **feature-detect**
  (`WebAssembly.validate` on the shipped bytes fails without WASM SIMD; no
  `AudioWorklet` is reported too), compile, `addModule` once per context, and a
  probe voice that must report `ready` before the backend is. Every failure is
  a named `logEngineFallback('rust', …)` and leaves `rust-*` on the `wam` table.
- **Contract** — `RustWorkletBackend` is the first backend with
  `acquireVoice` instead of `renderLoop`: it hands `Voice` a `RealtimeVoice`
  (output node + `frequency` param + gate), which `Voice` drives exactly like an
  `OscillatorNode`. It is `offline: false`, so `BackendRegistry.generate` skips
  it by name.

Old songs saved with `rust-saw` / `rust-sqr` load onto this family as they were
written; they are no longer rewritten to `wam-*`.

<a id="cpp-osc"></a>

### `cpp-*`: a C++ oscillator that finally exists (#1665)

Until #1665 `cpp-*` had **no renderer at all**: the selector, panel and HUD copy
shipped, and selecting it silently played an `OscillatorNode` (#1294 removed it
for exactly that, and rewrote saved `cpp-*` ids onto `wam-*`). It is now a real
C++ kernel, built the way the Rust OSC is shaped, with a different DSP so the
two families are not one oscillator under two labels:

| | Rust OSC (#1664) | C++ OSC (#1665) |
|---|---|---|
| Kernel | `rust-audio/src/lib.rs` | `emscripten/cpp_osc.cpp` |
| Module | `public/rust_osc.wasm` (cargo) | `public/cpp_osc.wasm` (em++ `STANDALONE_WASM`, the `cpp-osc` native world) |
| Band-limiting | 2-sample PolyBLEP / PolyBLAMP | **32-tap linear-phase windowed-sinc BLEP / BLAMP** (Blackman–Harris, 16 zero crossings, 128× tables built at init) |
| Worst alias < 16 kHz, saw @ 3.5 kHz / 48 kHz | — | ≈ −90 dB (naive saw: ≈ −20 dB) |
| Overshoot | none (residual too short to ring) | Gibbs, ≈ 1.17 peak on saw / square (up to 4/π ≈ 1.27 for a square whose fundamental is all that is left under Nyquist) — the price of a real band limit |
| Latency | 0 | **16 samples** fixed (`cosc_latency()`; 0.33 ms at 48 kHz) |
| Note onset | phase reset | phase reset **plus a band-limited step + corner from silence** |
| SIMD | `simd128` required | **scalar** — runs where WASM SIMD does not |
| Memory | fixed 2 pages | fixed 2 pages (`wasm_memory_budget.json#cppOsc`) |

**Placement: a dedicated module, not `hyphon_native`.** The issue's question.
`hyphon_native`'s heap is sized for its voices (303 / Prophecy / Macro / drums)
and is one instance per worklet *family*; this oscillator is one instance *per
synth voice* and owns 33 KiB of residual tables. Linking it into
`hyphon_native` would multiply that heap by the voice count or force a shared
voice table into a module whose budget does not plan for it. As its own
`STANDALONE_WASM` reactor it has zero imports, no JS glue, a fixed 128 KiB
memory per voice (1.1 MiB for all 9 synth voices) and its own native world, so a
kernel edit never relinks the voice module (and vice versa).

Pieces:

- **Kernel** — `emscripten/cpp_osc.cpp`, C ABI `cosc_*` (listed in
  `wasm_export_manifest.json#cppOsc`, typed by `gen:native-types` into
  `src/shared/rt/cppOscExports.ts`). No allocator, no exceptions, no imports;
  all state is static. The naive wave is written into a 32-slot delay line and
  every discontinuity (saw wrap, both square edges) adds the BLEP residual, every
  slope corner (triangle) the BLAMP residual, into the slots ahead of the read
  point. The residual tables are integrated once in `cosc_init` (Simpson's rule
  over trigonometric recurrences — no libm in the loop, ≈ 0.1–0.3 ms), stored per
  one-sample segment with both endpoints so the step at τ = 0 is never
  interpolated across.
- **Build** — `pnpm run build:wasm:cpp` (`emscripten/build_cpp_osc.sh`): the
  pinned em++, `-O3 -flto`, IEEE (no `-ffast-math`), **no `-msimd128`**,
  `STANDALONE_WASM`, `ALLOW_MEMORY_GROWTH=0`, `INITIAL_MEMORY`/`STACK_SIZE` from
  the budget, then `tools/check_cpp_osc_module.mjs` (zero imports, fixed unshared
  memory of the budgeted size, exact export surface, no v128 in any signature or
  local, ABI 1, a working init). `check-release-dist.mjs` re-checks
  `dist/cpp_osc.wasm` and budgets it (`dist-budget.json#native`).
- **Worklet** — `src/audio-worklets/cpp-osc-processor.ts`, the same node shape
  as the Rust one (a-rate `frequency`, k-rate `shape`, a-rate `gate`; the module
  arrives compiled in `processorOptions`; a closed gate writes nothing;
  `process()` allocates nothing). A gate-open edge calls `cosc_reset(0)`.
- **Bridge** — `src/engines/CppOscillator.ts` / `CppWorkletBackend`: fetch,
  compile, `addModule`, probe voice; every failure is a named
  `logEngineFallback('cpp', …)`.
- **Offline** — `src/audio/offline/OfflineCppOscEngine.ts` runs the same module
  through the same `instantiateCppOsc` + `cosc_reset(0)`, so a bounced note is
  bit-identical to the played one (`cppOscVoice.realWasm.test.ts`).
- **Fallback** — `cpp` sits directly below `rust` in `BACKEND_FALLBACK_ORDER`.
  A `cpp-*` part with no worklet / module steps to the `wam` table; a `rust-*`
  part on a browser without WASM SIMD now steps to the C++ OSC (still a live,
  band-limited voice) before the table. Every step is published.

Saved `cpp-saw` / `cpp-sqr` / `cpp-tri` / `cpp-sin` load onto this family as
written. `cpp-rand` never made a sound of its own and the kernel has no noise
shape, so `LEGACY_WAVEFORM_ALIASES` rewrites it to `cpp-saw` — reported through
`logWaveformSubstitution`, not silently. An in-kernel resonant filter is #1673.

<a id="dwgs-osc"></a>

### `dwgs-*`: DWGS, recovered from its panel art (#1666)

DWGS had **no code at all** — no engine id, no alias — only `public/osc/dwgs.jpg`
(added in 0cdff156, converted to WebP, deleted as an orphan in #1294). The
panel is the design: a Korg-badged **DWGS** module whose WAVEFORM SOURCE
selector reads **SAW / SQR / NOISE / DIGITAL WAVEFORM**, with a selector knob.
That is Korg's *Digital Waveform Generator System* (DW-6000 / DW-8000):
single-cycle waves defined by additive synthesis — a recipe of harmonic levels
per wave — played as a digital oscillator in front of a filter. It is **not** a
digital waveguide; nothing in the history points that way. What the mode is,
wave by wave, is in [`docs/audio-engine/dwgs-oscillator.md`](../audio-engine/dwgs-oscillator.md);
this section is the build and placement.

| | C++ OSC (#1665) | DWGS (#1666) |
|---|---|---|
| Kernel | `emscripten/cpp_osc.cpp` | `dwgs-audio/src/lib.rs` (Rust, `no_std`, no libm) |
| Module | `public/cpp_osc.wasm` (em++) | `public/dwgs_osc.wasm` (cargo, the `dwgs-osc` native world) |
| What it plays | saw / square / triangle / sine | **17 waves**: saw, square, 14 harmonic-recipe "digital waveforms", keyboard-tracking noise |
| How | naive wave + windowed-sinc BLEP residuals | **additive, per sample**: one sin/cos of the phase, then a Chebyshev recurrence over the harmonics (f64, four interleaved chains) |
| Band limit | ≈ −90 dB alias | **exact**: only harmonics below 0.45 fs are summed (faded in over 0.40–0.45 fs so slides never click) — no alias energy at all, at any pitch |
| Latency | 16 samples | 0 |
| Note onset | band-limited step from silence | every recipe is sine-phase, so a note started at phase 0 starts at 0 |
| CPU (V8, Node 22, 128-frame block) | not measured here (the Rust OSC's PolyBLEP: ~0.6 µs) | **~17–20 µs below ~250 Hz** (all 96 harmonics audible), ~8 µs at 1 kHz, ~1 µs for noise — ≈ 0.7 % of a 48 kHz render quantum per voice, ≈ 6.5 % for all 9 synth voices at the bottom of the keyboard |
| SIMD | scalar | scalar (the loop is f64 and latency-bound, not lane-bound) |
| Memory | fixed 2 pages | fixed 2 pages (`wasm_memory_budget.json#dwgsOsc`): I/O buffers 8 KiB + 16 × 96 f64 amplitudes 12 KiB |
| Size | 11 KB | 28.5 KB |

**Why Rust.** Either language fits a scalar kernel with a C ABI. Rust was
chosen because the crate builds with the toolchain `rust-*` already needs (no
second em++ module to pin), and because a `no_std` cdylib makes "no imports, no
allocator, no libm" a property of the compile rather than of a flag list.

**Why entry-only.** Every other worklet engine plays *basic shapes*, so a family
falling onto it changes engine, not timbre. DWGS plays its own waves: a
`wav-saw` part landing on it would quietly become a DWGS saw. So it heads the
order — nothing above it can fall onto it — and `walkFrom` skips any
`entryOnly` backend that is not the start of the walk. In the other direction a
`dwgs-*` part without its worklet walks WebGPU → Rust → C++ → WASM OSC → … with
`DWGS_WAVES[i].fallback`, the nearest basic shape (published like every step).

Pieces:

- **Kernel** — `dwgs-audio/src/lib.rs`, C ABI `dwgs_*`
  (`wasm_export_manifest.json#dwgsOsc`). `dwgs_init` evaluates the 16 recipes
  (16 × 96 amplitudes) and scales each wave to RMS 0.5 — microseconds, once per
  instance. `dwgs_reset` resets the phase and restarts the noise stream from its
  fixed seed (so offline == live, noise included). Host tests: `cargo test` in
  `dwgs-audio/` (sin/cos accuracy, equal RMS, alias energy < 1e-9, the band-edge
  fade, onsets at zero, noise colour vs pitch, hostile input).
- **Build** — `pnpm run build:wasm:dwgs` (`scripts/build-dwgs-osc.mjs`): `cargo
  build --release --locked --target wasm32-unknown-unknown`, **no target
  feature**, `--initial-memory = --max-memory` and `-zstack-size` from the budget,
  then `tools/check_dwgs_osc_module.mjs` (zero imports, fixed unshared memory,
  exact exports, no v128 — `usesV128` from the C++ checker — ABI 1, 17 waves,
  and every wave renders something finite and non-silent).
  `check-release-dist.mjs` re-checks `dist/dwgs_osc.wasm` and budgets it.
- **Worklet** — `src/audio-worklets/dwgs-osc-processor.ts`: a-rate `frequency`,
  **k-rate `wave`** (the kernel wave id), a-rate `gate`; same allocation-free
  `process()` and gate walk as the Rust / C++ processors.
- **Bridge** — `src/engines/DwgsOscillator.ts` / `DwgsWorkletBackend`. The wave
  reaches the voice as `RealtimeVoice.start(when, shape, variant)`: `parseWaveform`
  reports a `dwgs-*` suffix as `variant` (and its fallback shape as `shape`);
  basic-wave engines ignore `variant`.
- **Offline** — `src/audio/offline/OfflineDwgsOscEngine.ts`, bit-identical to the
  live voice (`dwgsOscVoice.realWasm.test.ts`).

An in-kernel filter is #1674; until then the voice's `BiquadFilterNode` follows,
as for every family that plays through `Voice`.

<a id="wam-filter"></a>

### The WASM OSC filter: LP / BP / HP, selectable by any oscillator (#1663)

The resonant filter of the AssemblyScript kernel is no longer a lowpass hard-coded
inside `generate`. It is one RBJ biquad (`assembly/biquad.ts`, `f64` transposed DF II)
with three responses, and it is offered two ways:

| | What it is | Who uses it |
|---|---|---|
| **Baked** | `generate` / `generateLoop` take a final `filterType` argument (`0` LP, `1` BP, `2` HP) and filter the table they render | `wam-*` tables (`WamWasmBackend`, `GenerateRequest.filterType`) |
| **Streaming** | `assembly/wamFilter.ts` → `src/wasm/wamFilter.wasm`, run per voice by `wam-filter-processor` | **any** host oscillator, selected as `SynthParams.filterSource: 'wam'` ("WASM OSC" in the UI) |

Same coefficients in both, because both compile the same `biquad.ts`: a sine through
the streaming module equals the same sine rendered by `oscillators.wasm` to within
`f32` quantisation (`wamFilter.realWasm.test.ts`).

**Why a second module and not exports on `oscillators.wasm`.** That module is sized for
wavetables (24 MB initial memory, a heap, an `abort` import) and the filter has to run
once per synth voice inside an AudioWorklet. `wamFilter.wasm` is 3.5 KB, one fixed 64 KiB
page (`--initialMemory 1 --maximumMemory 1`, budget `assemblyScript.wamFilterPages`), static
I/O buffers (no heap, `--runtime stub`), no imports (`--use abort=`), no growth, no throw.
Same feature set as every AS module: `simd` + `bulk-memory`, no WasmGC, no relaxed SIMD.
Because the two modules share `biquad.ts`, `scripts/native-worlds.mjs` lists it as an input
of both worlds (`as-oscillators`, `as-wamfilter`): editing it re-stales both.

**Where it sits.** Not in the fallback chain: it is a *stage*, not an oscillator.
`Voice` connects every source (an `OscillatorNode`, a looped table, a Rust / C++ / DWGS
worklet voice) to one gain bus, and the bus feeds either the voice's `BiquadFilterNode`
or the WASM filter's worklet node. Swapping filters is two `connect`s on the bus, so no
host engine needs to know it exists.

```
host oscillator ──► filterBus ──► BiquadFilterNode ─────┐   filterSource: 'native' (default)
 (any engine)          └───────► wam-filter-processor ──┴─► gain → …   filterSource: 'wam'
```

**One filter shapes the sound, never two.** A host that bakes its own filter into its
table (`wam-*`, and `pyodide-*` for a lowpass) is told what to bake by
`hostFilterRequest` (`engines/backends/filterSource.ts`):

| effective filter | what the host bakes |
|---|---|
| `native` + `lp` | its own lowpass at the voice's cutoff / Q — **unchanged from before**, so saved songs sound as they did |
| `native` + `bp` / `hp` | nothing (cutoff at `sampleRate / 2.1`, Q = √½): a baked lowpass at the same cutoff in front of a band/high pass would leave almost nothing |
| `wam` + anything | nothing, for the same reason: the WASM stage filters |

*Effective* means after availability checks: a voice that asked for `wam` and fell back
is a `native` voice, and its host is asked accordingly.

**Same knob, same sound.** `BiquadFilterNode` reads `Q` in **dB** for lowpass/highpass
(RBJ Q = 10^(Q/20)) and linearly for bandpass; the kernel takes the RBJ Q. `kernelResonance`
converts, so switching the source does not change the timbre. Verified against a real
`BiquadFilterNode` in Chromium: both land on the RBJ curve at every probe frequency.

**Degradation is logged, never silent.** If the WASM filter cannot run (no AudioWorklet,
`wamFilter.wasm` missing or rejected by the engine, the worklet failed to instantiate, an
`OfflineAudioContext` render, a mid-session loss) the voice runs the native filter and calls
`logFilterSourceFallback`: console, telemetry, and the degradation store entry `filter-source:wam`
that the EngineHUD and the selector's own notice read. One report per cause, not per note.
A registry-level backend that cannot bake the asked response (`capabilities.filterTypes`;
`pyodide` bakes lowpass only) is skipped with a logged reason rather than baking a lowpass for
a high pass (`BackendRegistry.generate` / `sourceFrom`).

**ABI.** `generate` / `generateLoop` are now 8-argument functions. A caller that passes the old
seven gets `filterType` 0 (a wasm `i32` argument that is absent reads as zero), i.e. the lowpass it
always had; an id outside 0–2 renders **0 frames**, not a lowpass. `wamFilter.wasm` exports
`abiVersion`, `maxFrames`, `inPtr`, `outPtr`, `configure`, `reset`, `process` (`WAM_FILTER_ABI_VERSION`
in `src/audio-worklets/wamFilter.ts`); `configure` refuses non-finite or unknown arguments and keeps
the running coefficients, and the processor reconfigures only when cutoff / Q / type changed.

**Not done, deliberately.**
- *Offline bounces.* The streaming filter needs a worklet, and `OfflineAudioContext` renders do
  not run one (the same reason `rust-*` / `cpp-*` / `dwgs-*` have offline kernels). A voice rendered
  there takes the logged native-filter fallback; an offline `wamFilter` kernel run (as
  `OfflineRustOscEngine` does) is the follow-up.
- *Per-sample cutoff modulation.* Cutoff, Q and type are k-rate (one coefficient update per 128-frame
  block); the voice sets them at note start, as it always has.
- *Session packs* do not carry `filterType` / `filterSource` (`PACK_SYNTH_NUMERIC_RANGES` is the format's
  contract); songs do, because they serialise `SynthParams` whole.

<a id="rust-filter"></a>

### The Rust filter: LP / BP / HP in the Rust kernel, selectable by any oscillator (#1672)

The same idea as the [WASM OSC filter](#wam-filter), in the Rust kernel: a real resonant
filter, independent of the oscillator shape **and** of the oscillator engine. Choosing
`SynthParams.filterSource: 'rust'` ("Rust" in the Filter / Source selector) runs it after
whatever the synth plays — JS, WASM OSC, Rust, C++, DWGS, WebGPU, Pyodide, WAV. It replaces
the retired bench crate's naive lowpass.

- **DSP** — `Biquad` in `rust-audio/src/lib.rs`: RBJ (Audio EQ Cookbook), transposed direct
  form II, **`f64` coefficients and state** (an `f32` 20 Hz lowpass at 48 kHz drifts: `a1 ≈
  −2 + 1e-5` is inside `f32` rounding). `core` has no libm, so `sin`/`cos` of the cutoff come
  from a degree-21 series on a folded range (error < 1e-14 against libm, `cargo test`).
  LP / BP (constant 0 dB peak, like `BiquadFilterNode`) / HP, `cutoff` clamped to
  [20 Hz, `sampleRate / 2.1`], `Q ≥ 0.1`. Same numbering as the AS kernel (`FILTER_LP/BP/HP` =
  0 / 1 / 2). Cutoff changes keep the state, so a sweep does not click; `rflt_process`
  flushes denormals once per block.
- **Same module as the oscillator, not a second build.** Four more exports in
  `public/rust_osc.wasm` — `rflt_buf_ptr`, `rflt_configure`, `rflt_reset`, `rflt_process`
  (`wasm_export_manifest.json#rustOsc.requiredFilter`) — with an in-place 1024-frame buffer
  (4 KiB; the module stays at its 2 fixed pages with ~100 KiB spare). ABI **2** (the surface
  changed; the worklets refuse any other). A filter node is another instance of the module
  that never calls `rosc_render`; an oscillator node never calls `rflt_*`. One build, one
  release gate (`tools/check_rust_osc_module.mjs` also smoke-calls the filter and checks it
  refuses an unknown type), one `dist` artifact.
- **Worklet / bridge** — `src/audio-worklets/rust-filter-processor.ts` (k-rate `cutoff`,
  `resonance`, `type`; same node contract as `wam-filter-processor`) and
  `src/engines/RustFilter.ts`, which is `WasmFilterStage` (the machinery `WamFilter` was
  generalised into: pooled nodes, readiness probe, named failure reasons) over
  `loadRustOscModule()` — so the oscillator and the filter fetch and compile `rust_osc.wasm`
  **once**. `engines/filterStages.ts` holds one process-wide slot per source; `Voice` asks
  for the stage its note selected.
- **Same sound as the WASM OSC filter.** Noise through both kernels agrees to f32 rounding
  at LP/BP/HP across 20 Hz–9 kHz and Q 0.7–12 (`rustFilter.realWasm.test.ts`), and
  `kernelResonance` maps the knob identically, so switching source does not change the timbre.
- **One filter shapes the sound.** `hostFilterRequest` treats `rust` like `wam`: a host that
  bakes its own filter (`wam-*`, `pyodide-*`) is asked to bake none.
- **Degradation is per source.** Rust unavailable (no `rust_osc.wasm`, no SIMD, no worklet,
  an offline render, lost mid-session) → the voice runs the native filter and reports it
  under `filter-source:rust` (the WASM OSC filter reports under `filter-source:wam`), so a
  working source never clears another's report. Once per cause.

```
host oscillator ──► filterBus ──► BiquadFilterNode ─────┐   filterSource: 'native' (default)
 (any engine)          ├───────► wam-filter-processor ──┤   filterSource: 'wam'
                       └───────► rust-filter-processor ─┴─► gain → …   filterSource: 'rust'
```

**Not done, deliberately.** (1) The filter is a separate worklet node after the oscillator,
including for `rust-*` itself; filtering inside `rust-osc-processor` (one node, no extra
hop) is possible with these exports but not wired. (2) Offline bounces take the logged native
fallback, as for the WASM OSC filter. (3) Cutoff / Q / type are k-rate, set at note start.
(4) Session packs do not carry `filterType` / `filterSource`.

<a id="wam-osc"></a>

### `wam-*`: hardening the mid-tier kernel (#1663)

`wam-*` is the reliable middle of the fallback chain: no AudioWorklet, no relaxed
SIMD, no `SharedArrayBuffer`, one 8 KB module. The #1663 hardening left every build flag and
the Safari intersection exactly as they were and changed only what the kernel
computes and what the bridge does around it.

| | Before | After |
|---|---|---|
| Saw, square | naive `2p-1` / `p<0.5` | **PolyBLEP** at each edge |
| Triangle | naive (`1 - 4 * abs(p - 0.5)`) | **PolyBLAMP** at both corners (`1/6` scale: `1/3` and `1/12` measured worse) |
| Phase | `f32`, accumulated | `f64`, from the frame index (no drift; a loop returns to exactly 0) |
| Filter | RBJ lowpass, `f32` direct form I | same coefficients, **`f64` transposed DF II**: a 20 Hz cutoff at 48 kHz is `a1 ≈ -2 + 1e-5`, inside `f32` rounding |
| Loop tables | `generate` of 2.0 s at 261.63 Hz: **523.26 cycles**, filter from rest, so the loop clicked on every wrap | `generateLoop`: whole cycles, filter **primed to steady state** |
| Bad arguments | NaN/0/negative pitch → DC or garbage; a long render ran off the end of memory and trapped | `0` frames; a render is truncated to what fits and never writes outside `[offset, offset+4n)` |

Measured on the shipped build (`asc`, `-O3`), filter open, 48 kHz, energy that is
not on a harmonic, dB re total (lower is better; `WasmOscillator.realWasm.test.ts`
keeps the margins):

| shape | 440 Hz | 1.05 kHz | 2.09 kHz | 4.19 kHz |
|---|---|---|---|---|
| saw, before → after | -20.1 → **-38.0** | -16.3 → **-34.1** | -13.3 → **-31.0** | -10.4 → **-28.3** |
| square, before → after | -21.9 → **-39.8** | -18.1 → **-35.8** | -15.0 → **-32.2** | -12.0 → **-29.2** |
| triangle, before → after | -57.1 → -59.2 | -48.5 → **-54.1** | -40.0 → **-48.5** | -31.4 → **-43.8** |

Loop seam (2 s table, 261.63 Hz, cutoff 2 kHz, Q 6; `|x[0] - x[L-1]|`, where a
healthy wrap is about one ordinary sample step): sine **1.017 → 0.035**, saw
0.139 → 0.0002, triangle 0.044 → 0.020. The table is 95 952 frames instead of
96 000 and its pitch moves by under 0.01 cent.

Cost, one 2 s table in V8 (Node, same machine): saw 0.51 → 0.62 ms, sine
1.31 → 1.87 ms; a loop table adds the filter priming, 0.78 / 2.33 ms (priming
replays the last 0.5 s of the periodic signal, not a whole extra table). A table
is built when a `Voice` builds its source, on the main thread and never in a
block callback; it is roughly +0.3 to +1 ms per voice over the old kernel.

Things deliberately **not** done:

- **No new shapes, no PWM.** `WaveShape` is shared by every backend and by saved
  songs; a fifth shape would have to land in all of them at once. A pulse width
  needs a `GenerateRequest` field and a control to drive it, and nothing sets one.
- **No SIMD, no relaxed SIMD.** The kernel is table-rate, not block-rate, and the
  matrix above still says it would be a byte-identical module.
- **No higher-order BLEP.** PolyBLEP's two-sample residual caps a saw at about
  -38 dB inharmonic at 440 Hz. The C++ OSC's 32-tap residual is the answer for
  anyone who needs more; this tier stays small and everywhere.

The bridge (`WasmOscillator.generate(..., loop)`) picks `generateLoop` when asked
and an older build without it falls back to `generate`. It also `memory.grow`s
ahead of a render longer than the module's 24 MB (about 60 s at 48 kHz): this
module runs on the main thread, so the worklet "no growth" rule does not apply,
and the kernel itself still never grows memory. `adapters.ts` asks for a loop
table in `renderLoop` only; offline bounces keep `generate`, so a note is still
exactly `floor(rate * duration)` frames.

<a id="wgsl-gpu"></a>
### `wgsl-*`: band-limited GPU tables, and why it stays a table producer (#1668)

#1668 asked whether `wgsl-*` could become a realtime voice like `rust-*`. It
cannot, for reasons that belong to the platform rather than to this code, so it
stays a pre-render, and the pre-render got much better.

**Why there is no realtime GPU voice**

- `navigator.gpu` is exposed to `Window` and `Worker` scopes only. An
  `AudioWorkletGlobalScope` is a worklet scope, not a worker, so the render
  thread cannot touch a `GPUDevice`. Every GPU sample would have to come from
  the main thread or a worker.
- Getting samples off the GPU means `submit` and then `mapAsync`. That round
  trip is asynchronous and jittery (a frame or more under load, and it gets
  worse when the page is rendering). To feed a worklet from it, you would need a
  `SharedArrayBuffer` ring (cross-origin isolation only) with tens of
  milliseconds of lookahead. That means a gate or parameter change lands late,
  and main-thread jank becomes an audio underrun.
- Every engine below WebGPU in the chain (`rust`, `cpp`, `wam`) already renders
  a band-limited basic wave in the worklet, sample-accurately, with none of
  that. A streamed GPU voice would be a worse version of `rust-*`.

What *is* live: a voice pitches a `wgsl-*` table through
`AudioBufferSourceNode.playbackRate`, which is an a-rate `AudioParam`. Slides
and pitch automation are therefore sample accurate, as they were before. The
cutoff and resonance were never in the table: they are the voice's own biquad.

**What changed in the pre-render** (`WebGpuOscillator`, `wavetableBands.ts`,
`WebGpuBackend` in `adapters.ts`)

| | Before | After |
|---|---|---|
| Tables | 4: one per shape, 2 s at C4, resampled for every pitch | one per shape **per octave band** (9 at 44.1/48 kHz, 10 at 96 kHz), and `renderLoop` picks the band for the note |
| Synthesis | naive `fract`/`step` shapes | **additive Fourier series**, with only harmonics that stay under Nyquist at the top of the band |
| Phase | `f32(t * f)`; at 5 s, 440 Hz this is ~2200 cycles in, where f32 resolves ~1e-4 cycle | **u32 fixed point** (`2^32` = one cycle, wrapping), so nothing drifts |
| Loop | 523.26 cycles, so it clicked on every wrap | whole cycles in 4096 samples; the increment `cycles·2^32/4096` is exact, so sample 4096 *is* sample 0 |
| Pitch | `baseFrequency` 261.63 | `cycles · sr / 4096`, exact |
| GPU work | 4 submits, 4 `mapAsync` | **1 dispatch** (`x` = sample, `y` = table), 1 readback |
| Memory @ 48 kHz | 4 × 96 000 f32 = 1.54 MB | 36 × 4096 f32 = 0.59 MB |
| Offline `generate` (export) | naive, aliased | the same kernel with one table at the note's pitch; `null` for NaN, ≤ 0 or ≥ Nyquist |

Measured by running the shipped WGSL on Chromium's SwiftShader WebGPU adapter
and playing each table back the way `playbackRate` does (looped, linear
interpolation), at 48 kHz. The numbers are the energy that is not on a harmonic
of the note, in dB relative to the total (lower is better):

| shape | 110 Hz | 440 Hz | 1.05 kHz | 2.09 kHz | 4.19 kHz |
|---|---|---|---|---|---|
| saw, before → after | -23.6 → **-48.6** | -22.0 → **-44.6** | -11.9 → **-38.5** | -7.9 → **-35.8** | -4.4 → **-31.2** |
| square, before → after | -25.4 → **-50.3** | -23.7 → **-46.3** | -12.6 → **-39.9** | -8.6 → **-38.9** | -5.9 → **-31.8** |
| triangle, before → after | -67.0 → **-84.6** | -43.6 → **-75.3** | -13.7 → **-57.5** | -9.3 → **-49.2** | -6.9 → **-38.7** |
| sine, before → after | -85.6 → **-91.9** | -43.7 → **-87.0** | -13.7 → **-66.1** | -9.3 → **-54.0** | -6.9 → **-41.8** |

The old sine and triangle results at 440 Hz and above are mostly the seam click.
What remains in the new column is mostly linear interpolation, not aliasing in
the table. On the same SwiftShader device (a CPU emulation, so the summing work
counts for far more than it does on a real GPU), the whole 36-table set took
11–14 ms against 16–26 ms for the old four naive tables. On real hardware, the
cost is dominated by the one readback. The GPU output matches an f64 mirror of
the kernel to within 2.6e-4 (about -72 dB). `wavetableBands.test.ts` keeps that
mirror honest: no harmonic past Nyquist for MIDI 12–127, seamless wrap, and
exact pitch. `WebGpuOscillator.test.ts` checks that the shader keeps the same
series.

**Limits, deliberately kept**

- **Octave bands, so the top of the spectrum is up to an octave short** at the
  bottom of a band. This is the usual wavetable trade-off. Half-octave bands
  would double the tables for a difference that is hard to hear under the
  voice's lowpass.
- **The band is chosen at note-on.** A slide that climbs far above the band
  can push its top harmonics past Nyquist until the next note-on. Re-picking
  the band mid-note would need a crossfade between sources, and nothing on the
  `LoopRender` path does that today.
- **Gibbs overshoot**: saw and square peak at about 1.09, not 1.0, because the
  series is not windowed. A sigma window would trade that for a duller edge.
- **The lowest band at 192 kHz is about 47 Hz.** There, the 4096-sample table
  holds only one cycle, and lower notes play it slower. Nothing aliases, but
  those notes get fewer top harmonics.
- **Fails closed.** If there is no adapter, the pass fails, or a shape comes
  back non-finite, that shape (or the whole backend) is not ready, and the
  registry steps down to `rust`, logged. The tables are plain `AudioBuffer`s
  and would outlive a lost device, but readiness follows the device, so a lost
  device drops to the next backend, and a restored one serves them again.

### Rules for adding one

A new basic-wave engine needs a reason the table above does not already cover,
and then:

1. It renders **in an AudioWorklet**, or it is a documented offline/pre-render
   producer like WebGPU. A main-thread `generate()` into an
   `AudioBufferSourceNode` is not a new engine — that is the pattern #1294
   removed, and the import-graph guard rejects it.
2. It registers as an `OscillatorBackend` and appears in
   `BACKEND_FALLBACK_ORDER`. `VoiceManager` must not learn its name. A
   worklet-resident engine implements `acquireVoice` (a `RealtimeVoice`), a
   table producer `renderLoop` — `rust-*` is the worked example of the first.
3. If it is C++, it is IEEE: under `compile_cpp` inside `hyphon_native`, or —
   like `cpp_osc.cpp` — a standalone module with its own build script, budget
   section, manifest section and checker. Nothing in `hyphon_native` uses
   `-ffast-math`; the offline `mix_bus.cpp` is the only translation unit that
   does. See [`-ffast-math`](#fast-math).
4. If it is a worklet with imported memory, it reads
   `emscripten/wasm_memory_budget.json`, never a literal.

---

## Four Worlds memory budget

**Source of truth: `emscripten/wasm_memory_budget.json`.** `emscripten/build.sh`
reads it for `-s INITIAL_MEMORY` / `-s STACK_SIZE` (the memory is fixed: no
`MAXIMUM_MEMORY`, see [Fixed voice memory](#fixed-voice-memory)), and
`src/audio-worklets/hyphonNativeImports.ts` mirrors it for the imported
`WebAssembly.Memory`. `src/__tests__/wasmMemoryBudget.test.ts` fails CI if the two
drift apart — this matters because the worklets instantiate the module with an
*imported* memory, so an `initial` below the module's declared minimum does not
degrade, it fails instantiation outright.

| Setting | Before | Now |
|---|---|---|
| `INITIAL_MEMORY` | 512 MB (8192 pages), then 128 MB | **32 MB (512 pages)** — measured, see below |
| `MAXIMUM_MEMORY` | unset (16384 pages in JS only), then 1024 MB | **= initial** (`ALLOW_MEMORY_GROWTH=0`) |
| `STACK_SIZE` | default (64 KB), then 8 MB | **64 KB** — measured high-water < 1 KB |
| `PTHREAD_POOL_SIZE` | 4 | **0** — nothing creates a thread |

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
| Stack (`STACK_SIZE`) | 8 MB | 8 MB | reserved (now 64 KB: [measured](#fixed-voice-memory)). The `__handle_stack_overflow` the jc303 build used to report was a false positive of uninitialised stack limits (`configureWasmStack`), not a real overflow |
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
heap — about 50× the measured voice set. (Growth up to 1 GB was still on then; it
is off now — [Fixed voice memory](#fixed-voice-memory).) A quarter of the old
`shared: true` reservation is what mobile Safari and 4 GB Chromebooks fail on.

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

The memory no longer grows, so the in-tree ceiling check is
`hyphonNativeFixedMemory.integration.test.ts` (every voice slot, below). If it
fails, raise `initialMemoryMb` in the budget JSON. The test caps it at 256 MB
deliberately: going above that should be a measured decision, not a default.

<a id="fixed-voice-memory"></a>
## Fixed voice memory (no growth)

Both `hyphon_native` profiles link with **`-s ALLOW_MEMORY_GROWTH=0`**. The
module declares `maximum == initial`, `createHyphonMemory()` imports exactly the
budget's pages (a larger `maximum` would be a `LinkError`), and
`emscripten_resize_heap` answers *no*, warning once. A `malloc` past the heap
returns `NULL`, and the voice's `*_init` returns 0 (jc303 allocates its
`Open303` with `new (std::nothrow)`: under `-fno-exceptions` a plain `new` would
`abort()`).

**Why.** In the pthread profile the heap is a `SharedArrayBuffer`. Growing it from
inside the AudioWorklet replaces the buffer under every `HEAPF32` view and the
event rings, mid-quantum. Nothing on the voice path needs growth: the voice set
is a fixed number of statically declared slots, and each slot's buffers are sized
by `*_init`, by block size.

**The ceiling, measured** (2026-11-17, emcc 6.0.13 `-O3 -flto`, node,
`node tools/render_hyphon_native_parity.mjs slots`). Every slot of every
`HYPHON_EXPORT_VOICE` engine is created: 16 Open303 at 4× oversample, 16 JC303,
16 high-fid at 2×, 8 Prophecy, 8 drum kits and 8 macro parts. Each is initialised at
`NATIVE_VOICE_MAX_BLOCK_FRAMES` (4096), sent a note and rendered:

| | pthread (32 MB) | ST (16 MB) |
|---|---:|---:|
| High-water, all 72 slots | 13.5 MB | 13.5 MB |
| …at 48 / 96 / 192 / 384 / 768 kHz | identical | identical |
| Worst-case live set (`heap`, 14 voices) | 4.0 MB | 3.9 MB |

Heap per voice depends on the block size, not the sample rate, so this is a
hard ceiling. A session cannot ask for more than every slot at the largest block.
`src/__tests__/hyphonNativeFixedMemory.integration.test.ts` runs `slots` on both
built modules and checks the memory import limits. `emscripten/build.sh` checks
the limits at link time too (`check_hyphon_st_module.mjs --fixed-memory-mb`).
Adding a voice, slots or per-voice buffers that no longer fit fails there.

**32 vs 48 MB (the iOS question from #1596).** It stays 32. WebKit always loads the
ST build (`hyphonNativeVariant.ts`), whose memory is a plain 16 MB `ArrayBuffer`,
so iOS never makes the shared reservation at all. The pthread build's 32 MB is
2.4× the all-slots ceiling. 48 MB would only grow the `shared: true`
reservation that low-RAM Chromebooks refuse.

**Stack: 8 MB → 64 KB.** The debug build links `emscripten/core/stack_probe.cpp`
(manifest bucket `debug`, `tools/hyphon_native_exports.mjs --profile debug`). It
paints the free stack between the linker's `__stack_low` / `__stack_high`, and
`render_hyphon_native_parity.mjs stack` reads back the deepest overwritten word
after running the worst-case set, the event path (`*_push_event` + `*_render`)
and all 24 macro engines. The result is **0.3 KB on both profiles**, about the
probe's own 256-byte guard. clang keeps the DSP state in wasm locals, so the
linear-memory stack holds almost nothing. The probe reads linker symbols, not
`emscripten_stack_get_end()`, because the hand-instantiating worklets never run
`emscripten_stack_init()`. `-O1` frames are at least the `-O3` ones, so this
is an upper bound. 64 KB (Emscripten's default) is 200× it.

```bash
pnpm run build:emcc:debug
node tools/render_hyphon_native_parity.mjs stack --wasm public/hyphon_native.wasm --map public/hyphon_wasm_export_map.json
node tools/render_hyphon_native_parity.mjs stack --wasm public/hyphon_native.st.wasm --map public/hyphon_wasm_export_map.st.json
```

**Pthread pool: 4 → 0.** Nothing in the module creates a thread (no
`pthread_create`, `std::thread` or `std::async`). The worklets instantiate the wasm
by hand, so the glue that would have spawned the pool never ran. `-pthread` stays
for the shared memory and atomics the event rings need.

**Null test.** All 37 renders of `render_hyphon_native_parity.mjs render`
(the 303 models, drums, Prophecy, macro) are bit-identical before and after, on
both profiles.

---

<a id="denormal-guards"></a>
## Denormal guards (#1596 follow-up P4)

WebAssembly floats are IEEE with gradual underflow: there is no flush-to-zero
(FTZ / DAZ) mode to switch on. A filter or envelope ringing down after a note
decays into subnormals, and on x86 every operation that reads one costs a
~100-cycle microcode assist. The Plaits sources get their guards at staging time
([`tools/plaits_wasm_patches.mjs`](#plaits-sources)). The other voices'
wrappers zero their recursive state themselves, once per render block, with
`hyphon::flushDenormal` / `flushDenormals` (`emscripten/core/voice.h`):

| Wrapper | State flushed at each block end | Measured before (60 s tail after a note) |
|---|---|---|
| `jc303_wrapper.cpp` (rosic) | output before the double→float narrowing; amp / filter envelopes, the two RC smoothers, de-clicker + notch biquads, three one-poles, the ladder's four stages and feedback high-pass, the 12-word elliptic anti-alias filter | **11,141 of 22,500 silent blocks** consume subnormals: the float output from ~4 s, rosic's own double state from ~35 s, for good |
| `open303_wrapper.cpp` | Moog ladder integrators | none |
| `highfid303_wrapper.cpp` | diode-ladder stages, osc low-pass, feedback high-pass | none |
| `prophecy_wrapper.cpp` | each active voice's four formant biquads | none (idle voices stop processing) |
| `drumkit_wrapper.cpp` | snare noise band-pass, both hats' high-pass + band-pass | none (hits deactivate at −100 dB) |

A sweep of 208 configurations found subnormals only in jc303, and in every one
of its configurations. The sweep covered all 7 open303 models × cutoff ×
resonance × decay × 1× / 4× oversampling, every Prophecy waveform × resonance ×
release, and every drum pad of both kits at decays up to 5 s. The other four are
guarded anyway, so that a parameter path the sweep missed stays clean. Each guard
runs once per block, a handful of compares per 128 frames.

**Thresholds.** Float state is zeroed below 1e-15 (−300 dBFS, `flushDenormal`).
rosic keeps its state in double, and its filter envelope feeds the cutoff
exponent, so zeroing it at 1e-15 moved the last bits of a still-sounding
release (−312 dBFS, but not bit-identical). It is zeroed just above the double
subnormal range instead (`flushSubnormalState`, 1e-300). rosic's double output
sample is zeroed below 1e-30 before it narrows to float (`flushForNarrowing`):
that is the one value whose *float* goes subnormal first. Per block is enough:
nothing decays from the threshold to the subnormal range inside one.

rosic is the pinned `jc303_wasm` submodule and is never patched. Its state is
`protected`, so the wrapper reaches it with member pointers formed inside derived
classes (`rosic_state` in `jc303_wrapper.cpp`), and no rosic header changes.

**The test.** `emscripten/tests/denormal_tail_test.cpp` runs in `pnpm test:native`.
It builds each of the five engines twice: guards off, so `flushDenormal` is the
identity (`-DHYPHON_DENORMAL_GUARD=0`, report only), and guards on. It renders a
note released at 0.5 s and then 60 s of silence. After every block it reads the
x86 MXCSR denormal-operand flag, the hardware's own record that a subnormal was
consumed, which is deterministic where a timing threshold is not. The guarded
build must show:

- no silent-tail block with the flag set;
- mean tail-block CPU ≤ 2× the sounding blocks', a loose check against the
  10–100× of a denormal tail;
- output bit-identical to the unguarded build until the tail (after the last
  sample ≥ 2^-40), and within 1e-9 inside it.

Every engine passes. The wasm render-parity set is still bit-identical, 36/36 on
both profiles.

To find a new site, the Plaits recipe works here too. Unmask DM in MXCSR, catch
`SIGFPE`, and read the backtrace
([macro-voices.md](../audio-engine/macro-voices.md#denormals)).

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
samples. The max-reduction is hand-vectorised with `f32x4.pmax` rather than left
to the flag (see [the peak loop](#standalone-link-profiles)).
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

<a id="standalone-link-profiles"></a>
### Rubber Band and the mix bus at `-O3 -flto` (2026-10-27)

The other two em++ modules kept the 3.1.51 workaround after #1424 lifted it for
`hyphon_native`: compiled `-O3`, but linked at **`-O1`** with no LTO. Both now use
the voice module's release profile:

| Module | Compile (release) | Link (release) |
|---|---|---|
| `hyphon_native` | `-O3 -funroll-loops -flto` | `-O3 -flto` |
| `rubberband.wasm` | `-O3 -funroll-loops -flto` (IEEE — never `-ffast-math`) | `-O3 -flto` (was `-O1`) |
| `mix_bus.wasm` | `-O3 -ffast-math -flto` (the one fast-math TU) | `-O3 -flto` (was `-O1`) |

Debug profiles are unchanged (`-O1 -g3`, IEEE). Neither module needs `-lexports.js`:
Rubber Band was then only instantiated through its own glue
(`createRubberBandModule`; it links `-lexports.js` since it lost the glue, see
[#rubberband-no-glue](#rubberband-no-glue)), and the mix bus is a
`STANDALONE_WASM` reactor whose export names are not minified
(`tools/check_mix_bus_module.mjs` checks them after every build).
`src/__tests__/wasmCompileFlags.test.ts` pins both profiles.

**Parity.**

- *Rubber Band stretcher*: five 4 s renders through the embind stretcher (R2
  real-time vocal profile with pitch + formant, R2 precise stretch, R2 short-window
  consistency, R3 finer mono with formant, R3 finer stereo ×2) are **bit-identical**
  between the `-O1` and the `-O3 -flto` build. Same reason as the voice module: no
  fast-math, and wasm has no implicit FMA contraction.
- *Vocal FX* (`rb_fx_*`): `nativeVocalFx.integration.test.ts` — the TS oracle at
  0 error / ∞ SNR on every case — passes unchanged on the new binary.
- *Mix bus*: every accumulate (gain 1, 0.7, 0.333, 1.25 over 12 × 180 s stereo
  stems) is **bit-identical** to the IEEE debug build and to the old release
  build. `mix_bus_peak` matched the JS reference and the debug build on all 150
  edge cases (lengths 0–200,003 with NaN / ±Inf / −0 at the start, middle and
  end); the **old** release build did not — fast-math had made its scalar max
  NaN-propagating, so a stem with a NaN sample reported a NaN peak in 27 of the
  150 cases. `mixBus.integration.test.ts` now pins that case.

**The peak loop.** Left to the compiler, the `-O3 -flto` link vectorised the peak
reduction into `f32x4.max`, whose NaN-propagating x86 lowering made it ~30 %
*slower* than the old scalar loop (13.8 → 18.2 ms for an 8.6 M-sample channel).
`mix_bus_peak` is now written with `wasm_f32x4_pmax`, which is exactly the JS
`if (a > peak) peak = a` and lowers to one `maxps`.

**Performance** (Node 22, x86-64; medians of interleaved runs):

| Workload | `-O1` link | `-O3 -flto` | Δ |
|---|---:|---:|---:|
| Rubber Band R2 vocal pitch, 4 s mono | 262 ms | 229 ms | −13 % |
| Rubber Band R2 precise stretch ×1.6 | 202 ms | 163 ms | −19 % |
| Rubber Band R2 short window, ×0.8 | 87 ms | 73 ms | −16 % |
| Rubber Band R3 finer + formant ×1.25 | 628 ms | 507 ms | −19 % |
| Rubber Band R3 finer stereo ×2 | 1,097 ms | 1,139 ms | noise (1,076–1,140 both) |
| `vocalFx.perf`: native FX quantum | 0.0157 ms | 0.0161 ms | flat |
| `vocalFx.perf`: native grains, 1024 frames | 0.0235 ms | 0.0241 ms | flat |
| Mix bus: 12-stem 180 s stereo sum | 501 ms | 359 ms | −28 % |
| Mix bus: peak, one 8.6 M-sample channel | 13.8 ms | 6.5 ms | −53 % (pmax) |

The rb_fx chain is a handful of calls per 128-frame quantum on a hot path that
was already inlined within its TU, so LTO has nothing to add there; the
stretcher, spread over Rubber Band's many TUs, is where cross-TU inlining pays.

**Sizes** (bytes; `dist-budget.json#native` rows added in their own commit):

| Artifact | `-O1` link | `-O3 -flto` | Δ |
|---|---:|---:|---:|
| `rubberband.wasm` | 553,042 | 464,544 | −16.0 % |
| `rubberband-lib.js` (glue as emitted) | 199,615 | 103,152 | −48.3 % |
| `rubberband-processor` worklet chunk (Vite-minified, brotli) | 33,245 | 32,995 | −0.8 % (Vite minified the old glue too) |
| `mix_bus.wasm` | 730 | 880 | +150 (the explicit SIMD peak) |

<a id="rubberband-memory-growth"></a>
<a id="rubberband-fixed-memory"></a>
### Rubber Band: plain C ABI, fixed memory, no exceptions (#1596 follow-up P2)

`rubberband.wasm` used to be the odd module out: embind (`--bind`, `-frtti`),
JS-trampoline exceptions (`-fexceptions`, so every `invoke_*` crossed into JS),
`ALLOW_MEMORY_GROWTH=1` (64 → 256 MB), a `std::vector` of channel pointers built on
every `process()` / `retrieve()`, and an embind class whose `getTimeRatio` /
`getPitchScale` were declared in TS but never bound. That last one meant
`setStretchProfile` threw on the shipped build. It now matches the voice module:

- **ABI.** `emscripten/rubberband_wrapper.cpp` is `extern "C"` over an opaque
  handle: `rb_create` / `rb_destroy` / `rb_reset` / `rb_set_time_ratio` /
  `rb_set_pitch_scale` / `rb_get_*` / `rb_available` / `rb_process` /
  `rb_retrieve`, with `rb_abi_version`. The handle owns fixed channel-pointer
  arrays (up to 8 channels), so the per-block calls do no heap work of their own.
  `src/audio-worklets/rubberband/stretcher.ts` wraps it in a `RubberBandStretcher`
  class with the old method names. `rubberband-processor.ts` (live vocal and the
  offline vocal host, which runs the same class) and `sustain-processor.ts`
  construct that instead of `module.RubberBandStretcher`.
- **Flags.** `-fno-exceptions -fno-rtti -DNO_EXCEPTIONS`, no `--bind`, no
  `-s WASM=1`. Rubber Band never catches. Under `NO_EXCEPTIONS` its few throw
  sites (allocation failure, an FFT/resampler implementation error) `abort()`, which
  is what an uncaught throw did before. `tools/check_rubberband_module.mjs` fails
  the build if the glue carries embind or the C++ exception runtime, or if the memory
  can grow. The module's import/export names are minified, so the glue is where those
  runtimes show.
- **Memory: fixed at 64 MB** (`ALLOW_MEMORY_GROWTH=0`, `ABORTING_MALLOC=0`). Growth
  was kept before because `loadBuffer` copies the whole, uncapped sample into the
  heap. Now a sample the heap cannot hold fails `rb_fx_sample_alloc`, which returns
  NULL: the sample buffer is a nullable `calloc`, not a `std::vector` that would
  `abort()` under `-fno-exceptions`. The worklet then runs that sample on the
  TypeScript FX chain, reported as `FX_BACKEND: ts`, and the stretcher keeps
  streaming it from JS. 64 MB holds 15.0 M sample frames (5.2 min of 48 kHz mono,
  measured) next to a live stretcher and FX chain. The benchmark below ran 12 R3
  stretchers inside it.
- **Chorus ring.** `rubberband_fx.cpp` sized the chorus delay ring at a literal
  48000 samples. It is now `2 × 22 ms × sampleRate`, from the rate `rb_fx_create`
  receives. The longest tap is 22 ms, and a ring longer than the longest delay
  never changes a sample.

**Golden render.** The stretcher on the rb_* build is **bit-identical** to the
embind build on all four stretch profiles (vocal, harmonic, fast, R3 finer), with
pitch and time ratio moving every block. The hashes from the last embind build are
committed in `src/test/fixtures/rubberbandStretcherGolden.json` and checked by
`src/__tests__/rubberbandFixedHeap.integration.test.ts`. A one-off run of the full
`RubberBandProcessor` session (stream, freeze granulator, FX chain, stereo) and of
`sustain-processor` was also bit-identical. The same test drives both worklets on
the fixed heap and the long-sample fallback, and replaces
`rubberbandHeapGrowth.integration.test.ts`: with no growth there is nothing left to
inject.

**Size and CPU** (emcc 6.0.13 `-O3 -flto`, `scripts/benchmark_rubberband_engines.mjs`,
mean per-quantum CPU summed over every voice count and pitch, new / old):

| | embind + `-fexceptions` | C ABI, no exceptions |
|---|---:|---:|
| `rubberband.wasm` | 456,505 B | 399,949 B (−12 %) |
| `rubberband-lib.js` | 99,066 B | 57,731 B (−42 %) |
| CPU, R2 profiles (vocal / harmonic / fast) | 1.00 | 0.89–1.06 (noise) |
| CPU, R3 profiles (vocal / harmonic) | 1.00 | 0.73–0.82 |

### Rubber Band without glue (#1596 follow-up P3)
<a id="rubberband-no-glue"></a>

`rubberband.wasm` was the last module still loaded through Emscripten glue: the
`MODULARIZE` factory `createRubberBandModule()`, committed as
`src/audio-worklets/rubberband-lib.js` with a hand-kept `.d.ts`. A local rebuild
rewrote that file (the `--pre-js` path and the order of emitted helpers), so
`git status` could be dirty after `build:native` on any checkout path other than
CI's. The glue, its `.d.ts` and `emscripten/rubberband-pre.js` are gone.

- **Link.** `build_rubberband.sh` drops `MODULARIZE`, `EXPORT_ES6`, `EXPORT_NAME`,
  `EXPORTED_RUNTIME_METHODS`, `INCOMING_MODULE_JS_API` and `--pre-js`, and adds
  `-lexports.js` (unminified import / export names, as in `build.sh`) and
  `--no-entry`. The JS file emcc still writes goes to the temp dir and is deleted
  with it. Only `public/rubberband.wasm` (gitignored) is produced, so a rebuild
  cannot dirty the tree. Memory stays fixed at 64 MB.
- **Instantiate.** `src/audio-worklets/rubberband/instantiate.ts` compiles the
  bytes the main thread fetched, satisfies the 14 imports by name (`env`:
  `__assert_fail`, `_abort_js`, `emscripten_resize_heap` → 0,
  `emscripten_date_now`, `_emscripten_runtime_keepalive_clear`, `_setitimer_js`;
  WASI: `proc_exit`, `fd_write` → line-buffered console, `fd_read`, `fd_seek`,
  `fd_close`, `environ_*`, `clock_time_get`), runs `__wasm_call_ctors`, and returns
  the same shape the glue did: `module._rb_create` … plus `HEAPU8` / `HEAPF32` /
  `HEAPF64` views of the module's own `memory` export. `stretcher.ts`,
  `nativeVocalFx.ts` and both worklets are otherwise unchanged. An abort, `exit`
  or failed assert throws `RubberBandAbort`.
- **Check.** `tools/check_rubberband_module.mjs` now reads the wasm only. It fails
  on minified names, on any import outside the manifest's `rubberband.imports` (the
  set `instantiate.ts` implements, held equal by
  `src/__tests__/rubberbandInstantiate.test.ts`), on embind / `__cxa_*` /
  `invoke_*` imports, on a missing `required` export, and on any export outside
  `required` + `runtime` (`memory`, `__wasm_call_ctors`, `_emscripten_timeout`).
- **Parity.** The stretcher golden (all four profiles) and the full
  `RubberBandProcessor` / `sustain-processor` sessions in
  `rubberbandFixedHeap.integration.test.ts` are bit-identical, and so are
  `vocalFreezeParity` and `nativeVocalFx.integration`.
- **Size** (emcc 6.0.13): `rubberband.wasm` 399,949 → 400,710 B (+761 B of
  readable names); the 57,671 B glue is gone from the worklet bundles.

### Voice export-map check: fixed memory, and a missing artifact fails

`check_wasm_export_map.mjs --wasm <hyphon_native[.st].wasm>` also checks that the
binary imports a memory fixed at its budget (initial == maximum ==
`hyphonNative[St].initialMemoryMb`), the same check `build.sh` runs after linking.
`--require-artifacts` turns an absent map, `rubberband.wasm` or `mix_bus.wasm` into
a failure instead of a warning and exit 0. CI's native job and `build:release` pass
it for both voice profiles. The source-only lint job builds no wasm, so
`pnpm lint` keeps the warning there.

### Why the export map is checked against the binary too

`tools/extract_wasm_export_map.mjs` parses the **glue** (`hyphon_native.js`). Any
pass that rewrote the `.wasm` without touching the glue and renamed exports would
leave `check_wasm_export_map.mjs --glue` passing while the worklets could no longer
resolve a single function. `check_wasm_export_map.mjs` therefore also takes
`--wasm`, compiles the binary, and asserts every name in the map is a real export;
`build.sh` and `build:release` pass both.

---

## Export surface

`emscripten/wasm_export_manifest.json` declares the contract of **all three** em++
modules, and is the **only** list of each. The top-level buckets are
`hyphon_native` (#1344). The `rubberband` and `mixBus` sections were added in
#1596 follow-up P3, replacing the hand-kept `RB_FX_EXPORTS` / `MIX_BUS_EXPORTS`
arrays and their TS twins. Each build script passes exactly its module to
`EXPORTED_FUNCTIONS` via `tools/hyphon_native_exports.mjs [--module rubberband|mixBus]`.
Add an export to the manifest, never to a build script.

- **required** — called by shipped worklet/engine code. A build missing one is broken.
- **optional** — built, but not (yet) called by shipped code.
- **runtime** — added by Emscripten itself (pthread internals, `main`; mix_bus's
  standalone stack helpers); never requested.
- **debug** — linked into the debug profile only (the hyphon_native stack probe).
- anything else present is flagged as export bloat.

The same three lists feed all the tooling:

| | hyphon_native | rubberband | mix_bus |
|---|---|---|---|
| Typed for TS (`pnpm run gen:native-types`) | `src/shared/rt/hyphonNativeExports.ts` | `src/shared/rt/rubberbandExports.ts` (`RUBBERBAND_STRETCHER_EXPORTS`, `RUBBERBAND_FX_EXPORTS`, `RubberBandExports`) | `src/shared/rt/mixBusExports.ts` |
| Consumed by | worklets via the export map | `rubberband/stretcher.ts`, `rubberband/nativeVocalFx.ts` | `mixBusKernel.ts`, `check_mix_bus_module.mjs` |
| Binary checked by | `check_wasm_export_map.mjs` (map, glue, wasm) | `check_rubberband_module.mjs` (glue `Module._x` set == section) | `check_mix_bus_module.mjs` (wasm exports == section + runtime) |

`pnpm run check:exports` runs all three checks whenever the artifacts exist.
`pnpm run check:native-types` fails when a generated file is stale **or** when code
under `src/`, `scripts/` or `tools/` calls a native export that no section
declares. It scans for `x.name(` / `x._name(` and quoted `'name'` with a module's
prefix: a voice prefix or `hyphon_stack_`, `rb_`, or `mix_bus_`. Such a caller
compiles and then fails at run time with `undefined is not a function`.

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
to that API when `open303_*` is missing, which described the standalone
`jc303-single.wasm` artifact (since retired), not this module. The worklet's `JC303_PARAM_MAP` message names
(`jc303_setCutoff`, …) are unaffected too: they are *message* names translated
into `open303_set_param` / `jc303_set_param` param IDs, not exports.

`highfid303_*` is kept but marked optional: the shipped realtime path does not call
it (`OfflineHighFid303Engine.ts` and the WGSL shader mirror it in TS/GPU instead).

---

<a id="worklet-global-scope"></a>
## Worklet global scope: three TypeScript programs

AudioWorklet code runs in `AudioWorkletGlobalScope`: `sampleRate`, `currentTime`,
`currentFrame`, `registerProcessor`, `AudioWorkletProcessor`, `console`,
`MessagePort` — and no `window`, `document`, `fetch`, `setTimeout` or (in most
engines) `performance`. It used to type-check under the app's `lib: ["DOM"]`, so
none of that was enforced (a `setTimeout` in a drum-worklet WIP broke it once),
and 11 processors hand-declared the scope's members, each slightly differently.

`tsc -b` now builds three programs:

| Project | Covers | `lib` / `types` |
|---|---|---|
| `tsconfig.app.json` | the app, all tests | `ES2022` + `DOM`; `@types/audioworklet` is visible too, because tests and a few main-thread modules import worklet files |
| `src/audio-worklets/tsconfig.json` | worklet sources (not `__tests__`) and everything they import | `ES2022` + `@types/audioworklet` (+ `vite/client` for `import.meta.env`) — **no DOM** |
| `src/shared/rt/tsconfig.json` | real-time code both worlds import | `ES2022` only |

A `window` or `setTimeout` in `src/audio-worklets/` — or in any module a worklet
imports, wherever it lives — fails `tsc -b`. ESLint's `no-restricted-globals` on
`src/audio-worklets/**` and `src/shared/rt/**` is the backstop, and
`src/__tests__/workletGlobalScope.test.ts` pins the configuration.

`src/shared/rt/` holds what both sides use and so must assume neither global set:
`ringBuffer.ts`, `sidechainTriggerRing.ts`, the generated `hyphonNativeExports.ts`
and `eventLayout.ts` (`pnpm run gen:native-types` writes both there), the control
plane's `eventRing.ts`, `eventTransport.ts` and `audioClock.ts`
([VOICE_CORE.md#control-plane](VOICE_CORE.md#control-plane)), `clock.ts` (the transport clock
constants, re-exported by `src/midi/clock/types.ts`, plus the clock worklet's
message protocol) and `time.ts` (`nowMs()`, the one `performance.now()`-or-`Date.now()`
lookup the worklets used to repeat). Other modules a worklet imports (the loudness
DSP, `stretchProfiles`, `ExpressiveVoiceProcessor`, `workletSampleRate`) stay where
they are; the worklet program checks them all the same.

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
--initialMemory 128–384 pages (1 for the worklet-resident wamFilter, with --maximumMemory 1)
--exportRuntime --bindings esm
```

Page counts are mirrored in `emscripten/wasm_memory_budget.json#assemblyScript`
and asserted by `src/__tests__/wasmMemoryBudget.test.ts`; the feature set is
asserted by `src/__tests__/wasmCompileFlags.test.ts`.

| Feature | Chrome / Edge | Firefox | Safari | Shipped? |
|---|---|---|---|---|
| SIMD (`simd128`) | ✅ 91+ | ✅ 89+ | ✅ 16.4+ | ✅ |
| Bulk memory | ✅ | ✅ | ✅ 15+ | ✅ |
| Threads + SharedArrayBuffer | ✅ (COOP/COEP) | ✅ (COOP/COEP) | ⚠️ COOP/COEP required; historically flaky inside AudioWorklets on iOS | ❌ dropped (#1596 follow-up P5) — `oscillators.ts` uses no atomics and `WasmOscillator.ts` runs it on its own non-shared memory; the module without the flag is byte-identical |
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

**Retired.** The standalone `public/jc303-{single,threaded}{.js,.wasm,-worklet.js}`
world (plus the legacy `public/jc303.{js,wasm}` / `jc303_worklet.js` copies) was
built by `tools/build_jc303_omp.sh` + `tools/jc303_cmake/CMakeLists.txt` on every
`build:native`, but nothing in `src/` loaded it — JC303 runs inside
`hyphon_native` (`emscripten/jc303_wrapper.cpp`, compiled from
`jc303_wasm/src/dsp/open303/*.cpp`). It had also drifted to `-O2 -flto` links
against `hyphon_native`'s `-O3 -flto`. The script, the CMake overlay, the
`standaloneJc303` budget entry, its native world and CI cache paths are deleted.

The `jc303_wasm` submodule stays: `hyphon_native` compiles its rosic DSP, and the
emcc world hashes `jc303_wasm/src/dsp/open303`. `scripts/check-release-dist.mjs`
fails a `dist/` that still carries any `jc303*.js` / `jc303*.wasm` (a stale copy
left in `public/` would otherwise ship unreferenced); `public/osc/jc303.webp` is
UI art and is unaffected.

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

<a id="pyodide-when"></a>
### When to use the Pyodide oscillator (vs the AssemblyScript kernel)

`pyodide-saw|square|sine` are an **offline / experimental** mode, not a live-play
engine. Prefer the AS kernel (`wasm-*`, or `rust-*` / `cpp-*` / `dwgs-*`) for
anything you play, record or scrub in real time: it is in the entry graph, runs
in an AudioWorklet and has no multi-second boot. Choose Pyodide when you want to
prototype DSP in NumPy/SciPy, or bounce/export a part where start-up cost and a
~10 MB runtime do not matter. It only loads when a `pyodide-*` waveform is
selected (`requestPythonEngine`), so it adds nothing to boot size, and it is
vendored same-origin (`pnpm run vendor:pyodide`), so CSP is unchanged.

What `generate_wave()` in `src/pyodide/hyphon_engine.py` provides:

| Item | Detail |
|---|---|
| Oscillators | **Band-limited** single-cycle tables (irfft, harmonics capped at Nyquist), not naive `scipy.signal.sawtooth`. Alias energy at 3 kHz drops from ~0.79 to ~3e-6. |
| Shapes | `saw`, `square`, `tri` (true triangle; the `tri` WaveShape no longer maps to sine), plus `pulse` (25%), `supersaw` (7 detuned), `organ`, `fm`, `sine`. The extra shapes are reachable by Python callers; the public `pyodide-*` IDs are unchanged (they are baked into the pack/tool validators). |
| Filter | RBJ resonant 2-pole low-pass via `scipy.signal.lfilter`; `resonance` 0..1 maps Q 0.7..~12 (previously ignored). High resonance goes through a `tanh` soft limiter. |
| Fallback | A non-finite filter result falls back to the dry oscillator. |

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
  `src/pyodide/hyphon_engine.py`, imported with `?raw`. `pythonEngineStore.ts`
  imports the bootstrap lazily and only when something asks for Python (a
  `pyodide-*` waveform, an explicit Python render, the overlay's LOAD control),
  so both land in their own chunk that a default session never fetches. The global contract
  (`hyphonPyodide`, `hyphonPyodideReady`, the `hyphon-pyodide-ready` / `-error`
  events) is unchanged.
- `emscripten/main.cpp` and `pyodide_bootstrap.js` are deleted; both voice
  profiles link `--no-entry` and export the same functions.
- The StartOverlay's "NATIVE MODULE" line comes from
  `src/engines/hyphonNativeProbe.ts`: it fetches the profile the first voice will
  select and `WebAssembly.validate`s it — no instantiation, and the bytes warm the
  HTTP / service-worker cache for the worklet. It is the only thing that gates
  `INITIALIZE SYSTEM`: ready, or failed with the JS fallbacks active. `mainThreadNativeModuleGuard.test.ts`
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
- Generates `public/rubberband.wasm` only (no glue: [#rubberband-no-glue](#rubberband-no-glue))

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


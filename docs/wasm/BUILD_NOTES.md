# WASM Build Notes

Covers `public/hyphon_native.wasm` (Emscripten: Open303 / JC303 / Prophecy /
HighFid303 / `audio_dsp`), `public/rubberband.wasm`, and the AssemblyScript
modules under `assembly/`.

- [Build profiles](#build-profiles)
- [Module split](#module-split)
- [Four Worlds memory budget](#four-worlds-memory-budget)
- [`-ffast-math`](#fast-math)
- [wasm-opt / link optimisation](#wasm-opt)
- [Export surface + export map](#export-surface)
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

`optimize` (`tools/optimize.sh`) is opt-in and is **not** part of `build` / `build:release`.

| | release | debug |
|---|---|---|
| Compile | `-O3 -funroll-loops` (`-ffast-math` opt-in per file) | `-O1 -g3 -fno-omit-frame-pointer` |
| Link | `-O1` | `-O1 -g3 -gsource-map` |
| Assertions | `-s ASSERTIONS=0` | `-s ASSERTIONS=2` |
| Stack checks | off | `-s STACK_OVERFLOW_CHECK=2` |
| Legacy `jc303_*` single-instance API | compiled out | compiled in |

Shared by both profiles: `-msimd128 -pthread`, `-s USE_PTHREADS=1`,
`-s PTHREAD_POOL_SIZE=4`, `-s WASM_BIGINT=1`, `-s ALLOW_MEMORY_GROWTH=1`,
`-s EXPORT_ES6=1`, `--bind`.

`HYPHON_LEGACY_JC303=1` forces the legacy export surface back into a release
build; `HYPHON_LEGACY_JC303=0` strips it from a debug build.

### Threading / OpenMP: the single source of truth

Emscripten 3.1.51 ships its own WASM-compatible OpenMP runtime, used when linking
with `-s USE_PTHREADS=1`. No host `libomp` is involved. The pthread pool exists
for Emscripten's own runtime work. Rubber Band is a separate module now and is
built `-DNO_THREADING` — it runs single-threaded inside the worklet. Comments
elsewhere that describe Rubber Band as OpenMP-parallel are stale; this section is
authoritative.

CI and `AGENTS.md` pin **Emscripten 3.1.51**, which still emits a separate
`*.worker.js` for pthreads. Emscripten 3.1.58+ inlines that worker into the
main JS, and 6.x no longer writes the file at all. `check:native` still
requires `public/jc303-threaded.worker.js` and `public/hyphon_native.worker.js`.
`scripts/ensure-pthread-worker-stamp.mjs` copies a real worker when present
and otherwise writes a stamp stub so Colab/`emsdk install latest` builds do
not fail after a successful compile.

---

<a id="module-split"></a>
## Module split

`hyphon_native.wasm` is the **voice** module: Open303, JC303, Prophecy,
HighFid303 and `audio_dsp`. Rubber Band is **not** in it.

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
| `public/jc303-*.wasm` | `tools/build_jc303_omp.sh` | `#standaloneJc303` | no |
| `src/wasm/*.wasm` | `asc` (see the AS matrix) | `#assemblyScript` (pages) | no |

Each has exactly one imported-memory contract, and no script carries memory
literals — every one reads the budget JSON. `src/__tests__/wasmMemoryBudget.test.ts`
enforces both.

`build_rubberband.sh` also grew the things it was missing: an `emsdk_env.sh`
search matching `build.sh`, the correct repo-root source path (it used to look
for `emscripten/rubberband/`, which does not exist), release/debug profiles, and
patching a **copy** of the submodule rather than the checkout — its two `sed`
fixes are not idempotent and were dirtying `rubberband/`.

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
| `INITIAL_MEMORY` | 512 MB (8192 pages) | **128 MB (2048 pages)** |
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
| Emscripten runtime + static data | ~6 MB | ~6 MB | glue, wavetables, embind tables |
| Stack (`STACK_SIZE`) | 8 MB | 8 MB | reserved; the 64 KB default is what the `__handle_stack_overflow` workaround in `open303-processor.ts` was fighting |
| 3 × Open303 / JC303 voices | ~2 MB | ~4 MB | per-instance state + oversampled scratch |
| Prophecy voice | ~1 MB | ~2 MB | |
| ~~Rubber Band stretch (finer, stereo)~~ | — | — | **moved to its own module** — see [Module split](#module-split). It was ~12 MB steady / ~40 MB peak here, and the reason a stretch could grow the voice heap mid-playback. |
| Offline/export scratch buffers | 0 | ~24 MB | `malloc`'d per render, freed after |
| Headroom / allocator fragmentation | — | ~30 MB | |
| **Total** | ~17 MB | **~74 MB** | was ~29 MB / ~114 MB with Rubber Band linked in |

128 MB still covers that peak with room to spare, and growth to 1 GB remains
available for long offline renders.

**Why 128 MB was not lowered along with the peak.** The ~40 MB that left is real,
but the number it left behind is still an analytic budget, not a device capture
(see the caveat below). Tightening the *initial reservation* on the strength of an
un-measured table would trade a known-good default for a guess, and the failure
mode — growth on the audio thread — is exactly what this budget exists to avoid.
The headroom is now genuine slack rather than a Rubber Band allowance; lower it
when someone has a capture.

TTS/Pyodide is **not** in this budget: Pyodide is a separate WASM runtime with its
own heap (`emscripten/pyodide_bootstrap.js` loads it independently of
hyphon_native's memory). A warm TTS adds tens of MB of *browser* memory but zero
bytes of hyphon_native heap.

### Honest caveat

The table above is an analytic budget derived from the allocation sites, not a
device capture — it has not been re-measured on hardware since this change.
Re-measure before tightening further:

```js
// In the page console, with 3×303 playing and a rubberband stretch running
// (they are separate heaps now — check both):
performance.measureUserAgentSpecificMemory?.().then(console.log);
// In the worklet (open303-processor), the authoritative number for this module:
console.log('hyphon heap MB', memory.buffer.byteLength / 1048576);
```

If the worklet reports growth past 128 MB during normal playback, raise
`initialMemoryMb` in the budget JSON. The test caps it at 256 MB deliberately:
going above that should be a measured decision, not a default.

---

<a id="fast-math"></a>
## `-ffast-math`

`-ffast-math` used to be a global release compile flag. It is now opt-in per
translation unit, via `compile_cpp_fast` in `emscripten/build.sh`, and
**`emscripten/audio_dsp.cpp` is its only user**.

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

`audio_dsp.cpp` — block mix, gain and pan over stateless `float` arrays. No
recursive state, no baseline contract, and reassociation is what makes the loops
vectorise. In the **debug** profile even that is compiled IEEE-safe
(`CXXFLAGS_FAST` equals `CXXFLAGS`), so a debug build is comparable with the
reference by construction.

`build_rubberband.sh` never enables it either: phase-vocoder accumulators and the
resampler are the same class of code as the filters above.

### Re-running the baselines

Removing the flag changes the release binary's output in the low bits, so the
303 baselines must be regenerated or re-verified after the next emcc build:

```bash
bash scripts/generate_303_baselines.sh      # requires a built hyphon_native
python3 scripts/303_metrics_cli.py --help   # spectrogram comparison
```

**This has not been run here** — the environment for this change has no
Emscripten toolchain, so no `hyphon_native.wasm` could be produced to compare.
It is the one acceptance item on this change that needs a machine with emsdk.
`src/__tests__/wasmCompileFlags.test.ts` locks the flag placement so the
source-level contract cannot regress in the meantime.

---

## wasm-opt

Link is `-O1` in **both** profiles. This is not an oversight: at `-O2`/`-O3`,
em++ 3.1.51 invokes its bundled `wasm-opt` with a feature set that does not match
this module (pthreads + SIMD + bigint), and the link fails. `-O1` skips that
invocation while the per-object `-O3` compile keeps the DSP hot paths optimised,
so the runtime cost is small — mainly missed cross-module inlining and no export
name minification.

### The pinned out-of-band pass

`tools/optimize.sh` is that revisit, and it is still **opt-in** — not part of
`build` or `build:release`.

**The pin lives in `emscripten/toolchain.json`**, recorded next to the Emscripten
version it accompanies:

| | version |
|---|---|
| Emscripten (CI, `build.sh`) | 3.1.51 |
| binaryen (`optimize.sh` only) | 119 (`binaryen@119.0.0` on npm) |

`optimize.sh` resolves `wasm-opt` from `$HYPHON_WASM_OPT`, then
`node_modules/.bin/wasm-opt`, then `npx --package=binaryen@119.0.0`. **`$EMSDK/upstream/bin/wasm-opt`
is deliberately not in that list** — that binary is the one that fails this link,
so silently picking it up off `$EMSDK` would reintroduce the exact problem the
`-O1` link pin exists to avoid. A `wasm-opt` reporting any other version is
refused outright (`HYPHON_ALLOW_UNPINNED_WASM_OPT=1` overrides, loudly).

Feature flags are **per module**, from `toolchain.json#binaryen.features`, because
enabling a feature a module was not built with lets later passes emit instructions
the target engine will reject. `hyphon_native` gets simd + threads + bulk-memory +
sign-ext + nontrapping-float-to-int; no module gets `--enable-relaxed-simd`,
because none is built with it.

### Why the export map needs a second check afterwards

`tools/extract_wasm_export_map.mjs` parses the **glue** (`hyphon_native.js`), and
an out-of-band `wasm-opt` run rewrites the `.wasm` without touching the glue. So
if a pass ever renamed exports, `check_wasm_export_map.mjs --glue` would still
pass while the worklets could no longer resolve a single function.

`check_wasm_export_map.mjs` therefore takes `--wasm` as well: it compiles the
binary and asserts every minified name in the map is a real export of it.
`optimize.sh` runs both after optimising:

```bash
node tools/check_wasm_export_map.mjs --glue public/hyphon_native.js \
                                     --wasm public/hyphon_native.wasm
```

(`-O3` does not rename exports on its own — that needs
`--minify-imports-and-exports`, which is not passed. The check is there so that
staying true is verified rather than assumed.)

---

## Export surface

`emscripten/wasm_export_manifest.json` declares the module's contract:

- **required** — called by shipped worklet/engine code. A build missing one is broken.
- **optional** — may legitimately be absent (profile-gated or pruned).
- anything else present is flagged as export bloat.

```bash
pnpm run check:exports                                                # validate committed map
node tools/check_wasm_export_map.mjs --glue public/hyphon_native.js   # + drift check
```

CI runs `check:exports` (see `.github/workflows/ci.yml`); `build.sh` runs it with
`--glue` after every link, so a rebuild that forgets to regenerate
`public/hyphon_wasm_export_map.json` fails at build time rather than silently
shipping a stale map to the worklets. When WASM artifacts are absent the check
exits 0 with a warning, so source-only CI jobs stay green.

### Pruned: legacy single-instance `jc303_*`

`jc303_init`, `jc303_noteOn/noteOff/allNotesOff`, `jc303_set{Waveform,Cutoff,
Resonance,EnvMod,Decay,Accent,Volume,FilterMode}` and `jc303_process` are gone
from release builds (`#if HYPHON_LEGACY_JC303` in `emscripten/jc303_wrapper.cpp`).

They were never reachable in hyphon_native: `open303-processor.ts` only falls back
to that API when `open303_*` is missing, which describes the standalone
`jc303-single.wasm` artifact (`tools/build_jc303_omp.sh`), not this module. The
worklet's `JC303_PARAM_MAP` message names (`jc303_setCutoff`, …) are unaffected —
those are *message* names translated into `open303_set_param` / `jc303_set_param`
param IDs, not exports. The fallback code path is retained and still builds under
the debug profile.

`highfid303_*` is kept but marked optional: the shipped realtime path does not call
it (`OfflineHighFid303Engine.ts` and the WGSL shader mirror it in TS/GPU instead).

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
| `pyodide_bootstrap.js` injecting the same jsDelivr URL | same-origin, from `HYPHON_PYODIDE_BASE_URL` |
| `loadPyodide()` with no `indexURL` | `loadPyodide({ indexURL: PYODIDE_BASE })` |
| `new Function('url', 'return import(url)')` | `await import(/* @vite-ignore */ moduleUrl)` |

`new Function` is `eval` as far as CSP is concerned, so the old importer required
`unsafe-eval` for the whole document. It existed only to stop Vite rewriting the
dynamic import of a `public/` asset (Vite appends `?import`, which 404s); the
`/* @vite-ignore */` comment does that without any eval.

`indexURL` matters as much as the `<script>` tag: without it Pyodide derives its
asset base from wherever its script came from and can still leave the origin.

### Vendoring

```bash
pnpm run vendor:pyodide            # ~76 MB into public/pyodide/
pnpm run vendor:pyodide -- --force # re-download
PYODIDE_BASE_URL=https://mirror/... pnpm run vendor:pyodide
```

Version and file list are pinned in `emscripten/toolchain.json#pyodide` — the same
file the binaryen pin lives in. `scripts/fetch-pyodide.mjs` also resolves the
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
  `new Function`, `indexURL` set, base set before the module that boots it
  (the first inline module script has a top-level `await`, which would defer a
  later one past the bootstrap).
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


# WASM Build Notes

Covers `public/hyphon_native.wasm` (Emscripten: Open303 / JC303 / Prophecy /
HighFid303 / Rubber Band) and the AssemblyScript modules under `assembly/`.

- [Build profiles](#build-profiles)
- [Four Worlds memory budget](#four-worlds-memory-budget)
- [wasm-opt / link optimisation](#wasm-opt)
- [Export surface + export map](#export-surface)
- [AssemblyScript browser matrix](#assemblyscript-browser-matrix)
- [Appendix: Rubber Band integration notes](#appendix-rubber-band-integration-notes)

---

## Build profiles

```bash
pnpm run build:emcc          # release (default)
pnpm run build:emcc:debug    # debug
pnpm run build:native        # all Four Worlds
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
| Compile | `-O3 -ffast-math -funroll-loops` | `-O1 -g3 -fno-omit-frame-pointer` |
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
with `-s USE_PTHREADS=1`. No host `libomp` is involved. Rubber Band is compiled
**without** its own OpenMP parallelisation (the `#pragma omp` patches in
`build.sh` are disabled); it runs single-threaded inside the worklet, and the
pthread pool exists for Emscripten's own runtime work. Comments elsewhere that
describe Rubber Band as OpenMP-parallel are stale — this section is authoritative.

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
| Rubber Band stretch (finer, stereo) | ~12 MB | ~40 MB | scales with window size and channel count; the dominant transient |
| Offline/export scratch buffers | 0 | ~24 MB | `malloc`'d per render, freed after |
| Headroom / allocator fragmentation | — | ~30 MB | |
| **Total** | ~29 MB | **~114 MB** | |

128 MB covers that peak without growth in the common case, and growth to 1 GB
remains available for long offline renders.

TTS/Pyodide is **not** in this budget: Pyodide is a separate WASM runtime with its
own heap (`emscripten/pyodide_bootstrap.js` loads it independently of
hyphon_native's memory). A warm TTS adds tens of MB of *browser* memory but zero
bytes of hyphon_native heap.

### Honest caveat

The table above is an analytic budget derived from the allocation sites, not a
device capture — it has not been re-measured on hardware since this change.
Re-measure before tightening further:

```js
// In the page console, with 3×303 + a rubberband stretch running:
performance.measureUserAgentSpecificMemory?.().then(console.log);
// In the worklet (open303-processor), the authoritative number for this module:
console.log('hyphon heap MB', memory.buffer.byteLength / 1048576);
```

If the worklet reports growth past 128 MB during normal playback, raise
`initialMemoryMb` in the budget JSON. The test caps it at 256 MB deliberately:
going above that should be a measured decision, not a default.

---

## wasm-opt

Link is `-O1` in **both** profiles. This is not an oversight: at `-O2`/`-O3`,
em++ 3.1.51 invokes its bundled `wasm-opt` with a feature set that does not match
this module (pthreads + SIMD + bigint), and the link fails. `-O1` skips that
invocation while the per-object `-O3` compile keeps the DSP hot paths optimised,
so the runtime cost is small — mainly missed cross-module inlining and no export
name minification.

To revisit: pin a known-good binaryen, run it out of band on the linked `.wasm`
(`wasm-opt -O3 --enable-simd --enable-threads --enable-bulk-memory`), and re-run
`tools/extract_wasm_export_map.mjs` afterwards, since minification renames
exports. That regeneration is exactly what the export map exists for.

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
--target wasm-gc --enable gc --enable reference-types
--enable simd --enable relaxed-simd --enable bulk-memory
--enable threads          (oscillators only)
--initialMemory 128–384 pages
```

Page counts are mirrored in `emscripten/wasm_memory_budget.json#assemblyScript`
and asserted by `src/__tests__/wasmMemoryBudget.test.ts`.

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

| Feature | Chrome / Edge | Firefox | Safari |
|---|---|---|---|
| SIMD (`simd128`) | ✅ 91+ | ✅ 89+ | ✅ 16.4+ |
| Relaxed SIMD | ✅ 114+ | ✅ 120+ | ⚠️ recent only — verify per release |
| Bulk memory | ✅ | ✅ | ✅ 15+ |
| Reference types | ✅ | ✅ | ✅ 15+ |
| Threads + SharedArrayBuffer | ✅ (COOP/COEP) | ✅ (COOP/COEP) | ⚠️ COOP/COEP required; historically flaky inside AudioWorklets on iOS |
| **WasmGC (`--target wasm-gc`)** | ✅ 119+ | ✅ 120+ | ⚠️ **the risk** — trails the others; older supported Safari refuses the module outright |

**Assessment.** `wasm-gc` + `relaxed-simd` + `threads` together form the narrowest
intersection in the stack, and Safari is the binding constraint. Nothing in
`assembly/` needs GC semantics — these are numeric DSP kernels over linear memory —
so `--target wasm-gc` buys nothing for the modules that ship, while costing older
Safari the whole module rather than degrading one feature.

**Recommendation (not yet applied):** move the AS modules back to the classic MVP
target and drop `--enable gc` / `--enable relaxed-simd`, keeping `simd`,
`bulk-memory` and (oscillators only) `threads`. If a measured relaxed-SIMD win
exists, dual-build `oscillators.wasm` (MVP) alongside `oscillators.relaxed.wasm`
and choose at load time via a capability probe, rather than shipping one module
that fails hard. Left as a follow-up deliberately: it needs a benchmark to justify
either direction, and this change set is scoped to the Emscripten memory/profile
work.

Loader behaviour to keep in mind: a `CompileError` from an unsupported feature
surfaces at `WebAssembly.compile`, before any worklet exists, so the fallback has
to live in the engine wrapper (`src/engines/*Oscillator.ts`), not the worklet.

---

## Appendix: Rubber Band integration notes

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
**Command**: `./emscripten/build_rubberband.sh`

**Requirements**:
- Emscripten SDK installed
- Git submodules initialized

**What it does**:
- Clones/updates rubberband library
- Compiles C++ wrapper with Emscripten
- Generates `public/rubberband.js` and `public/rubberband.wasm`

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


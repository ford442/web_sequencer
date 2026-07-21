# JC303 / Open303 Engine Selection + Prophecy Integration

> **See also:** [303-voices.md](303-voices.md) — the growing selectable 303 voice
> catalog (`model303`), registry contract, and how to add new voices.

This note documents the current `hyphon_native.wasm` engine layout for TB-303-style synthesis and Korg Prophecy-style formants.

## 1) Dual 303 engine model in `hyphon_native.wasm`

`emscripten/build.sh` compiles both wrappers into one native module:

- `emscripten/open303_wrapper.cpp` → `open303_*` API
- `emscripten/jc303_wrapper.cpp` → `jc303_*` multi-instance API (authentic rosic/Open303 path)

The AudioWorklet processor (`src/audio-worklets/open303-processor.ts`) supports per-instance switching with:

- `set-engine` message (`'open303' | 'jc303'`)
- `activeEngine` routing for note/param/process calls

At TypeScript level:

- `SynthParams.engine303` (`src/types.ts`)
- `Open303Manager.setBass1Engine/setBass2Engine/setLead303Engine`

## 2) Current routing (SYNTH B + BASS 2 + partA LEAD)

Current voice mapping in `Open303Manager` + `audioPlayback`:

- `partB` (`SYNTH B` when waveform is `303-*`) → `bass1`
- `BASS 2` (`303-*`) → `bass2`
- `partA` (`SYNTH A LEAD`, `303-*`) → `lead303`

ASCII routing snapshot:

```text
partA 303-*  ─────► lead303 ──┐
partB 303-*  ─────► bass1   ──┼──► open303-processor ─► hyphon_native.wasm
bass2 303-*  ─────► bass2   ──┘        (open303 or jc303 per voice)
```

## 3) Prophecy formant engine status

`hyphon_native.wasm` also exports `prophecy_*` via `emscripten/prophecy_wrapper.cpp`.

Runtime path:

- `ProphecyOscillator` + `prophecy-processor` worklet
- `ProphecyManager` manages partA + partB instances
- Routing in `src/hooks/audioEngine/audioPlayback.ts` and `src/audio/playback/synthPlayback.ts`
- Parameter IDs in `src/engines/ProphecyParams.ts`

Waveforms: `prophecy-saw`, `prophecy-sqr`, `prophecy-tri`, `prophecy-pulse`.

## 4) Build notes when wrappers change

After editing any of:

- `emscripten/open303_wrapper.cpp`
- `emscripten/jc303_wrapper.cpp`
- `emscripten/prophecy_wrapper.cpp`

rebuild Emscripten output:

```bash
npm run build:emcc
# or:
bash emscripten/build.sh
```

For standalone submodule builds (legacy `public/jc303*` artifacts), use:

```bash
npm run build:wasm:jc303
# or:
bash tools/build_jc303_omp.sh release both
```

## 5) Memory requirement reminder (threaded native module)

Both `open303-processor.ts` and `prophecy-processor.ts` enforce:

- minimum `memoryPages = 8192` (8192 × 64KB pages = 512 MB) for threaded `hyphon_native.wasm`

Keep this aligned with Emscripten linker memory settings in `emscripten/build.sh`.

## 6) UI caveat / tracking

Engine + formant internals are active in the audio engine, but UI visibility/discoverability is still in progress.

Tracking:

- `#632`
- `#633`
- `#634`

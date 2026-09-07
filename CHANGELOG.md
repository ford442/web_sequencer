# Changelog

## Unreleased

### WAM2 host compatibility spike (Phase A)
- Local-first Web Audio Modules 2.0 host on the existing declarative graph (`wam2` ids — distinct from AssemblyScript `wam-*` oscillators).
- Bundled MIT fixtures: `hyphon.tone` (instrument) and `hyphon.gain` (track/master insert).
- Sequencer notes, one automatable parameter, song save/load, missing-plugin bypass, Engine HUD telemetry.
- Official SDK pin `@webaudiomodules/sdk@0.0.12` (MIT, lazy-load only). ADR: [0001-wam2-host.md](docs/adr/0001-wam2-host.md).

### High-fidelity TB-303 offline path (epic #972 / Phase-6 #979)
- **Multi-core offline rendering**: OpenMP oversampling (`1` / `2` / `4`) and a worker pool for freeze / export / multisample — real-time AudioWorklet latency unchanged ([OFFLINE_303_OVERSAMPLE.md](docs/audio-engine/OFFLINE_303_OVERSAMPLE.md)).
- **High-Fidelity CPU** (`highfid-cpu`): diode-ladder offline reference with PolyBLEP oscillators and coupled accent ([HIGHFID_CPU_303.md](docs/audio-engine/HIGHFID_CPU_303.md)).
- **GPU High-Fidelity** (`gpu-highfid`): WGSL WebGPU authenticity tier with automatic fallback to CPU when WebGPU is unavailable ([GPU_HIGHFID_303.md](docs/audio-engine/GPU_HIGHFID_303.md)).
- **UI**: Voice303Selector lists offline voices with **HIFID** / **Offline** / **No GPU** badges; live play stays on Stock Open303 while the selected id is persisted for export.
- **Quality gates**: spectrogram / RMS tests, offline benchmarks, cross-browser Playwright matrix, and stress tests ([303-A-B-checklist.md](docs/audio-engine/303-A-B-checklist.md)).
- **Docs**: architecture & FAQ — [303-gpu-highfid.md](docs/audio-engine/303-gpu-highfid.md).

### Real-time high-fidelity TB-303 (Phase-L1, post-#972)
- **Live High-Fidelity voice** (`live-highfid`): the diode-ladder DSP now runs inside the AudioWorklet at oversample 1×, so authenticity can be auditioned while the sequencer plays instead of only after a freeze.
- **CPU / glitch gate**: sustained over-budget CPU or repeated underruns hand the voice back to Stock Open303 with a stated reason — it degrades instead of glitching.
- **Freeze matches play**: freeze / export / multisample of a live high-fid track renders through the same `highfid-cpu` diode ladder.
- **Engine HUD** gains a **Live 303 path** section (audible path, rolling CPU %, oversample, fallback reason); the voice selector shows an amber **Live** pill.
- Stock and JC303 voices are untouched — the high-fid WASM instance is created lazily on first selection, so real-time latency for stock voices is unchanged.
- Docs: [303-realtime-highfid.md](docs/audio-engine/303-realtime-highfid.md), including the L2–L5 tracking checklist (live A/B, editable coefficients, hardware oracle, GPU live).

### In-app discoverability (closes #632, #633, #634)
- Searchable **Help** modal (`?` key): Search · Guides · Shortcuts tabs
- Dismissible **What's New** checklist for major workflows
- Contextual **?** tooltips on 303 engine selector, Prophecy panel, REC AUTO, RBS import, TTS, Song mode
- First-use tips on engine selection (dismissible, stored in localStorage)

### Audio engine visibility updates
- Documented dual 303 engine support in `hyphon_native.wasm` (`open303_wrapper.cpp` + `jc303_wrapper.cpp`) including per-voice `engine303` selection.
- Documented Prophecy formant integration (`prophecy_wrapper.cpp`, `prophecy-processor`, `ProphecyManager`) and current routing.
- Added in-app help entry: **Engine Selection & Formant Synths**.

### Caveats
- UI discoverability for these features is still in progress; see tracking issues:
  - [#632](https://github.com/ford442/web_sequencer/issues/632): per-voice 303 engine selection UI follow-up
  - [#633](https://github.com/ford442/web_sequencer/issues/633): Prophecy controls/discoverability follow-up
  - [#634](https://github.com/ford442/web_sequencer/issues/634): related engine/help visibility tracking

# Changelog

## Unreleased

### Patch bay: low-pass filter mode, standard (RBJ) vs openrb / ReBirth
- **Mode parameter on low-pass nodes**: `BiquadFilterConfig.filterMode` is `rbj` (the browser biquad, the default) or `openrb`. The palette offers it, and a selected low-pass node has a live **Standard (RBJ) / openrb / ReBirth** switch. Both filters run in parallel behind a 20 ms crossfade (`LowpassModeSwitch`), so A/B comparison needs no rebuild. Anything that can be cabled through a low-pass can use either mode. Offline renders follow the same path.
- **openrb mode is ReBirth 2.01's PCF low-pass**, run with its envelope at rest. Upstream openrb-338's coefficient table (8 × 512), smoother and 2-pole filter are extracted into `openrb338/src/pcf_lp.rs`, with an adapter (`lowpass.rs`) for Hz/Q, the host rate and the output gain, and an optional `openrb_lp_*` export group in `openrb338.wasm`. At 44.1 kHz the table is bit-identical to upstream and the output matches upstream's `Pcf` bit for bit, native and wasm, in every chunking (`pnpm run verify:openrb338`). Other host rates shift the table index to keep the pole frequency; they are not bit-exact.
- **Opt-in, like the openrb-338 voices**: the module is GPL-3.0-only and not bundled. A build loads it only when `VITE_OPENRB338_WASM_URL` is set. Without it, openrb mode plays RBJ, the patch bay says why, and the patch keeps the mode. See [openrb-lowpass.md](docs/audio-engine/openrb-lowpass.md), which also covers the floating-point matching expectations.

### openrb-338 TB-303 as a WASM module: extraction spike (#1537)
- **New world `openrb338/`**: openrb-338's `Tb303` and the tables it reads, extracted into a standalone Rust crate from upstream rev `88a1770`. The DSP code is unchanged. A thin adapter turns MIDI notes, velocity accents, legato slides and the shared normalized 303 params into ReBirth step bytes and knob positions, and a C ABI matches `Openrb338Exports`. It builds to a 40 KB `openrb338.wasm` with no imports. **GPL-3.0-only**, with its own `LICENSE`. The build is opt-in (`pnpm run build:wasm:openrb338`), its output is gitignored, and it is not part of `build:native` or `public/`.
- **Bit-exact at 44.1 kHz**: `pnpm run verify:openrb338` checks the tables, the native adapter and the wasm module, through its C ABI from Node, against upstream `orb-engine` at the same revision, sample for sample. The check covers 7 scenarios (both sound models, accents, slides, rests, knob sweeps, mode switches, stop) and four render chunkings. Other host rates are resampled and stay within 0.01 dB of the reference level. The cost is about 1–2 µs per 128-frame quantum.
- **Documented** in [openrb338-voice.md](docs/audio-engine/openrb338-voice.md): the ABI, the divergences (host rate, rest steps, how Hyphon schedules slides) and the integration plan for the `Open303EngineSelection` route. The voices still play Stock Open303 until the worklet loads the module.

### One note-name grammar for the parser, the AI song format and the agent (#1493)
- **One pattern**: `NOTE_NAME_SOURCE` in `musicTheory.ts` is the AI-song validator (`isValidNote`), the generated `docs/schemas/ai-song.schema.json` pattern and the co-producer's `edit_pattern` schema. A name the file formats call valid is a name `noteToMidi` turns into a pitch. The AI format now takes what the parser takes: a flat or sharp, a doubled one (`##`, `bb`, `x`, `𝄪`, `𝄫`, `♯`, `♭`), and octaves -1 to 9 (`Eb3`, `Fx3`, `C-1`). Strings are stored as written.
- **Tighter than before**: at most one accidental, of one kind. `C#b4`, `C###4` and `E##########4` used to parse (as 60, 63 and 74); they are not note names now. The pitch must be MIDI 0–127 (`C-1`–`G9`): `G#9`–`B9` used to parse as 128–131, which no MIDI data byte can hold, and are now refused rather than clamped. `edit_pattern` checks the range too, since a pattern cannot.
- **New**: `parseNoteName()` returns `{ pitchClass, octave, midi }` (the octave of the sounding pitch: `Cb4` is B3) for code that labels or colours a name. `noteColors` uses it, so `C-1` gets a colour and the second regex is gone.
- **Exports say what they left out**: SMF and RBS export leave a name that is not a note out of the file (no note 0) and add a warning such as `2 notes were left out because the name is not a note ("Hb4", "G#9").` A blank name is a rest and is not counted.
- **Fix**: a chord inversion counts the voices that sound. A chord with one name that does not parse used to rotate its other voices twice, which transposed it an octave instead of inverting it.

### Co-producer, phase 1: the open song as an AI song, and the agent's tools
- **`exportAISong()`**, the inverse of the AI song importer: the open song as `AISongData` v1.0 / v1.1, with patterns named after their slot (`slot3`). Pattern-local lanes come back as pattern-local lanes, and anything the format cannot carry is reported in `losses`, not dropped. Importing the export plays the same song, and exporting again gives the same JSON. Every fixture and fast-check generators of strict-valid songs are held to it.
- **Seven tools as pure functions over the song, with no SDK yet**: `get_song`, `import_song`, `edit_pattern`, `set_params` (knobs, lanes that play live, tempo, swing), `arrange`, `render_and_measure` and `export`. Every input is validated in `run` by ajv validators precompiled at build time (`pnpm run gen:coproducer-validators`; the runtime ships no ajv). A bad input is an error result, never a throw. Each edit is one undo step labelled `Co-producer: …` and answers with a compact diff.
- **On the agent hook**: `window.__HYPHON_AGENT__.exportAISong()` and `.coproducer` (`tools` / `run` / `history` / `undo` / `downloads`). Live-pattern edits go through the piano roll's commit. See [coproducer.md](docs/coproducer.md).

### Real-time control plane, phase 2: the main thread writes a voice's own ring; 303 and Prophecy on the bus (#1497)
- **One ring layout for both languages**: the event ring's header joins `emscripten/core/event_schema.json`, and `hyphon::EventRing` now uses the same bytes as `src/shared/rt/eventRing.ts` (generated `EventRingHeader`, with `static_assert`s on every word). A ring can sit at any offset of a buffer.
- **No copy on the pthread build**: each native voice has an inbox ring, and `prefix_event_inbox` returns its address. The drum and Prophecy worklets offer it in their `ready` message. The engine's route then writes records straight into hyphon_native's shared memory, and the C++ voice takes them at block start. Before the voice is ready, and on the single-threaded build, records go as one batched message per tick.
- **303 and Prophecy notes and params are records**: `Open303Oscillator` and `ProphecyOscillator` no longer post a message per note, param or stop. The 303 worklet routes each record to the voice its engine selection picks. A 303 param now reaches every voice the part owns, so an engine switch can never leave the new engine with stale params.
- **A stop is a record**: the new `CANCEL_NOTES` type drops the notes and hits queued before it, and keeps those sent after it. A stop followed by a restart in the same task now keeps the restart's notes on every transport. Drums, Prophecy and the 303 all stop this way.
- Nine per-event `port.postMessage` call sites are gone. See [VOICE_CORE.md#control-plane](docs/wasm/VOICE_CORE.md#control-plane).

### Real-time control plane, phase 1: one event record, a shared-memory ring, drums on it (#1497)
- **One schema for both languages**: `emscripten/core/event_schema.json` defines the 32-byte event record (frame, type, target, value, four args) and its types. `pnpm run gen:native-types` generates `hyphon::Event` (`emscripten/core/event_layout.h`, with `static_assert`s on its size and offsets) and the TypeScript `EventWriter` / `EventReader` (`src/shared/rt/eventLayout.ts`). `pnpm lint` and `check:exports` fail when either is stale. New record types, not yet handled by any engine: `PARAM_RAMP`, `MUTE`, `NOTE_EXPRESSION`.
- **Transport**: a lock-free SharedArrayBuffer event ring where the pthread profile runs, and batched `postMessage` (one transferred buffer per tick, not one message per event) on WebKit and on pages that are not crossOriginIsolated. Producers use one `EngineEventSink` interface on the main-thread `EventBus` and never branch on the transport. When the ring is full it drops the newest record and counts it. Hot producers stage records in a Float64Array (`bus.stage` + `commit`) and the worklet decodes with `popInto`, so no number is boxed: a perf test measures 3.3 KB of heap over 100k records.
- **Drum hits go through it**: `DrumKitEngine` no longer posts a message per hit. Each hit is a pan record plus a trigger record on the hit's frame, and a transport stop flushes queued hits to the worklet before it cancels them. Timing is unchanged: a kick through either transport is sample-identical to the old message. See [VOICE_CORE.md#control-plane](docs/wasm/VOICE_CORE.md#control-plane).

### Build hygiene after the 10-02 epics: dead code, link profiles, worklet typing
- **Standalone JC-303 world retired**: `build:native` no longer builds `public/jc303-{single,threaded}*` (or the legacy `jc303.{js,wasm}` / `jc303_worklet.js`); nothing loaded them — JC303 runs inside `hyphon_native`. `check-release-dist` fails a `dist/` that still ships a `jc303*.js` / `.wasm`.
- **Rubber Band and the mix bus link at `-O3 -flto`** like the voice module: stretcher output bit-identical, Rubber Band 13–19 % faster and its wasm 16 % smaller, mix-bus sum 28 % faster. The mix-bus peak is now explicit `f32x4.pmax` (2× faster) and **skips NaN samples like the JS path** — the old release build reported a NaN peak for a stem containing one. Rubber Band keeps memory growth (an uncapped sample is copied into its heap); a new test proves the worklets survive a grow after every allocating call. See [BUILD_NOTES](docs/wasm/BUILD_NOTES.md#standalone-link-profiles).
- **~5,700 lines of unreached modules deleted** (old panels, a duplicate harmonizer popover, four never-loaded worklets, …). `pnpm lint` now runs **knip**: a module no production entry reaches fails lint.
- **WAM2 generic editor reachable**: the Engine HUD's per-slot **Edit** button opens the descriptor-driven editor (params, automation lanes, presets) that ADR 0001 describes.
- **Worklet code type-checks against `AudioWorkletGlobalScope`** (its own `tsc -b` project, no DOM): `window`, `fetch` or `setTimeout` in a worklet is a compile error. Code shared by both sides lives in `src/shared/rt/`.

### Flat note names play at their pitch (#1466)
- **Fix**: `noteToMidi` understood only sharps, so `Eb3`, `Bb3`, `Cb4`, `F##3` and `C-1` all parsed as MIDI 0 (≈ 8 Hz), live and offline. The AI reference song (`full.json`) has five such notes. The parser now takes a letter, any run of `#` `b` `♯` `♭` `x` `𝄪` `𝄫`, and an octave from `-1` to `9`, and folds every spelling to one MIDI number (`Eb3` = `D#3` = 51). `midiToNote` still spells with sharps.
- **Invalid names return `null`, never 0**: every caller now skips the note (live engines, sampler, drums, WAM, macro / freeze / stem renders, SMF and RBS export) instead of playing MIDI 0. `tunedNoteToFrequency` / `noteToFrequency` return `null` too. The renderer worker and the lyric transposer use the shared parser instead of their own copies.

### `pnpm run ai-song:render` — agents render and check their own songs (#1386)
- **One command, no human**: imports an `AISongData` song into the built app in headless Chromium and writes `mix.wav` (the export modal's live-patch master), optional `stems/*.wav`, `song.rbs` / `.mid` / `.xm`, and `report.json` — importer warnings, the stem export report, and per-stem peak, BS.1770 LUFS, and RMS + spectral centroid per bar. Exit codes: 2 validation, 3 render failure, 4 silent master. See [ai-song-render.md](docs/ai-song-render.md).
- **Strict by default**: any importer warning fails the run, and the importer now **warns about automation lanes live playback never dispatches** (drums, sampler, `pitch`, …) instead of importing them silently.
- **`window.__HYPHON_AGENT__`** (only with `?agent=1` / `?e2e=1`): calls the same functions as the import modal and the export buttons, plus `captureLive`, which records a live 303 voice — used to show a cutoff lane moves a JC303 voice like open303.
- **Fix**: stems and the AI song preview threw (`setValueAtTime … -0.14`) on an automated synth track whose notes are shorter than their release; found by the new command on `full.json`.

### Sampler custom grain envelope now applies
- The drawn **custom grain envelope** (sampler knobs and per-note override) was saved but never reached the worklet: playback never sent it, and the message omitted the `data` wrapper the worklet reads. Both are fixed, so grain envelopes users drew and saved will now be audible in granular / frozen playback.

### Macro engine family — 24 Plaits models on SYNTH A / B
- **New `macro-*` waveforms**: virtual analog, waveshaping, 2-op and 6-op FM, granular formant, harmonic, wavetable, chords, speech, swarm, filtered / particle noise, inharmonic string, modal resonator, analog drums, and the extended bank (filtered VA, phase distortion, wave terrain, string machine, chiptune) — the Mutable Instruments Plaits DSP (MIT), vendored as pinned submodules and compiled into `hyphon_native.wasm` (+218 KiB). See [macro-voices.md](docs/audio-engine/macro-voices.md).
- **8-voice polyphony per part**: step chords play as chords; mono mode glides slid steps legato. Stereo from the AUX output.
- **Panel**: MAC family, a 24-model grid, HARMONICS / TIMBRE / MORPH / DECAY / COLOUR knobs (MIDI-learnable, automatable, per-step lanes), GATE / PING low-pass gate, voice count, 43 factory patches and a **Macro Palette** session pack.
- **Never silent**: a build or browser that cannot run the engine plays a documented fallback waveform and says so in the Engine HUD. Freeze / stems / AI preview / XM render through the same wasm offline, bit-identical to live.
- **Denormal guards**: wasm has no flush-to-zero, so the build compiles a staged copy of the Plaits sources with named guards (`tools/plaits_wasm_patches.mjs`); worst model 8.6 % of a render quantum for 8 voices (modal was 46 %).
- `rust-*` / `cpp-*` are gone from the `Waveform` / `OscillatorType` unions (still rewritten on load), with their dead RUST / CPP selector buttons and panel art.
- MIT notices ship in `dist/THIRD_PARTY_NOTICES.md` (release gate enforced).

### Offline graph — what you hear is what you bounce (#1233)
- **One compiler**: `compileOfflineGraph` builds the `OfflineAudioContext` for track freeze, the stem-ZIP master and the AI song preview from the **live patch bay** config, through the same `compileAudioGraph` the running engine uses ([offline-graph.md](docs/audio-engine/offline-graph.md)).
- **Export sample rate follows the user policy** (the export half of #1136): `44100` / `48000` verbatim, `native` resolved from the live `AudioContext.sampleRate`. Stem export no longer hardcodes 44.1 kHz, and the export dialog offers "Match live".
- **Master loudness offline** (#1095): the persisted limiter settings run over the rendered mix at the same point in the chain as the live worklet, so the file matches the meters.
- **WAM2 freeze contract** (ADR 0001): bundled fixtures render offline; community / SDK packages are bypassed with a stated reason and a badge — never substituted by a first-party engine.
- **AI song preview plays audio**: the modal renders the first bars through the same graph and lists what it could not play (TTS banks, samples that load on import, unsupported inserts) instead of a "coming soon" toast.
- Stem `metadata.json` now carries `routing`, `sampleRatePref`, `liveSampleRate` and the full offline-graph report.

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

### Real-time high-fidelity TB-303 — live A/B + editable diode ladder (Phases L2/L3)
- **Live A/B** (L2): a part on `live-highfid` can arm **A/B vs stock**. The same worklet plays Stock Open303 (A) and the diode ladder (B) from one note stream on two outputs. You can flip or blend them with an equal-power crossfade while the sequencer runs. The blend is saved on the song and automatable (`abMix` on `synthA` / `synthB` / `bass2`).
- **Lazy and stock-safe**: nothing is allocated until A/B is armed on a live-highfid part, and there is no second oscillator, WASM module or `hyphon_native` heap. The CPU gate still only trips the high-fid side and collapses the blend to A; the stock side's notes and profile are untouched.
- **Freeze of an A/B part records one side**: high-fid at blend ≥ 0.5, stock below. Blends are not frozen until the offline graph compiler (#1235) can render both.
- **Editable diode-ladder coefficients** (L3): transistor mismatch, decay curve, accent coupling and filter tracking are new `highfid303_set_param` ids (14–17), mirrored in the TS offline engine. They are saved on the song as `model303Extra.highFidCoefficients`. Knob moves reach the worklet through a 20-byte SharedArrayBuffer table when cross-origin isolated, otherwise by message.
- **Canonical preset**: the defaults reproduce the pre-L3 diode ladder bit for bit, so the spectrogram / RMS gates are unchanged. A freeze uses the song's coefficients only when the song stored some; otherwise it uses the canonical preset.
- **Engine HUD**: A/B blend plus one CPU row per side.

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

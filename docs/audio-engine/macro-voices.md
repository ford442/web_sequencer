# Macro voices — 24 synthesis models, 8-voice polyphony

The `macro-*` waveform family puts 24 synthesis models on SYNTH A and SYNTH B:
virtual analog, waveshaping, 2-op and 6-op FM, granular formant, additive,
wavetable, chords, speech, swarm, filtered and particle noise, inharmonic
string, modal resonator, analog drums, and the extended bank (filtered VA,
phase distortion, wave terrain, string machine, chiptune). The DSP is the
Mutable Instruments **Plaits** source code (MIT), vendored as pinned
submodules and compiled into `hyphon_native.wasm` beside the 303s, Prophecy
and the drum kit.

The family is called **MACRO** in the UI (badge `MAC`). Following the eurorack
repository's guidelines for derivative works, the module's name is not used as
the product name; the attribution is in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

```
SYNTH A/B (macro-*) ─ MacroManager ─ MacroOscillator ×2 ─ macro-processor (AudioWorklet)
                                                           │  NativeVoiceProcessor (voice core)
                                                           ▼
                         hyphon_native.wasm  macro_* ─ MacroEngine (8 voices, 48 kHz)
                                                         ├─ MacroVoice × 8 (Plaits engines, LPG)
                                                         └─ polyphase resampler → context rate
```

## Models

The waveform id names the model; it and the native engine index are
**persisted** (songs, presets, automation). Order is Plaits' own
`Voice::Init` registration order.

| # | Waveform | Model | HARMONICS | TIMBRE | MORPH | AUX |
|---|---|---|---|---|---|---|
| 0 | `macro-va-vcf` | VA + filter | Resonance | Cutoff | Wave / sub | 12 dB variant |
| 1 | `macro-phase-dist` | Phase distortion | Distortion freq | Amount | Asymmetry | Unsynced variant |
| 2–4 | `macro-fm6-a/b/c` | 6-op FM, banks A–C (32 factory patches each) | Patch | Modulator level | Envelope stretch | — |
| 5 | `macro-wave-terrain` | Wave terrain | Terrain | Path radius | Path offset | — |
| 6 | `macro-string-machine` | String machine | Chord | Chorus / filter | Waveform | — |
| 7 | `macro-chiptune` | Chiptune | Chord | Arpeggio | PW / sync | Bass note |
| 8 | `macro-va` | Virtual analog | Detune | Square | Saw shape | Hard-sync pair |
| 9 | `macro-waveshaper` | Waveshaper | Shaper | Fold | Asymmetry | Variant |
| 10 | `macro-fm2` | 2-op FM | Ratio | Index | Feedback | Sub-oscillator |
| 11 | `macro-grain` | Granular formant | Formant ratio | Formant | Width | Windowed sines |
| 12 | `macro-additive` | Harmonic | Bumps | Peak harmonic | Bump shape | Organ harmonics |
| 13 | `macro-wavetable` | Wavetable | Bank | Row | Column | Lo-fi 5-bit |
| 14 | `macro-chords` | Chords | Chord type | Inversion | Waveform | Root note |
| 15 | `macro-speech` | Speech | Synth / word bank | Species | Phoneme | Raw vocal cords |
| 16 | `macro-swarm` | Swarm | Pitch spread | Density | Grain size | Sine |
| 17 | `macro-noise` | Filtered noise | LP → HP | Clock | Resonance | Dual band-pass |
| 18 | `macro-particle` | Particle noise | Randomness | Density | Filter type | Raw dust |
| 19 | `macro-string` | Inharmonic string | Material | Brightness | Decay | Exciter |
| 20 | `macro-modal` | Modal resonator | Material | Brightness | Decay | Exciter |
| 21 | `macro-bass-drum` | Analog bass drum | Punch | Tone | Decay | FM bass drum |
| 22 | `macro-snare` | Analog snare | Snappy | Tone | Decay | Synthetic snare |
| 23 | `macro-hihat` | Analog hi-hat | Metal / noise | High-pass | Decay | Variant |

The catalog is `MACRO_ENGINES` in `src/engines/MacroParams.ts`; the knob
captions above are its `knobs` field, shown on the rack knobs and the model
buttons' tooltips.

## Parameters

`SynthParams.macro` (`src/types/synth.ts`) holds the knobs; every field is
optional and `resolveMacroParams` fills `DEFAULT_MACRO_PARAMS`. The model is
the waveform — `macro` has no `engine` field, so there is one source of truth.

| Field | Range | Native `MacroParam` | What it does |
|---|---|---|---|
| `harmonics`, `timbre`, `morph` | 0–1 | 1, 2, 3 | The model's three macro knobs |
| `decay` | 0–1 | 4 | LPG release in gate mode, the whole envelope in ping mode; also the internal decay envelope |
| `lpgColour` | 0–1 | 5 | 0 = VCA, 1 = low-pass gate |
| `fmMod`, `timbreMod`, `morphMod` | −1…1 | 8, 9, 10 | Internal decay envelope → pitch / TIMBRE / MORPH (the module's attenuverters) |
| `spread` | 0–1 | 11 | Stereo width: AUX on the side channel (mono-compatible) |
| `glide` | 0–1 | 12 | Portamento, 0 = off … 1 ≈ 1 s |
| `lpgMode` | `gate` / `ping` | 13 | Gate holds the LPG for the note length; ping strikes it like the module |
| `polyphony` | 1–8 | 7 | 1 = mono, slid steps glide legato |
| `auxMix` | 0–1 | 15 | Crossfade OUT → AUX on the mid channel |

`SynthParams.volume` is `MacroParam.VOLUME` (6) and TUNE (`params.pitch`) is
`MacroParam.TRANSPOSE` (14): notes are sent untransposed, so turning TUNE moves
sounding notes too. ADSR, filter and delay knobs do not apply — the rack module
shows the macro knobs instead while a macro model is selected.

Per note: velocity is the accent (drums, physical models) and, in gate mode, the
LPG level; a step's `timbre` (0.5 = neutral) bends TIMBRE around the knob; a
step's `chord` notes are separate voices.

## Engine (`emscripten/macro_wrapper.cpp`)

- **Voice core, stereo.** `NativeVoice<MacroEngine, 256, 2>` on
  `emscripten/core/voice.h`: the voice core grew a `Channels` template parameter
  (default 1 — every other engine unchanged). A stereo voice renders planar: the
  right channel is one `maxFrames` stride after the left (`macro_stride`).
  `NativeVoiceProcessor.renderVoiceStereo` copies both.
- **MacroVoice** is `plaits::Voice` re-done for a DAW (each change marked
  `[wrapper mod]`): float output instead of the int16 DAC stage, no 1 ms trigger
  delay (gate and pitch arrive in one event), TRIGGER always patched from the
  sequencer gate, velocity as the accent, and a gate/ping choice for the LPG.
  All 24 engines live in the voice and share 16 KB of RAM, exactly as on the
  module (~11 KB of state per voice + 16 KB RAM).
- **Polyphony.** Up to 8 voices per part. A new note takes the voice already
  playing that note, else an idle voice, else the oldest released one, else the
  oldest held one (stolen). Voices sleep after 8 ms below −80 dBFS once released
  (or 100 ms for a self-enveloped sound that died while held), so idle voices
  cost nothing.
- **Mono legato.** With polyphony 1 a slid note re-pitches the held voice with
  glide and no new trigger. The sequencer's previous note ends on the same frame
  the slid one starts (noteOff first), so a gate that closed with no audio
  rendered since still counts as held.
- **48 kHz inside.** Plaits' envelopes are tuned to 12-sample control blocks at
  48 kHz, so the engine renders that grid and resamples to the context rate with
  a 32-tap, 256-phase windowed-sinc polyphase stage (bypassed at exactly 48 kHz —
  the common case under the #1136 rate policy). Its pitch table assumes the
  module's 47 872 Hz clock; a −4.6 cent correction makes note 69 440 Hz.
- **Timing.** An event takes effect at the first 48 kHz control-block boundary
  at or after its frame (≤ 0.25 ms late); the resampler adds a constant 16-sample
  (0.33 ms at 48 kHz) delay when the context is not 48 kHz.
- **Knob moves vs. queued notes.** Notes push their patch ahead of time with the
  sequencer lookahead. A knob move goes through `macro_set_param_now`, which also
  drops that param's still-scheduled events, so a value queued before the move
  cannot land after it and undo it.

### Exports

Generic (`HYPHON_EXPORT_VOICE(macro, …, 8)`): `macro_create`, `_destroy`,
`_init`, `_push_event`, `_render`, `_cancel_notes`, `_flush`. Engine:
`macro_set_param`, `macro_set_param_now`, `macro_all_notes_off` (transport stop:
2 ms fade), `macro_engine_count`, `macro_stride`, and the immediate
`macro_note_on` / `_note_off` / `_process` / `_active_voices` used by tooling and
the host test. All are in `emscripten/wasm_export_manifest.json`.

Events: `kNoteOn` (target = note, value = velocity 0–1, `a0` per-note TIMBRE
offset, `a1` slide, `a2` fine pitch, `a3` per-note MORPH offset), `kNoteOff`,
`kAllNotesOff` (gates close, tails ring out), `kParam`.

### Denormals

WebAssembly has no flush-to-zero mode, and x86 takes a ~100-cycle assist for
every operation on a subnormal float. Plaits was written for a Cortex-M4 that
flushes them, and its filters, resonators and envelopes ring down into that
range — often into a limit cycle that never reaches zero. Before the guards, 8
held modal-resonator voices cost **1232 µs per 128-frame quantum in V8 (46 %)**.

The build therefore compiles a **staged copy** of the sources:
`tools/plaits_sources.mjs --stage DIR` copies the hashed source set and applies
`tools/plaits_wasm_patches.mjs` — small, named guards that zero recursive state
below 1e-15 (−300 dBFS), at block ends where the code has them. The submodules
stay pristine; an upstream bump that moves a guarded line fails the build by
patch id. The host test compiles the same staged copy and fails if any engine is
more than 2× (and 30 µs) slower with x86 FTZ off than on.

Finding a new one: build `emscripten/tests/macro_offline_test.cpp`'s sources at
`-O1 -g`, unmask the denormal-operand and underflow exceptions
(`_mm_setcsr(_mm_getcsr() & ~((1u << 8) | (1u << 11)))`) after a short warm-up,
and run the engine under `gdb -batch -ex run -ex bt`: the backtrace names the
line.

## Measurements (P0)

Release build, emcc 6.0.9 `-O3 -flto -msimd128`, 2.1 GHz Xeon, Node 22 (V8):

| | |
|---|---|
| `hyphon_native.wasm` | 134 186 → 357 536 bytes (**+218 KiB**, 59 → 182 KB gzipped) — under the 250 KB go/no-go, so the family ships inside `hyphon_native` rather than as its own module |
| CPU, 8 held voices, 48 kHz | worst model **2-op FM 8.6 %** of a 128-frame quantum; modal 3.6 %, string 5.0 %, chords 6.1 % (`node tools/render_hyphon_native_parity.mjs macro-cpu --mode held`) |
| CPU, 8-note chords every 16th at 120 BPM | worst 9.6 % at 48 kHz, 9.3 % at 44.1 kHz (with the resampler) (`--mode sequenced`) |
| Heap, SYNTH A + B with 16 voices sounding | ST peak 3.80 → 4.32 MB of 16 MB; pthread 10.78 → 11.39 MB of 32 MB (`… heap`, recorded in `wasm_memory_budget.json`) |

The acceptance bar is < 25 % of one render quantum for 8 voices on the
perf-tier reference machine (`docs/PERFORMANCE_BUDGET.md`).

## Fallback

A part that cannot render its model plays the model's documented `fallback`
waveform (`MACRO_ENGINES[i].fallback` — a plain JS oscillator family, so the
substitution itself cannot fail) and reports it once per part + model through
`logWaveformSubstitution('macro', …)`: console, telemetry history, the
degradation store and the Engine HUD. That covers:

- a build whose `hyphon_native` predates the macro family (the worklet refuses
  it by name: `macro_* API not found`),
- a worklet that failed to load or timed out,
- a wasm that knows fewer models than the catalog (`macro_engine_count`).

Songs never go silent: `playSynth` and the live keyboard path substitute before
`VoiceManager`, and `ENGINE_CATALOG.macro` is a native-worklet entry that
`Voice` never renders directly.

## Offline: freeze, stems, AI preview, XM

`src/audio/offline/OfflineMacroEngine.ts` instantiates the **same**
`hyphon_native.st.wasm` privately on the calling thread (no AudioWorklet) and
renders a pattern's notes as voice-core events on their exact frames — chords,
slides and velocity included — so a bounce matches the live part. It is used by
`renderSynthPattern` (stem export, track freeze, AI song preview) and
`renderSynthToBuffer` (XM one-shots, note-FX hits; mid channel). When it cannot
load, the render uses the fallback waveform and reports
`logWaveformSubstitution('macro-offline', …)`.

Not carried offline (yet): drawn per-step macro lanes and recorded knob
automation — an offline render plays the part's knob positions.

## Automation and MIDI

The macro knobs on the rack module — HARMONICS, TIMBRE, MORPH, DECAY, COLOUR,
FM ENV, T ENV, M ENV, GLIDE, SPREAD — use the ids in
`MACRO_AUTOMATION_TARGETS` (`macroHarmonics`, …). Those ids are the MIDI-learn
targets and the automation lane parameters on `synthA` / `synthB`:

- recorded lanes go through `AutomationScheduler` →
  `MacroManager.scheduleParamAtTime`, landing on their own frame;
- the automation view can draw `macroHarmonics` / `macroTimbre` / `macroMorph`
  per step (pattern lanes), applied to that step's notes;
- knob moves reach the engine at once (`applyParamsNow`).

Lane values are normalized 0–1; the bipolar env amounts map to −1…1
(`macroControlValue`).

## Patches

`src/engines/macroPresets.ts` ships 43 factory patches across the four banks,
loaded from the Macro panel's **Patch** menu (a patch replaces the whole macro
block). The **Macro Palette** session pack (Session launcher) sets SYNTH A to a
spectral pad and SYNTH B to a mono gliding bass, with step chords, a slid bass
line and a plucked line.

## Formats

| Format | Macro parts |
|---|---|
| Saved songs | `waveform: 'macro-…'` + `SynthParams.macro`; older songs load unchanged |
| AI song (`docs/ai-song-format.md`) | `params.waveform` may be any `macro-*` id and `params.macro` its knobs; an unknown `macro-*` id becomes `macro-va` with a warning; `bass2` (303 only) maps through the model's fallback shape. Lanes `macroHarmonics` … `macroSpread` are valid on `synthA` / `synthB` |
| RBS (ReBirth) export | TB-303 saw, or square for square-fallback models; a warning names the model. Knobs and chords are not exported |
| XM export | Each note is baked through the offline engine (above) |

## Build

```bash
git submodule update --init --depth 1 third_party/eurorack third_party/stmlib
pnpm run build:emcc            # or build:native:changed
pnpm run test:native           # includes macro_offline_test
```

`third_party/eurorack` (pichenettes/eurorack) and `third_party/stmlib`
(pichenettes/stmlib, the commit eurorack pins) are separate shallow submodules
— CI's `submodules: true` does not recurse, and only `plaits/dsp`,
`plaits/resources.*`, `stmlib/{stmlib.h,dsp,utils}` are compiled. A local
checkout can narrow eurorack with
`git -C third_party/eurorack sparse-checkout set plaits`.
`scripts/native-worlds.mjs` hashes exactly those files plus the two
`tools/plaits_*.mjs` scripts into the emcc world, so an upstream bump rebuilds.
Every translation unit compiles with `-DTEST`, upstream's portable-host switch
(it replaces the Cortex-M4 `ssat`/`vsqrt` asm in `stmlib/dsp/dsp.h` with C++).

## Tests

- Host: `emscripten/tests/macro_offline_test.cpp` (`pnpm run test:native`) —
  all 24 models sound, tuning at 44.1 / 48 / 96 kHz, event path == immediate
  API, control-block timing, polyphony / stealing / sleep, mono glide and
  same-frame legato, knob-move override, stereo, hard stop, the FTZ gate, CPU
  table. `MACRO_WAV_DIR=dir` writes a WAV per model.
- wasm: `node tools/render_hyphon_native_parity.mjs render` includes every
  model; `macro-cpu` and `heap` as above.
- Unit: `src/engines/__tests__/MacroParams.test.ts`, `MacroManager.test.ts`,
  `src/audio-worklets/__tests__/macroProcessor.test.ts`,
  `src/audio/offline/__tests__/OfflineMacroEngine.test.ts`, plus the catalog,
  graph, manifest and release-gate suites that enumerate engines.

## Not done yet

- **P4 spectral baselines** per model in the 303-quality workflow style (the
  WAV dumps exist, the committed baselines and metrics do not).
- **P5**: the percussive models as drum-kit voices; DX7 SysEx import for the
  6-op banks (`LoadUserData` already takes a bank — the factory one today).

# openrb-338 TB-303 voice (Vintage / 2.0)

Status: **voices selectable; module built and verified, not wired in.** The
two voices are in the 303 voice selector, persist in songs and can be set by
RBS import. The extraction spike (#1537) produced
[`openrb338/`](../../openrb338/README.md), a standalone GPL-3.0-only crate. It
builds a 40 KB `openrb338.wasm` with no imports, and that module's output
matches openrb-338 bit for bit at 44.1 kHz ([Verification](#verification)).
The worklet does not load it yet, so the voices still play **Stock Open303**.
The licence decision is below and is the input #1544 asked for.

openrb-338 is a bit-exact reimplementation
of the ReBirth 2.01 TB-303, written in Rust, covering both of ReBirth's sound
modes. Hyphon's other ReBirth voices (`rebirth-338-1.5`, `rebirth-2.0`) are
open303 coefficient profiles: "inspired by", not bit-exact.

## Voices

| Id | Label | Family | Mode | Licence |
|----|-------|--------|------|---------|
| `openrb338-vintage` | openrb-338 Vintage | `openrb338` | ReBirth "Vintage" (the 1.x 303) | GPL-3.0-only |
| `openrb338-2.0` | openrb-338 2.0 | `openrb338` | ReBirth "2.0" | GPL-3.0-only |

The ids are stable and are saved in `SynthParams.model303`. `engine303` is
mirrored as `open303`, so older builds load these songs with the stock
voice.

In `Voice303Selector`, the family uses a rose theme and an **OPENRB** badge.
Each button carries a **GPL** pill, which reads **GPL · stub** while the
module is missing. While one of these voices is active and the module is
missing, the selector also shows a status line:
*"openrb-338 module not bundled · plays Stock Open303 · song keeps this voice"*.

## Controls

The voices take the same path as every other 303 voice. Nothing about them
is per-voice on the TypeScript side:

| Control | Path |
|---------|------|
| cutoff, resonance, env mod, decay, accent, tuning | `OPEN303_PARAM_IDS` (`src/audio-worklets/open303/shared.ts`), with the same normalized 0–1 ranges as open303 / jc303. The module maps each one to a ReBirth knob position, `round(v * 127)`. A knob byte `b` sent as `b / 127` comes back as exactly `b`. |
| waveform | `>= 0.5` selects square. |
| volume | Linear gain after the core. `1.0` equals ReBirth's default mixer (channel 100, master 100: ×0.2009, peaks near 0.5). The raw 303 bus peaks near 2.6. |
| raw knobs (optional) | Param id `64 + ctrl` (ctrl 2 tune … 8 waveform) takes the knob byte 0–127 directly, for RBS import. Id `72` sets the linear output gain (`1.0` = raw bus). |
| note | MIDI 36 (C2, 65.4 Hz) is ReBirth's pitch origin, so pitches match the other 303 voices. Notes outside the pitch table (−48…+47 semitones around C2, tune included) are folded by octaves. |
| slide | A `noteOn` while a note is held is a slide (legato): no envelope retrigger, and ReBirth's fixed glide. A `noteOff` for any other note while one is held is dropped as stale. |
| accent (per step) | Velocity > 100, the same as `ACCENT_VELOCITY_THRESHOLD` in `open303_wrapper.cpp`. |
| rest step (optional) | `openrb303_rest(note, velocity)`, then `noteOff(note)` half a step later. This is how ReBirth plays a rest step; see [Divergences](#divergences-from-rebirth). |
| slide time knob (`portamento` / `slideTime`) | **Ignored.** ReBirth's slide time is fixed, and a bit-exact model has no knob for it. |
| filter mode (`OPEN303_FILTER_MODE`) | Ignored. ReBirth has no equivalent. |

## Port path (chosen): separate optional Rust → WASM module

| Option | Verdict |
|--------|---------|
| Link a C++ port into `hyphon_native.wasm` | **No.** That would make the shared native binary, which every voice, drum and FX path uses, a GPL-3.0-only work. A hand port also risks losing bit-exactness. |
| **Isolate `Tb303` + tables into a small Rust crate → `wasm32-unknown-unknown` → `openrb338.wasm`** | **Chosen.** No translation, so bit-exactness carries over. It stays its own module and its own build, and the default build can leave it out. |
| Clean-room reimplementation | Fallback only, if the licence decision rules out shipping openrb code at all. Bit-exactness would have to be re-proved against reference renders. |

How it plugs in:

1. **Crate** (#1537): `Tb303` plus the tables it needs, without `Block` or
   the rest of the engine. A thin `#[no_mangle] extern "C"` wrapper
   implements the ABI in
   [`src/audio-worklets/openrb338.ts`](../../src/audio-worklets/openrb338.ts)
   (`Openrb338Exports`: `openrb303_create(sampleRate, mode)`, `set_mode`,
   `set_param`, `note_on`, `note_off`, `all_notes_off`, `buffer`, `render`,
   and `abi_version` = `OPENRB338_ABI_VERSION`).
2. **Build**: its own script, opt-in (e.g. `build:wasm:openrb338`). It is not
   part of `build:native` until the licence decision says it ships. Its
   source stays in its own directory with its own `LICENSE` (GPL-3.0). This is
   a separate world under the "Four Worlds" rule (AGENTS.md); `rust-audio/`
   stays a bench crate.
3. **Load**: the main thread fetches and compiles `openrb338.wasm`, then posts
   the `WebAssembly.Module` to the 303 worklet. The worklet instantiates it
   and checks it with `supportsOpenrb338()`.
4. **Route**: `Open303EngineSelection.setOpenrb338Model()`
   (`src/audio-worklets/open303/engineSelection.ts`) is the single switch
   point. Today it posts `openrb338-unavailable` and selects
   `stock-open303`. When the module lands, it instantiates the voice there,
   and `open303-processor.ts` gets an `openrb303` voice prefix next to
   `open303` / `jc303` / `highfid303`.
5. **Flip**: `isOpenrb338ModuleBundled()` returns true, either as a
   build-time define or as a runtime probe. Nothing else changes: songs saved
   before then already carry the id.

### Fallback today

```
Voice303Selector ─▶ SynthParams.model303 = 'openrb338-2.0'   (persisted as-is)
                 ─▶ Open303Oscillator.setModel303 ─▶ set-303-model {engine:'openrb338'}
worklet: module not bundled ─▶ post 'openrb338-unavailable' ─▶ setModel('stock-open303')
main:    Open303Oscillator mirrors stock + reportTB303ModelFallback(…, 'openrb338')
```

Offline paths (freeze, export, `OfflineOpen303Engine`) also treat unknown
profiles as stock, so they agree with what plays live.

## The module (`openrb338/`, #1537)

`openrb338/` is its own world: a Rust crate that is not a member of any
workspace, with its own `LICENSE` (GPL-3.0), pinned toolchain and opt-in build.
See [`openrb338/README.md`](../../openrb338/README.md) for the provenance and
the list of changes made to upstream's files.

| Layer | File | What it does |
|-------|------|-------------|
| Core | `src/tb303.rs`, `src/tables.rs` | Upstream's `Tb303` and the tables it reads, extracted from `orb-engine` at `88a1770`. The DSP code is unchanged; only the sequencer trait impls are replaced by inherent methods. It renders 64-sample blocks at 44.1 kHz. |
| Adapter | `src/voice.rs` | Turns host events into ReBirth step bytes, normalized params into knob positions, blocks into any frame count, 44.1 kHz into the host rate, and applies the output gain. |
| ABI | `src/ffi.rs` | `#[no_mangle] extern "C"`, handles are 1-based slot numbers (0 = none, bad handles are no-ops), up to 16 voices per instance. |

The module also exports an optional `openrb_lp_*` group: ReBirth's PCF
low-pass (`src/pcf_lp.rs`, `src/lowpass.rs`), which the patch bay's low-pass
nodes use in openrb mode. See [openrb-lowpass.md](openrb-lowpass.md).

```bash
pnpm run build:wasm:openrb338   # -> openrb338/pkg/openrb338.wasm (gitignored)
```

```bash
pnpm run verify:openrb338       # + cargo tests, reference renders, wasm bit check
```

### ABI (revision 1)

All exports are numbers in and out. Pointers come back as `i32`, so use
`>>> 0` on them.

| Export | Signature | Notes |
|--------|-----------|-------|
| `openrb303_abi_version` | `() → u32` | `1` = `OPENRB338_ABI_VERSION` |
| `openrb303_create` | `(sampleRate: f32, mode: u32) → handle` | `mode` from `OPENRB338_MODE_IDS`. Returns 0 for a rate outside 8–384 kHz, an unknown mode, or a full slot table. Allocates. |
| `openrb303_destroy` | `(handle)` | |
| `openrb303_set_mode` | `(handle, mode: u32)` | The engine switches at the next block and the amp constants at the next note event, as with ReBirth's msg 36. |
| `openrb303_set_param` | `(handle, paramId: u32, value: f32)` | See [Controls](#controls). |
| `openrb303_note_on` | `(handle, note: i32, velocity: f32)` | Velocity 0 is a note-off. |
| `openrb303_note_off` | `(handle, note: i32)` | |
| `openrb303_all_notes_off` | `(handle)` | ReBirth's stop (slot 6): clears the slide flag, then note-off. Not a reset, so the tail decays. |
| `openrb303_buffer` | `(handle, maxFrames: u32) → ptr` | Mono f32 render buffer. Call it at setup; it moves only if a later call asks for more frames. Allocates. |
| `openrb303_render` | `(handle, frames: u32)` | Renders into the buffer. Does not allocate. |
| `openrb303_rest` *(optional)* | `(handle, note: i32, velocity: f32)` | A ReBirth rest step. |
| `openrb303_is_bit_exact` *(optional)* | `(handle) → u32` | 1 when the host runs at 44.1 kHz. |

`supportsOpenrb338()` accepts the built module as it is. The ABI is immediate
(no event ring). The core takes control changes at 64-sample block
boundaries, as ReBirth does. A worklet that splits its 128-frame quantum at
event offsets therefore gets ReBirth's timing; it does not get sample
accuracy.

### Verification

`pnpm run verify:openrb338` runs this whole chain.

- **Tables.** The pitch, filter (8 × 1024 × 4), smoother and level-curve
  tables are bit-identical to upstream's. Upstream itself checks them against
  dumps of the running ReBirth.dll.
- **Native adapter vs upstream.** Upstream `orb-engine` is a git
  dev-dependency at the same revision. It plays 7 scenarios (16.6 s in total)
  through its sequencer calls: both sound models, saw and square, accents,
  slides, rests, random moves of every knob, mid-song mode switches, and a
  stop with a note sounding. The adapter plays the same scenarios through host
  events, and the output matches **bit for bit**. Render chunk sizes of 64,
  128, 4096 and an irregular `37/91/200/1/128` all match. The two event
  encodings are built independently, so the test also checks the note, slide,
  accent and param mapping.
- **WASM vs upstream.** `tools/verify-wasm.mjs` drives `openrb338.wasm` from
  Node through the C ABI only. It matches upstream's native renders **bit for
  bit** in every scenario and chunking. The floating-point behaviour carries
  over: the core uses only IEEE f64/f32 arithmetic in upstream's operand
  order, with no FMA and no fast-math. Float-to-int casts truncate, and the
  transcendentals come from the pure-Rust `libm` that upstream pins
  (`=0.2.16`), so wasm32 and x86-64 give the same tables.
- **48 / 96 kHz.** The output is finite and within 0.01 dB of the reference's
  RMS level. It is not bit-exact; see below.
- **Cost.** About 1–2 µs per 128-frame quantum for one voice in Node, which is
  about 0.05 % of real time. The tables (152 KiB) are built once per module
  instance, in a few ms.

### Divergences from ReBirth

1. **Host rate.** Every ReBirth constant assumes 44.1 kHz. Off that rate, the
   core still runs at 44.1 kHz and is resampled with a 4-point Catmull-Rom
   interpolator (2 samples of latency, no anti-alias filter, so it is meant
   for up-conversion). The tone is the same, but the output is not
   bit-exact. Bit-exact playback needs an AudioContext at 44.1 kHz. The
   offline render paths (freeze, export) can always render at 44.1 kHz.
2. **Rest steps.** ReBirth runs note-on for a rest step too. That moves the
   pitch, decay and accent state that a released note's tail and the next
   note hear, and the half-step note-off loads the release constants. If the
   host sends nothing for rests, as Hyphon's sequencer does today, the output
   is bit-exact up to the first rest step. After that, in the scenarios
   above, a sounding step's energy is off by 0.9–5.8 dB at worst, and most
   steps stay within 1 dB (`host_without_rests_differs_only_in_rest_step_tails`).
   Sending `openrb303_rest` + `noteOff` removes the difference. An RBS import
   has the rest steps and their note bytes, so it should send them.
3. **Sliding rest step.** A rest step with its slide flag set cannot be
   expressed: the host has no note to hold over it.
4. **Hyphon's slide scheduling.** `playSynth` gives a note that is *slid
   into* (`slideFromFreq` set) no `noteOff`, and gives the note before it a
   `noteOff` at its own end. The openrb ABI needs ReBirth's form instead: the
   note before a slide is still held when the slide's `noteOn` arrives, and
   every note gets its `noteOff`. Without that, two things go wrong. A gate
   shorter than the step turns the slide into a retrigger. And the slid-into
   note is still held when the following step's `noteOn` arrives, so that
   step slides too. The other 303 voices do not hit either problem, because
   the native `MonoNoteEngine` always retriggers. The openrb route needs the
   fix in its scheduling (integration step 4).
5. **Slide time, filter mode.** ReBirth has neither, so both are ignored.

### Integration plan (Open303Manager / VoiceManager path)

The selector, `SynthParams.model303`, `Open303Oscillator.setModel303` and
`set-303-model {engine:'openrb338'}` are already in place, so nothing changes
on the main-thread voice path. The remaining work is in the loader and the
worklet:

1. **Load.** The main thread fetches `openrb338.wasm` and calls
   `WebAssembly.compile`, then posts the `WebAssembly.Module` to each 303
   worklet with an `init-openrb338` message. No glue is needed, because the
   module has no imports.
2. **Instantiate.** The worklet calls `WebAssembly.instantiate(module, {})`,
   then `supportsOpenrb338(exports)`, then
   `openrb303_create(sampleRate, mode)` and `openrb303_buffer(h, 128)`. It
   keeps a `Float32Array` view and re-creates it if `memory.buffer` changes.
3. **Route.** `Open303EngineSelection.setOpenrb338Model()` becomes: if the
   instance is ready, `set_mode(openrb338ModeForModel(model))`, then
   `engine = 'openrb338'` (a new `EngineFamily`). Otherwise keep today's
   `openrb338-unavailable` fallback.
4. **Render.** In the processor's block loop, the openrb branch drains the
   control-plane records for its part. Each record is applied at its frame:
   render up to it, apply it, continue. `NOTE_ON` / `NOTE_OFF` / `PARAM_SET`
   map to `note_on` / `note_off` / `set_param` (the param ids are already
   shared), and `CANCEL_NOTES` maps to `all_notes_off`. For this route,
   `playSynth` holds the note before a slide step until the slide's `noteOn`,
   and sends the slid-into note its `noteOff` (divergence 4). The branch then copies
   the buffer to output 0, which gets the same `OUTPUT_GAIN` and downstream
   chain as the other engines.
5. **Flip.** `isOpenrb338ModuleBundled()` becomes a runtime probe: the
   worklet reports `openrb338-ready` and `Voice303Selector` drops the stub
   pill.
6. **Offline.** `OfflineOpen303Engine` can instantiate the same module at
   44.1 kHz, which is bit-exact, and resample once at the end.

## RBS import

The `RbsImportOptions.tb303Voice` option sets the voice on the TB-303 data,
wherever `tb303ATarget` / `tb303BTarget` routes it (SYNTH A, SYNTH B or
BASS 2, including song-mode per-slot params). It is also in the import
modal as **TB-303 voice**.

| Value | Voice written |
|-------|---------------|
| `stock` (default) | `stock-open303` |
| `openrb338-vintage` | `openrb338-vintage` |
| `openrb338-2.0` | `openrb338-2.0` |
| `openrb338-auto` | 1.x files (`isV15SubsetVersion`) → Vintage, otherwise 2.0 |

The default stays `stock` until the module ships, so a fresh import never
selects a voice that silently falls back.

### Per-303 mode (two openrb-338 303s)

ReBirth has two independent 303s. `RbsImportOptions.tb303VoiceA` and
`tb303VoiceB` override `tb303Voice` for one TB-303 each (undefined = inherit),
so a song can load with, for example, 303 A in Vintage and 303 B in 2.0. The
import modal shows them as **TB-303 A voice** / **TB-303 B voice** ("Same as
above" = inherit). Each override follows its 303's data to wherever
`tb303ATarget` / `tb303BTarget` sends it, including BASS 2 and the song-mode
per-slot params (`resolveRbsTb303VoiceFieldsFor` in
`src/importers/rbs/importer/synthParams.ts`).

`openrb338-auto` resolves per 303: Vintage when the file is 1.x
(`isV15SubsetVersion`) **or** the song's GLOB vintage byte (`0x1ea`) is
exactly 1, otherwise 2.0. ReBirth stores that flag once per song, not per 303,
so to give the two 303s different modes from one file, set the per-303
override explicitly.

After import, `Voice303Selector` shows a **Mode: Vintage / 2.0** toggle
whenever an openrb-338 voice is active. It switches between the two voice ids
on that track only, so SYNTH A, SYNTH B and BASS 2 each keep their own mode.

**Running both at once.** Each 303 track has its own worklet and its own
openrb-338 handle (`openrb303_create` per track; up to 16 voices per module
instance), and the mode is per handle (`openrb303_set_mode`). Two 303s in
different modes share no state. The tables are read-only and built once per
module instance.

### Timing and control-rate differences from ReBirth

- **Control rate.** The core takes note, mode and knob changes at 64-sample
  block boundaries at 44.1 kHz (≈1.45 ms), as ReBirth does. Hyphon sequences
  at sample-accurate offsets inside a 128-frame quantum, so an event can land
  up to one 64-sample block late compared with other Hyphon voices — the same
  quantization ReBirth applies, not the sample accuracy of Stock Open303.
- **Mode switch.** A mode change takes effect at the next block for the
  engine and at the next note event for the amp constants (ReBirth msg 36), so
  toggling Vintage / 2.0 on a held note is not instantaneous.
- **Sample rate.** Bit-exact only at 44.1 kHz; at 48 / 96 kHz the output is
  resampled (see Verification), adding a little latency and dropping bit
  exactness.
- **Sequencer timing.** Step timing, shuffle and tempo come from Hyphon's
  sequencer, not ReBirth's tick clock, so groove matches ReBirth's to the
  sequencer's resolution, not to the tick.
- **Automation.** Imported knob automation is applied at Hyphon's automation
  rate and then quantized to the 64-sample block, so fast tweaks are smoothed
  slightly differently from ReBirth's per-tick knob messages.
- **Slide time / filter mode** are ignored (ReBirth has neither).

## Licence decision (GPL-3.0-only)

*Engineering decision record, not legal advice. The repository owner makes
the final call.*

**Facts**

- openrb-338 is **GPL-3.0-only**: no "or later" option, and no exception.
- Since #1537, openrb-338 **source** (two files derived from upstream, see
  `openrb338/README.md`) sits in this repository under `openrb338/`, with the
  GPL-3.0 text and modification notices. Publishing GPL source with its
  licence is allowed. The adapter and ABI code in that crate are a derived
  work, so they are GPL-3.0-only too. The TypeScript contract
  (`openrb338.ts`) contains no openrb code.
- The built `openrb338.wasm` is **not** in the repository or in `public/`, and
  no build step bundles it.
- Hyphon's repository has **no LICENSE file**, and `package.json` is
  `"private": true` with no `license` field.
- Hyphon **already ships GPL code**: Rubber Band Library
  (GPL-2.0-or-later, `rubberband/COPYING`), compiled to
  `src/audio-worklets/rubberband-lib.js` and loaded in a worklet. So
  conveying a Hyphon build already means conveying a GPL-covered combined
  work, unless a commercial Rubber Band licence is held.
- The other 303 engines are permissive: Open303 / jc303 are MIT, and Plaits
  is MIT (see `THIRD_PARTY_NOTICES.md`). All of these are GPL-3.0-compatible.

**What is allowed**

- Developing against openrb-338 locally, and building it for private use.
  The GPL places no obligation on code that is not conveyed.
- Shipping a build that includes `openrb338.wasm`, **if** that build is
  offered under GPL-3.0 terms, with complete corresponding source for the
  combined work (the app that loads and drives it) and the GPL-3.0 licence
  text. A module the worklet instantiates and calls through a C ABI is
  treated as part of a combined work, the same as dynamic linking. Being a
  separate file does not exempt the JS/TS that drives it.
- Rubber Band (GPL-2.0-or-later) and the MIT components can all be conveyed
  under GPL-3.0, so combining with GPL-3.0-only creates no conflict inside
  the bundle.

**What is not allowed**

- Shipping `openrb338.wasm` inside a build distributed under non-GPL terms:
  proprietary, "all rights reserved", or permissive-only.
- Relicensing openrb-338 code, or code derived from it (a C++ translation
  counts), under anything except GPL-3.0-only.
- Distributing through channels whose terms conflict with GPL-3.0 (the same
  restriction Rubber Band's README already notes for the Apple App Store).

**Decision**

1. Keep openrb-338 in its **own optional module and build**, never in
   `hyphon_native.wasm`. The default build, and every non-openrb voice, stays
   free of GPL-3.0-only code.
2. Do **not** bundle the module in published builds until the owner picks a
   project licence. Given Rubber Band already ships, the consistent choice is
   GPL-3.0-or-later (or GPL-3.0-only) for the app. Until then, it is opt-in
   for local builds.
3. When it is bundled, add it to `THIRD_PARTY_NOTICES.md` (source URL, pinned
   revision, GPL-3.0-only, copyright line). Ship the licence text, and keep a
   written offer or link to the corresponding source with the release.
4. If a GPL release is ruled out, the remaining routes are asking the
   openrb-338 authors for a licence exception, or a clean-room
   reimplementation validated against reference renders. A clean-room
   reimplementation must not be derived from openrb code.

## Code map

| File | Role |
|------|------|
| `src/audio-worklets/openrb338.ts` | Ids, modes, ABI contract, `supportsOpenrb338`, `isOpenrb338ModuleBundled` (stub: false) |
| `openrb338/src/{tb303,tables}.rs` | The extracted openrb-338 core (GPL-3.0-only) |
| `openrb338/src/{voice,ffi,resample}.rs` | Host adapter, C ABI, rate converter |
| `openrb338/tests/reference.rs`, `openrb338/tools/verify-wasm.mjs` | Bit-exact checks against upstream (native and wasm) |
| `src/engines/TB303Models.ts` | Catalog entries (`family: 'openrb338'`, `license`, `optionalModule`), `isTB303ModelModuleBundled` |
| `src/audio-worklets/open303/engineSelection.ts` | `setOpenrb338Model`: the single routing / fallback point |
| `src/engines/Open303Oscillator.ts` | Handles `openrb338-unavailable` |
| `src/components/Voice303Selector.tsx` | Rose theme, GPL pill, stub status line |
| `src/importers/rbs/importer/synthParams.ts` | `resolveRbsTb303VoiceFields`, the `tb303Voice` option |

Tests: `cargo test` in `openrb338/` (plus `pnpm run verify:openrb338`),
`src/__tests__/TB303Models.test.ts`,
`src/components/__tests__/Voice303Selector.test.tsx`,
`src/__tests__/RbsImporter.test.ts` (`tb303Voice`), and
`src/audio-worklets/__tests__/open303Processor.noteTiming.test.ts` (the
fallback routes notes to open303).

## Still to do (#1537)

- [x] Crate around `Tb303` + tables, plus the C-ABI wrapper (`Openrb338Exports`):
      `openrb338/`.
- [x] Reference renders from openrb-338 compared with WASM output: bit-exact at
      44.1 kHz; divergences documented above.
- [ ] Main-thread loader, worklet instantiation, and an `openrb303` voice
      prefix in `open303-processor.ts` ([Integration plan](#integration-plan-open303manager--voicemanager-path)).
- [ ] Hold the previous note over a slide step for the openrb route
      (divergence 4), and send rest steps from RBS-imported patterns
      (divergence 2).
- [ ] Turn `isOpenrb338ModuleBundled()` into a build define or runtime probe.
- [ ] Offline render (freeze / export) through the same module.
- [ ] Licence decision signed off (#1544), then bundling and notices.
- [x] A/B harness against the current voices on RBS patterns (#1543):
      `pnpm run compare:303`, results and priority in
      [303-voice-comparison.md](303-voice-comparison.md). On three real songs
      the openrb voice is 16–26 dB (frame LSD) from every existing voice, which
      sit in a separate cluster; the ReBirth-coefficient profiles are not closer
      to it than stock.

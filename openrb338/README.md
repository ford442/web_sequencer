# openrb338: openrb-338's TB-303 as a WASM voice

This directory holds the bit-exact ReBirth 2.01 TB-303 from
[openrb-338](https://github.com/pingw33n/openrb-338) as a standalone Rust crate, plus a thin
adapter and a C ABI. It builds to `openrb338.wasm`, a 40 KB module with no imports, for the
`openrb338-vintage` and `openrb338-2.0` voices
([docs/audio-engine/openrb338-voice.md](../docs/audio-engine/openrb338-voice.md)).

**Licence: GPL-3.0-only** ([LICENSE](LICENSE)). The build is opt-in, and its output stays in
`openrb338/pkg/` (gitignored). Nothing copies it into `public/`, and `build:native` does not
build it.

## Provenance

| | |
|---|---|
| Upstream | https://github.com/pingw33n/openrb-338 |
| Revision | `88a1770c645a8d29688f4941ed5672e81d1f8cf7` (2026-10-31) |
| Copyright | (C) 2026 the OpenRB-338 authors |
| Licence | GPL-3.0-only |
| Toolchain | Rust 1.99.1 (upstream's pin), `wasm32-unknown-unknown` |

| File | What it is |
|------|-----------|
| `src/tb303.rs` | Upstream `crates/orb-engine/src/tb303.rs`. Everything from the module doc to the end of `process_vintage` is unchanged, except that `TUNE_TABLE` is `pub(crate)`. The `SongDevice` / `ChannelDevice` impls (the step sequencer and the song hooks) are replaced by inherent `process`, `set_sound_model`, `set_param`, `silence` and `reset`, whose bodies are copied from those impls. |
| `src/tables.rs` | The TB-303 section of upstream `crates/orb-engine/src/tables/mod.rs` (pitch table, filter table, cutoff smoother) and the mixer's level curve, unchanged. |
| `src/voice.rs` | Hyphon's adapter: MIDI notes to ReBirth step bytes, normalized params to knob positions, block cutting, resampling, output gain. |
| `src/resample.rs` | 4-point Catmull-Rom converter for hosts that do not run at 44.1 kHz. |
| `src/ffi.rs` | The C ABI (`Openrb338Exports` in `src/audio-worklets/openrb338.ts`). |
| `tests/reference.rs`, `tests/scenario/` | Bit-exact checks against upstream `orb-engine` at the same revision (a git dev-dependency). |
| `examples/reference_render.rs`, `tools/verify-wasm.mjs` | The same check for the built `.wasm`, through its C ABI. |

The headers of the vendored files state these modifications, as GPL-3.0 section 5(a) requires.

## Build and verify

```bash
pnpm run build:wasm:openrb338     # -> openrb338/pkg/openrb338.wasm
```

```bash
pnpm run verify:openrb338         # build, cargo tests, reference renders, wasm check
```

The first run downloads Rust 1.99.1 (from `rust-toolchain.toml`) and fetches upstream as the
reference.

## What is verified

- **Tables.** The pitch table, the filter table (8 × 1024 × 4), the smoother and the level curve
  are bit-identical to upstream's. Upstream checks the same tables against dumps of the running
  ReBirth.dll.
- **Voice at 44.1 kHz.** There are 7 scenarios: both sound models, saw and square, accents,
  slides, rests, random knob moves on every controller, mid-song mode switches, and a stop with a
  note sounding. Each is 2.6–3.7 s long. Upstream's `Tb303` plays each one through its sequencer
  calls (step bytes). The adapter plays the same one through host events (MIDI notes, legato
  slides, normalized params), and its output matches **bit for bit**. The test renders with
  chunk sizes of 128, 64, 4096 and an irregular `37/91/200/1/128`. The two event encodings are
  built independently, so the match also checks the note, slide, accent and param mapping.
- **WASM.** `openrb338.wasm` driven through the C ABI from Node matches upstream's native
  renders **bit for bit** in every scenario and chunking. The floating-point behaviour carries
  over: the core uses only IEEE f64/f32 arithmetic (no FMA, no fast-math), `as` casts, and the
  pure-Rust `libm` that upstream pins.
- **Off 44.1 kHz** (48 and 96 kHz, resampled): finite, and within 0.01 dB of the reference's
  RMS level. It is not bit-exact; see below.
- **Cost:** about 1–2 µs per 128-frame quantum for one voice in Node (about 0.05 % of real
  time).

## Divergences from ReBirth

1. **Host rate.** Every ReBirth constant assumes 44.1 kHz. At any other rate the core still runs
   at 44.1 kHz and is resampled (Catmull-Rom, 2 samples of latency, no anti-alias filter). The
   tone is the same, but the output is not bit-exact. `openrb303_is_bit_exact(handle)` reports
   which case applies. For bit-exact output, run the AudioContext at 44.1 kHz.
2. **Control rate.** As in ReBirth, notes and knob moves take effect at the next 64-sample block
   boundary (1.45 ms). An event inside a block lands at its end.
3. **Rest steps.** ReBirth runs note-on for a rest step too. That moves the pitch, decay and
   accent state that a released note's tail and the next note hear. A host that sends no rests
   (Hyphon's sequencer today) is bit-exact up to the first rest step. After that, in the test
   scenarios, the energy of a sounding step differs by 0.9–5.8 dB at worst, and most steps stay
   within 1 dB. `openrb303_rest(handle, note, velocity)`, followed by a `note_off` half a step
   later, removes this difference. An RBS import should send it.
4. **A sliding rest step** (a rest step with its slide flag set) cannot be expressed, because a
   host has no note to hold over it.
5. **Slide time** is fixed (ReBirth has no knob for it). The filter-mode and slide-time params
   are ignored.
6. **Volume.** The output is ReBirth's raw 303 bus times a gain. `volume` 1.0 is ReBirth's
   default mixer (channel 100, master 100: ×0.2009, peaks near 0.5). The raw bus peaks near 2.6.

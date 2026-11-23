# DWGS oscillator (`dwgs-*`, #1666)

**DWGS is Hyphon's take on Korg's Digital Waveform Generator System:** waves
defined as *recipes of harmonics* (additive synthesis) and played as a digital
oscillator in front of a filter. In Hyphon it is a family of 17 waves, rendered
live in an AudioWorklet by a Rust kernel. It is its own timbre family, not a
fifth way to play a saw.

Build, placement and fallback mechanics: [BUILD_NOTES#dwgs-osc](../wasm/BUILD_NOTES.md#dwgs-osc).

## Where it came from

Until #1666, DWGS existed only as panel art: `public/osc/dwgs.jpg`, added with
the other oscillator panels in commit 0cdff156 (June 2026), converted to WebP in
08dfb422, and deleted as an orphan by #1294 because no code referenced it. It
had no engine id, no waveform prefix and no alias. The git history holds no
other trace of it.

The panel itself is the design document:

- a **Korg**-badged module titled **DWGS**;
- a **WAVEFORM SOURCE** selector with four LEDs: **SAW · SQR · NOISE · DIGITAL WAVEFORM**;
- a large selector knob (the digital waveform).

That is Korg's Digital Waveform Generator System from the DW-6000 and DW-8000
(1984–85). Those instruments stored single-cycle waveforms that had been built
by additive synthesis, and played them through an analog filter and envelopes.
So DWGS is **not a digital waveguide or another physical model**, which the
issue guessed from the initials. Nothing in the history points that way, and
the panel's four sources only make sense for a waveform oscillator.

The panel art is back in `public/osc/dwgs.webp`, byte for byte the file #1294
deleted.

## What it does

| Panel source | Waveform ids | What you hear |
|---|---|---|
| SAW | `dwgs-saw` | An additive sawtooth (rising ramp), band-limited exactly |
| SQR | `dwgs-sqr` | An additive square: odd harmonics only |
| DIGITAL WAVEFORM | 14 ids, below | Harmonic recipes shaped after acoustic and electric sources |
| NOISE | `dwgs-noise` | Digital noise clocked at 16× the note frequency, so its colour **follows the keyboard**: a low note rumbles, a high note hisses |

The digital waveforms, in kernel (and persisted) order:

| Id | Short | Recipe (harmonic k, before normalisation) |
|---|---|---|
| `dwgs-piano` | PNO | Struck string: hammer comb `sin(πk/7.6)`, 1/k with a 1/k² tail past the 6th |
| `dwgs-epiano` | EP | Tine: fundamental, a little 2nd/3rd, a bell cluster around the 8th |
| `dwgs-clav` | CLV | Narrow-pulse spectrum (11 % duty: a notch every 9th), soft top |
| `dwgs-organ` | ORG | Drawbars 8′ 4′ 2⅔′ 2′ 1⅗′ 1⅓′ 1′, faint leakage at 10/12/16 |
| `dwgs-brass` | BRS | Saw with a broad formant around the 5th, soft top |
| `dwgs-reed` | REED | Odd-heavy, formant around the 7th |
| `dwgs-strings` | STR | Saw through two body resonances (4th, 11th) |
| `dwgs-guitar` | GTR | Plucked at 1/5.3: comb notches, 1/k² |
| `dwgs-dist` | DIST | Overdrive: dense and flat into the 20s, evens behind odds |
| `dwgs-bass` | BAS | Round electric bass: 1/k², lifted 2nd |
| `dwgs-digibass` | DBS | Hollow odd harmonics with a sharp resonance at the 6th |
| `dwgs-bell` | BEL | Sparse partials 1, 3, 5, 7, 11, 13, 17, 23, 29 |
| `dwgs-vox` | VOX | "Ah": 1/k source through formants fixed at harmonics 3.5, 6.5, 12 |
| `dwgs-sine` | SIN | One harmonic |

All recipes are original to Hyphon (`recipe()` in `dwgs-audio/src/lib.rs`). The
names describe what each one is shaped after, not a copy of any instrument's
waveform ROM. Formants are fixed in *harmonic number*, so they move with the
pitch. That is part of the single-cycle character: a DWGS "voice" wave
sounds smaller as you play it higher.

Every wave is scaled to the same RMS (0.5), so switching waves changes the
timbre, not the level. Peaks stay at or below ~1.22 (clav, piano, dist, vox), in
line with the other engines' band-limited saws (~1.17).

## How it renders

- **Additive, per sample.** Each output sample is the recipe's sum of
  sinusoids at the current phase, from one sine/cosine of the phase and a
  Chebyshev recurrence over the harmonics (f64, four interleaved chains). There
  is no stored table and nothing is looped, so slides and pitch automation are
  continuous.
- **Exactly band-limited.** A harmonic is summed only while it sits below
  0.45 fs, and is faded in over 0.40–0.45 fs so a slide never clicks one in or
  out. Nothing above Nyquist is ever generated, so there is nothing to alias:
  the integration test finds no energy off the harmonic bins at 110, 880 and
  3500 Hz, for every wave.
- **96 harmonics at most.** A C2 (65 Hz) note keeps every harmonic up to
  6.2 kHz; higher notes are limited by Nyquist instead. This also keeps the
  CPU cost bounded (below).
- **Clean onsets.** Every recipe is sine-phase, so a note starts at exactly 0
  at phase 0. The noise starts from 0 too, and from the same seed on every
  note, so a bounced note matches the played one sample for sample.

## Cost

Measured in V8 (Node 22) on one 128-frame block per call:

| Note | µs / block | Share of a 48 kHz render quantum |
|---|---|---|
| ≤ ~250 Hz (all 96 harmonics) | ~17–20 | ~0.7 % per voice |
| 1 kHz (~21 harmonics) | ~8 | ~0.3 % |
| Noise (any pitch) | ~1 | ~0.04 % |

The Rust OSC's PolyBLEP saw costs ~0.6 µs on the same measurement. DWGS is
roughly 30× that at the bottom of the keyboard. That is the price of a recipe
instead of a formula. All 9 synth voices playing low DWGS notes use ~6.5 % of
the audio thread.

## Using it

Pick **DWGS** in the oscillator type selector. The variant panel follows the
hardware's layout: a **Source** row (SAW / SQR / NSE) and a **Digital** grid of
the 14 recipe waves. Each button's tooltip names its recipe. The voice's
filter, envelope and delay apply as for every other `Voice` family. An
in-kernel filter is #1674.

If the DWGS worklet cannot run (no AudioWorklet, or `dwgs_osc.wasm` failed to
load), a `dwgs-*` part plays its wave's nearest basic shape
(`DWGS_WAVES[i].fallback`) on the next live engine, and the HUD and telemetry
say so. DWGS never stands in for another family: it is `entryOnly` in the
backend registry.

## Files

| | |
|---|---|
| Kernel | `dwgs-audio/src/lib.rs` (+ `cargo test` host tests) |
| Build / check | `scripts/build-dwgs-osc.mjs`, `tools/check_dwgs_osc_module.mjs` |
| Wave table | `src/engines/dwgsWaves.ts` (ids, labels, fallbacks — append only) |
| Worklet | `src/audio-worklets/dwgs-osc-processor.ts`, contract `dwgsOsc.ts` |
| Bridge / backend | `src/engines/DwgsOscillator.ts`, `DwgsWorkletBackend` in `backends/adapters.ts` |
| Offline | `src/audio/offline/OfflineDwgsOscEngine.ts` |
| Tests | `src/__tests__/dwgsOscModule.test.ts` (unit), `src/audio-worklets/__tests__/dwgsOscVoice.realWasm.test.ts` (integration) |

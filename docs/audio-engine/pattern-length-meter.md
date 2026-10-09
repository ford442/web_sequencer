# Pattern length, meter, per-track loops, swing

Hyphon used to be a fixed 32-step, 4/4 box. Length and meter are now song data
that drive the existing clock. There is still one sequencer and one clock.

## Data model (song-wide)

| Field (`SavedSongData`, v4) | Range | Default (v1–v3 songs) |
|---|---|---|
| `stepCount` | 1–64 16th-note steps | 32 |
| `timeSignature` | `[num, den]`, den ∈ {2, 4, 8, 16} | `[4, 4]` |
| `trackLengths` | `Partial<Record<TrackKey, 1–64>>` | `{}` (every track follows `stepCount`) |
| `swing` | 0–100, MPC-style percent (50 = straight, 66.7 = triplet, 75 = hardest the clock plays) | 50 |

- **Song-wide.** Every pattern and every Song Mode measure has `stepCount`
  steps. Song Mode and Session build the playing pattern from per-track slots,
  so the meter can't live on `Pattern`. It lives in `transportMixStore` next to
  tempo, and `resolveSongMeter()` (`src/utils/songMeter.ts`) validates it on
  load. Per-measure overrides belong to the arrangement epic: the hook point is
  `measureStepCount()` in `src/utils/songTimeline.ts`.
- **Step arrays.** `PartSequence.steps` length is no longer assumed. Shortening
  the pattern never truncates data. Edits past the end pad with `null`, and
  reads past the end are rests.

## Meter math (`src/utils/musicTheory.ts`)

A step is always a 16th note.

- `stepsPerBar([n, d]) = n × 16 / d`. It returns `null` when the meter can't sit
  on a 16th grid.
- `stepsPerBeat`: 16/d, except compound x/8 meters (6/8, 9/8, 12/8), where it is
  6 (a dotted quarter).
- `ticksPerStep(ppq) = ppq / 4`. This holds for every meter, including MIDI clock
  (6 ticks) and SMF (`PPQ / 4`).

The UI's LEN presets are {8, 12, 16, 24, 32, 48, 64} plus 1–4 whole bars of the
current meter (so 7/8 adds 14, 28, 42 and 56). Shortcuts: **Shift+[ / ]** (gamepad LT/RT) step the length; plain `[`/`]` stay on the keyboard octave.

## Clock

`clock-processor` and every `TransportClock` adapter emit
`onStep(step, audioTime, absStep)`:

- **`step`** wraps at `stepCount`. When the length changes mid-run, the clock
  re-wraps immediately, so no out-of-range step is ever emitted.
- **`absStep`** counts every step since PLAY and never wraps.
- **Swing parity** is taken from `absStep`, so swing keeps alternating across
  the wrap of an odd-length pattern.

Swing goes to the clock as `swingPercentToClock(percent) = clamp((p − 50) / 25, 0, 1)`.
On the clock, swing 1 means a 75/25 split. Session launch quantize uses the
same swing model (`swungStepsSeconds`), so a quantized launch lands on the
swung boundary.

## Per-track loops (polyrhythm)

`trackStepFor()` decides which step a track reads:

| Mode | Track step |
|---|---|
| No override | the clock `step` |
| Pattern / Session | `absStep % trackLength`: free-running. A 12-step hat against a 16-step bass phases and lines up again every 48 steps. |
| Song Mode | `step % trackLength`: re-anchored at every measure, because the measure may swap slots |

The per-step `PartSequence.automation` arrays follow the track loop. Unified
automation lanes follow the master pattern step.

Offline paths (song timeline, SMF/stem export, XM) tile each track to the
measure length with `tilePartSequence()`, so exports match what plays live in
Song Mode.

## Interchange

- **SMF import:** one pattern = 2 bars of the file's meter (3/4 → 24 steps,
  7/8 → 28, 4/4 → 32). `timeSignatureMismatch` is set only when the meter can't
  be represented, or the file changes meter part-way through.
- **SMF export:** writes the song's meter to the conductor track.
- **RBS:** 16-step patterns import as 16 steps. The "expand to 32" import option
  keeps the old stretch/duplicate behaviour.
- **XM:** each pattern has as many rows as the measure has steps.

## Not in v1

- Meter changes inside a song or pattern.
- Independent tempo per track.
- Groove templates.
- Swing in offline render/export.
- Swing over external MIDI clock (slave mode plays straight 16ths).

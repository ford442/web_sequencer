# Note FX chain

Design note for #1345 Phase 2. Per-track, non-destructive note generators
for the melodic tracks (SYNTH A / SYNTH B / BASS 2 / sampler), edited in the
piano roll's **Note FX** strip and saved with the song
(`SavedSongData.noteFx`, absent = none).

## The chain

`src/sequencer/noteFx/` — pure functions from a track's steps to note
events, in a fixed order:

| Module | What it does |
|--------|--------------|
| **Chord** | stacks intervals (Major, Minor, 5th, Octave, Sus4, 7ths) on every note |
| **Arp** | plays each step's held notes (root + chord tones + Chord FX) across the note's length: up / down / up-down / random / as played, rate 1/64–1/4, 1–4 octaves, gate |
| **Ratchet** | splits each note into 1–8 repeats with velocity decay and gate |
| **Euclid** | gates note starts with an E(k, n) pattern and rotation |
| **Humanize** | bounded timing and velocity offsets |

Chord feeds the arp, the arp feeds the ratchet, the gate and humanize come
last. A step's `probability` is rolled by the chain too (from its RNG, not
`Math.random`), so an FX track is reproducible.

Every random choice draws from one RNG seeded by (chain seed, loop pass,
sampler bank) in a fixed order. The **loop pass** is
`floor(absStep / loopLength)` live and the pass index offline, so pass N
sounds the same in both — but differs from pass N+1, so humanize and a
random arp keep moving.

## Live and offline play the same events

`renderNoteFx(steps, chain, { loopLength, iteration, salt, lookup })` is the
only producer of FX notes.

- **Live** — `useStepHandler` asks `noteFxEventsForStep` for the track's
  events on each tick. The pass is computed once and cached
  (`runtime.ts`, keyed on the steps array, the chain object and the
  automation lanes array — every edit replaces one of them, so an edit is
  heard on the next tick), bucketed by the step whose tick schedules each
  event (`start ∈ [step, step + 1)`), and each event plays at
  `stepTime + (start − step) × stepDuration`. Sub-step times rely on the
  sample-accurate native event path (#1344). Simultaneous events from one
  step go out as one `playSynth` call, so a mono 303 gets one note-on.
- **Offline** — `renderSynthPattern` / `renderSamplerBankPattern` take a
  `noteFx` option and bounce `renderNoteFxTimeline(...)` (one pass per loop,
  re-anchored at each measure in Song Mode) at `start × stepDuration`. Stem
  export passes every track's chain (defaulting to the live store).

`noteFxParity.test.ts` (fast-check, random patterns × random chains × 1–3
passes) and `noteFxLiveOffline.test.ts` (the real step handler against the
real pattern renderer) pin that both schedule the same events — times,
pitches, lengths, velocities.

## Automation

Chain parameters are automatable through the track's normal lane target
(`synthA` / `synthB` / `bass2` / `sampler`) with ids `noteFx.<module>.<param>`:
`arp.on`, `arp.rate`, `arp.octaves`, `arp.gate`, `ratchet.on`,
`ratchet.count`, `euclid.pulses`, `euclid.rotation`, `humanize.timing`,
`humanize.velocity`. **Automate…** in the Note FX strip adds a lane starting
at the current value. The chain reads lane values per **source step** when
it builds a pass (live and offline alike); `AutomationScheduler` skips these
lanes, since they shape which notes exist rather than an AudioParam.

## Freeze FX to pattern

**Freeze to pattern** writes the chain's first pass back into the steps — one
undo entry (the sampler chain freezes every bank in that one entry) — and
bypasses the chain, keeping its settings.

The step model holds one note-start per step, so the projection is lossy
where the chain is denser than the grid, and says how much:

- events that start together on a step → root + `chord`;
- evenly spaced repeats of the same notes inside a step → `retrigger`;
- anything else past a step's first note-start is counted and announced
  ("Froze 32 notes; 24 did not fit one note per step").

Phase 3's free-time `events` would make freezing lossless.

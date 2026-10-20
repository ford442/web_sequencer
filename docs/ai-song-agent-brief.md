# Hyphon song brief for AI agents

Paste this into a prompt. Return **one JSON object, no prose**, that validates against
[`schemas/ai-song.schema.json`](schemas/ai-song.schema.json). Full reference:
[ai-song-format.md](ai-song-format.md).

## Tracks

| Key | What it is | Shape |
|-----|-----------|-------|
| `synthA`, `synthB` | Monophonic 303-style acid voices (one note per step). Waveform `303-saw` or `303-sqr`; `macro-*` / `prophecy-*` ids also work on these two | `{ notes: [...], params: {...} }` |
| `bass2` | Second 303, 303 waveforms only | same |
| `kick`, `snare`, `closedHat`, `openHat` | Analog drum kit, fixed voicing, no parameters | `boolean[]`, `true` = hit |
| `sampler` | Up to 8 banks. A bank names a sample but loads no audio at import | Leave it out unless asked |

A note is `{ "step": 0-31, "note": "C2", "velocity": 0-1, "length": steps, "accent": bool, "slide": bool }`.
Note names match `^[A-G][#b]?[0-8]$`: uppercase letter, optional `#` or `b`, octave 0-8 (`F#3`, `Bb1`; not `c4`, `C9`, `Bbb2`).
One note per step; a later one replaces it. 16-entry drum arrays repeat to fill 32 steps.

303 voice ids go in `params.model303` (default `stock-open303`; `jc303`, `rebirth-2.0`,
`mb33-mkii`, `raveolution` and others, see [audio-engine/303-voices.md](audio-engine/303-voices.md)).
Drum parameters, `effects`, `harmonizer` and `phonemePainter` do nothing; do not write them.

## What sounds good here

These are conventions from the repo's fixtures, not measurements. Render and read the report.

- **Bass register.** Keep `synthA`/`bass2` between `C1` and `C3`, `synthB` lead lines around `C3`-`C5`. Stay on a minor or phrygian set: root, b3, 5, b7, plus b2 for tension.
- **Accent.** Put an accent on roughly one note in three or four, favouring off-beat steps (2, 6, 10, 14) and the first note of a bar. An accent sets the note's timbre to 1.0 and lifts both the filter and the level, so a bar of all accents is a bar of none.
- **Slide.** `slide: true` glides *from the previous note into this one*. Use it one or two times a bar, into a different pitch (a slide to the same pitch is a tie).
- **Filter.** `filterCutoff` is in Hz (20-15000, logarithmic). Sit a bass at 600-1500 and open a lead toward 3000-6000. Low cutoff + short `decay` (0.2-0.35) is a pluck; raise `decay` to 0.45-0.6 to smooth it. `envMod` has no static field, so sweep the filter with a cutoff lane instead.
- **Resonance.** `filterResonance` is Q (0.1-30). The importer default is 8 and the fixtures span 6-20; stay at 6-16 for bass. Beyond ~20 the filter heads toward self-oscillation, and the docs call `rebirth-338-1.5` and `raveolution` self-oscillation-prone. Ask for that deliberately.
- **Movement.** One slow cutoff lane over the whole pattern beats many fast ones. `interpolation: "linear"` for sweeps, `"step"` for staircases.
- **Drums.** Kick on 0, 4, 8, 12 of 16; snare on 4 and 12; closed hat on the off-eighths. Leave one gap in the kick or hats at the end of a phrase.
- **Gain.** The importer default `volume` is 0.9; leave headroom by keeping layered voices lower and check `peak` in `report.json`.

## Automation lanes

`{ "target", "parameter", "steps": [...], "interpolation" }`. `steps` has exactly the pattern length:
**16 if your drum arrays have 16 entries, otherwise 32** (v1.1: `globals.stepCount`). Values are `0-127` or `null` (no change).

Only these lanes are **audible**; the rest validate, are saved, and play nothing (strict mode rejects them).
The authority is `ROUTED_AUTOMATION` in
[`laneResolver.ts`](../src/audio/automation/laneResolver.ts), tabulated in
[ai-song-format.md](ai-song-format.md#which-lanes-actually-reach-an-engine).

| Target | Audible parameters |
|--------|--------------------|
| `synthA`, `synthB`, `bass2` | `filterCutoff`, `filterResonance`, `decay`, `envMod`, `accent`, `volume`, `drive`; on a `macro-*` part, the `macro*` knobs |
| `kick`, `snare`, `closedHat`, `openHat`, `sampler` | none |
| `master` | none (`tempo` and `swing` are set in `globals`) |

## Hard limits

- `meta`: `title` (1-100 chars), `author`, `generator`, `prompt` all non-blank; `version` is `"1.0"` or `"1.1"`; `createdAt` ISO 8601.
- `globals.tempo` 30-300; `swing` 0-100 (50 = straight); `timeSignature` two integers 1-32.
- v1.0: `tracks` required, 32 steps. v1.1 adds `patterns` + `song` + `globals.stepCount` (1-64); use either `tracks` or `patterns`, not both ([song mode](ai-song-format.md#song-mode-v11), [example](../test-fixtures/ai-song/song-mode.json)).
- Note `step` below the pattern length, `bankIndex` 0-7, at most 32 patterns per track.
- No unknown keys: the schema rejects typos such as `filtercutoff`.

## Example

```json
{
  "meta": {
    "title": "Brief Example",
    "author": "your-model-name",
    "version": "1.0",
    "createdAt": "2026-10-20T00:00:00Z",
    "generator": "your-model-name",
    "prompt": "A 126 BPM acid loop with a sliding 303 bass and a slow filter sweep."
  },
  "globals": { "tempo": 126, "swing": 54 },
  "tracks": {
    "synthA": {
      "notes": [
        { "step": 0, "note": "C2", "velocity": 0.9, "accent": true },
        { "step": 3, "note": "C2" },
        { "step": 6, "note": "Eb2", "slide": true },
        { "step": 10, "note": "G2", "accent": true },
        { "step": 12, "note": "F2", "slide": true },
        { "step": 14, "note": "Bb1" }
      ],
      "params": { "waveform": "303-saw", "filterCutoff": 900, "filterResonance": 12, "decay": 0.35, "volume": 0.85 }
    },
    "kick": [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    "snare": [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
    "closedHat": [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false]
  },
  "automation": [
    {
      "target": "synthA",
      "parameter": "filterCutoff",
      "steps": [30, null, null, null, 45, null, null, null, 70, null, null, null, 100, null, null, 115],
      "interpolation": "linear"
    }
  ]
}
```

## Validate and render

```bash
pnpm run build                                             # once
pnpm run ai-song:render song.json --out out/song           # strict: any warning is an error
```

It writes `mix.wav`, `song.rbs/.mid/.xm` and `report.json` (importer warnings, per-bar loudness
and spectral centroid). Exit `0` ok, `2` validation or warning, `3` render failure, `4` silent
master. Fix what the report names and run again; see [ai-song-render.md](ai-song-render.md).
Schema-only check, no browser: validate the file against `docs/schemas/ai-song.schema.json` with any
JSON Schema 2020-12 validator (for example `ajv`).

# AI song format (`AISongData` v1.0 / v1.1)

The JSON contract for handing a song spec to an AI agent and getting back
something Hyphon can play. An agent that follows this document produces a file
that the **AI Song** modal validates, imports, and loads into the sequencer.

- **Schema type:** [`src/importers/ai-song/types.ts`](../src/importers/ai-song/types.ts) (`AISongData`)
- **Validator:** `validateAISongData()` in the same file
- **Converter:** [`AISongImporter.convert()`](../src/importers/ai-song/AISongImporter.ts) → `SavedSongData`
- **Song block (v1.1):** [`src/importers/ai-song/songBlock.ts`](../src/importers/ai-song/songBlock.ts) (pattern ids → slots), lane tiling in [`automation.ts`](../src/importers/ai-song/automation.ts)
- **Worked examples:** [`test-fixtures/ai-song/minimal.json`](../test-fixtures/ai-song/minimal.json), [`test-fixtures/ai-song/full.json`](../test-fixtures/ai-song/full.json), [`test-fixtures/ai-song/song-mode.json`](../test-fixtures/ai-song/song-mode.json) (v1.1)
- **Golden tests:** [`src/__tests__/aiSongGolden.test.ts`](../src/__tests__/aiSongGolden.test.ts), [`src/__tests__/aiSongSongMode.test.ts`](../src/__tests__/aiSongSongMode.test.ts) (v1.1, and the recorded v1.0 imports in `test-fixtures/ai-song/expected/`)

**v1.0** describes one pattern — every v1.0 song is a single loop. **v1.1**
adds an optional [song block](#song-mode-v11): named patterns arranged one
row per measure, which imports as Song Mode. A v1.0 file imports exactly as it
always has.

Anything the importer accepts is pinned by that golden test. Anything listed
under [Silently ignored](#silently-ignored) parses without error but has no
effect on the resulting song — do not spend tokens generating it.

---

## Top level

```jsonc
{
  "meta":     { ... },   // required
  "globals":  { ... },   // required
  "tracks":   { ... },   // required in v1.0; in v1.1 this or "patterns"
  "patterns": { ... },   // v1.1 only
  "song":     [ ... ],   // v1.1 only
  "automation": [ ... ]  // optional
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `meta` | ✅ | Song and generation metadata |
| `globals` | ✅ | Tempo, time signature, swing, and (v1.1) `stepCount` |
| `tracks` | ✅ v1.0 | Must be an object; every track inside it is individually optional. In v1.1, one pattern (`"A"`) — use either `tracks` or `patterns` |
| `patterns` | v1.1 | Named patterns, see [Song mode](#song-mode-v11) |
| `song` | v1.1 | One row per measure; required with `patterns` |
| `automation` | — | Array of automation lanes |

`patterns`, `song` and `globals.stepCount` in a file that says `"1.0"` are a
`VALIDATION_ERROR` (`… requires meta.version "1.1"`), not something the
importer half-applies.

---

## `meta`

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `title` | `string` | ✅ | Non-empty, max 100 chars |
| `author` | `string` | ✅ | Non-empty |
| `version` | `"1.0"` \| `"1.1"` | ✅ | Exactly one of these strings (`AI_SONG_FORMAT_VERSIONS` in `versioning.ts`); anything else is `UNSUPPORTED_VERSION` |
| `createdAt` | `string` | ✅ by type | ISO 8601. Not range-checked at import |
| `generator` | `string` | ✅ | Non-empty. Model or tool id, e.g. `"claude-opus-5"` |
| `prompt` | `string` | ✅ | Non-empty. The request the song was generated from |
| `tags` | `string[]` | — | Passed to cloud storage alongside the generator tag |

`author`, `generator` and `prompt` are required by the upload path, so they are
validated **at import** — a song missing one fails in the modal rather than
after the user tries to save it.

```json
{
  "title": "Minimal Acid",
  "author": "hyphon-fixtures",
  "version": "1.0",
  "createdAt": "2026-09-08T00:00:00Z",
  "generator": "claude-opus-5",
  "prompt": "Four-on-the-floor kick and one 303 bass line.",
  "tags": ["fixture", "minimal"]
}
```

---

## `globals`

| Field | Type | Required | Range | Default |
|-------|------|----------|-------|---------|
| `tempo` | `number` | ✅ | 30–300 BPM | — |
| `timeSignature` | `[number, number]` | — | Each an integer 1–32 | `[4, 4]` |
| `swing` | `number` | — | 0–100, where **50 = straight** | `50` |
| `stepCount` | `number` | — (v1.1 only) | Integer 1–64: steps per pattern and per measure | `32` |

`timeSignature` and `swing` are written to `SavedSongData.timeSignature` /
`SavedSongData.swing`, which are optional so songs saved before those fields
existed still load. Both are validated when present: a malformed value is a
`VALIDATION_ERROR`, not a silent drop.

> **Pattern length:** `swing` and `timeSignature` reach the transport through
> the song meter when the song loads. A v1.0 song is always 32 steps
> regardless of the signature. A v1.1 song is `globals.stepCount` steps (default 32), written to
> the song meter (`SavedSongData.stepCount`).

---

## `tracks`

Every track is optional; an absent track becomes an empty 32-step sequence.
v1.0 patterns are **always 32 steps** — the importer expands and clips to fit.
In v1.1 read "32" below as `stepCount`: a note step must be below it, and a
drum array is clipped to it (a 16-entry array is still doubled when
`stepCount` is 32). The same track shapes are used inside each of a v1.1
song's `patterns`.

### Melodic tracks — `synthA`, `synthB`, `bass2`

```jsonc
"synthA": {
  "notes": [ ... ],   // required
  "params": { ... },  // optional
  "harmonizer": { }   // optional — IGNORED, see below
}
```

`notes` is an array of note events:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `step` | `number` | ✅ | 0–31. Out of range → warning, event skipped |
| `note` | `string` | ✅ | `^[A-G][#b]?[0-8]$` — `"C4"`, `"F#3"`, `"Bb2"`. Invalid → warning, event skipped |
| `velocity` | `number` | — | 0–1. Default `0.8` |
| `length` | `number` | — | In steps. Default `1` |
| `accent` | `boolean` | — | Sets the note's `timbre` to `1.0` (vs `0.5`) |
| `slide` | `boolean` | — | TB-303 portamento from the previous step |

One note per step per track: a later event on an occupied step replaces the
earlier one.

`params` is a partial [`SynthParams`](../src/types.ts) merged over the importer
defaults (`303-saw`, cutoff 3000, resonance 8, decay 0.3, volume 0.9, …). The
fields worth setting are `waveform` (`"303-saw"` / `"303-sqr"`), `filterCutoff`,
`filterResonance`, `filterMode`, `decay`, `volume`, `pitch`, and the
`delayTime` / `delayFeedback` / `delayMix` trio.

**Macro models** (`synthA` / `synthB`): `waveform` may be any of the 24
`macro-*` ids ([macro-voices.md](audio-engine/macro-voices.md#models), e.g.
`"macro-va"`, `"macro-fm2"`, `"macro-chords"`, `"macro-modal"`), with the knobs
in `params.macro`:

```json
"params": {
  "waveform": "macro-chords",
  "volume": 0.8,
  "macro": { "harmonics": 0.35, "timbre": 0.5, "morph": 0.2, "decay": 0.6,
             "lpgColour": 0.5, "lpgMode": "gate", "polyphony": 8 }
}
```

Every `macro` field is optional (0–1, except `fmMod` / `timbreMod` /
`morphMod` −1…1, `polyphony` 1–8, `lpgMode` `"gate"` / `"ping"`). The filter,
envelope and delay fields do not apply to a macro part. An unknown `macro-*` id
becomes `"macro-va"` with a warning. A macro part plays one note per step from
this format (chords come from the editor's step chords).

`bass2` is additionally reduced to the narrower `Bass2Params` shape: its
`waveform`, `pitch`, `filterCutoff`→`cutoff`, `filterResonance`→`resonance`,
`filterMode`, `decay` and `volume` carry over; `accent` and `envMod` take fixed
defaults (0.7 / 0.5). BASS 2 is a 303 only: a `macro-*` waveform there becomes
`303-sqr` for square-fallback models and `303-saw` otherwise.

### Drum tracks — `kick`, `snare`, `closedHat`, `openHat`

Plain boolean arrays, `true` = hit:

```json
"kick": [true, false, false, false, true, false, false, false,
         true, false, false, false, true, false, false, false]
```

- A **16-entry** array is duplicated to fill 32 steps.
- A **32-entry** array is used as-is.
- Other lengths are used as-is and clipped at 32 (no padding, no repeat).

Hits get a fixed pitch per track (kick `C2`, snare `D2`, closed hat `F#2`, open
hat `A#2`) at velocity 1.0. Drum voice parameters are **not** settable from this
format — the importer always writes its own defaults.

### `sampler`

An array of up to 8 bank objects (order is irrelevant — `bankIndex` decides
placement):

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `bankIndex` | `number` | ✅ | 0–7. Out of range → warning, bank skipped |
| `steps` | note events | ✅ | Same shape as melodic `notes` (`accent` / `slide` unused) |
| `params` | partial `SamplerBankParams` | — | `playbackSpeed`, `volume`, `filterCutoff`, `filterResonance`, `drive`, `delaySend`, … |
| `ttsText` | `string` | — | Becomes the bank's `sampleName` |
| `sampleUrl` | `string` | — | Fallback `sampleName` when `ttsText` is absent |
| `phonemePainter` | object | — | **IGNORED**, see below |

Neither `ttsText` nor `sampleUrl` loads audio at import — they name the bank, and
the sample itself is resolved later by the sampler.

---

## `automation`

Optional array of lanes. Each lane drives exactly one parameter on one target.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `target` | enum | ✅ | `synthA`, `synthB`, `bass2`, `kick`, `snare`, `closedHat`, `openHat`, `sampler`, `master` |
| `parameter` | enum | ✅ | Must be valid **for that target** (table below) |
| `steps` | `(number \| null)[]` | ✅ | One entry per step, `0–127` or `null` for "no change" |
| `interpolation` | `"step" \| "linear" \| "smooth"` | — | Default `"step"` |

`steps.length` must **exactly** match the pattern length. In v1.0 the importer
infers it from the drum tracks: the first non-empty drum array of length ≤ 16
means 16, anything longer means 32, and a song with no drum tracks means 32.
In v1.1 it is `globals.stepCount` (default 32) for every lane, top-level or
pattern-local. A mismatch is a `VALIDATION_ERROR`
(`steps length (17) must match globals.stepCount (16)`).

### Valid parameters per target

| Target | Parameters |
|--------|------------|
| `synthA`, `synthB` | `filterCutoff`, `filterResonance`, `filterMode`, `decay`, `accent`, `envMod`, `waveform`, `pitch`, `volume`, `drive`, `delayTime`, `delayFeedback`, `delayMix`, and the macro knobs `macroHarmonics`, `macroTimbre`, `macroMorph`, `macroDecay`, `macroLpgColour`, `macroFmMod`, `macroTimbreMod`, `macroMorphMod`, `macroGlide`, `macroSpread` |
| `bass2` | as above, minus the three `delay*` parameters |
| `kick` | `pitch`, `decay`, `tone`, `volume` |
| `snare` | `decay`, `tone`, `noise`, `volume` |
| `closedHat`, `openHat` | `pitch`, `decay`, `volume` |
| `sampler` | `filterCutoff`, `filterResonance`, `drive`, `volume`, `playbackSpeed` |
| `master` | `tempo`, `swing`, `masterVolume` |

### Which lanes actually reach an engine

Validation accepts every target/parameter pair in the table above, but
`AutomationScheduler` only routes three targets today:

| Target | Routed? | Parameters that reach an engine |
|--------|---------|---------------------------------|
| `synthA`, `synthB`, `bass2` | ✅ | `filterCutoff`, `filterResonance`, `decay`, `envMod`, `accent`, `volume`, `drive`; on a macro part, the ten `macro*` knobs (sample-accurate) |
| `master` | partial | Only the PCF trio (`pcfCutoff`, `pcfResonance`, `pcfEnvAmount`) and only while a `PcfEffect` is attached. `tempo`, `swing` and `masterVolume` validate but no-op |
| `kick`, `snare`, `closedHat`, `openHat`, `sampler` | ❌ | None — the scheduler has no case for these targets |

A lane on an unrouted target is stored and saved with the song, and shows up in
the automation UI, but changes nothing you can hear. `filterMode`, `waveform`,
`pitch` and the three `delay*` parameters are likewise accepted and stored but
have no dispatch case. Prefer the ✅ row when the point is audible movement.

Offline renders (stems, the import modal's audio preview, 303 freeze) play
the same lanes; what each one can and cannot play is listed in
[automation.md § Offline renders](automation.md#offline-renders-stems-ai-preview-303-freeze).

### What the importer produces

Each lane with at least one non-null step becomes a `UnifiedAutomationLane` on
`SavedSongData.automationLanes`, which reaches `automationStore.importLanes()`
when the song loads. Only non-null steps become points, so a sparse lane stays
sparse.

**Lane values are normalized:** an authored `0–127` becomes a point value in
`[0, 1]` (`value / 127`, clamped). That is the invariant every automation
producer in the codebase obeys — see `AutomationLanePoint` in
[`src/types.ts`](../src/types.ts). The original `0–127` range is kept on the
lane as `originalRange` for display labelling only; it must never be used in
scheduling arithmetic. Lanes are emitted with `source: "ai"`, `scope: "song"`
and `enabled: true`.

```json
{
  "target": "synthA",
  "parameter": "filterCutoff",
  "steps": [24, 40, 72, 110, 127, 110, 72, 40,
            24, 40, 72, 110, 127, 110, 72, 40,
            24, 40, 72, 110, 127, 110, 72, 40,
            24, 40, 72, 110, 127, 110, 72, 40],
  "interpolation": "linear"
}
```

`test-fixtures/ai-song/full.json` carries one lane per interpolation mode — a
dense `linear` cutoff sweep, a `smooth` resonance lane with holes every fourth
step, and a stepped `decay` staircase — and the golden test asserts each one
reaches the scheduler as a *moving* applied value.

---

## Song mode (v1.1)

Set `"version": "1.1"`, name your patterns, and list the measures:

```jsonc
{
  "meta": { "version": "1.1", ... },
  "globals": { "tempo": 132, "stepCount": 16 },
  "patterns": {
    "intro":  { "tracks": { "kick": [ ... ], "closedHat": [ ... ] } },
    "groove": { "tracks": { "synthA": { "notes": [ ... ], "params": { "filterCutoff": 900 } },
                            "kick": [ ... ], "snare": [ ... ] } },
    "drop":   { "tracks": { "synthA": { "notes": [ ... ], "params": { "waveform": "303-sqr", "filterCutoff": 2400 } },
                            "kick": [ ... ] },
                "automation": [ { "target": "synthA", "parameter": "filterCutoff",
                                  "steps": [20, null, ..., 60], "interpolation": "linear" } ] }
  },
  "song": [
    { "kick": "intro", "closedHat": "intro" },
    { "synthA": "groove", "kick": "groove", "snare": "groove" },
    { "synthA": "drop", "kick": "drop" },
    { "synthA": null, "kick": "intro" }
  ]
}
```

### `patterns`

An object keyed by pattern id. Ids are any non-empty strings — pick names you
can keep track of (`"intro"`, `"drop"`, `"B"`). Each pattern is
`{ "tracks": { ... }, "automation"?: [ ... ] }`, where `tracks` has exactly the
[v1.0 track shapes](#tracks). A pattern does not have to define every track.

### `song`

An array of rows, one per measure, in play order. A row maps track names
(`synthA`, `synthB`, `bass2`, `kick`, `snare`, `closedHat`, `openHat`,
`sampler`) to a pattern id. A track missing from a row, or set to `null`, is
**silent** for that measure. Tracks are independent: in one measure `synthA`
can play `"drop"` while `kick` plays `"intro"`.

| Rule | Error `field` |
|------|---------------|
| `song` is a non-empty array (required with `patterns`) | `song` |
| Row keys are track names | `song[2].lead` |
| Row values are a defined pattern id or `null` | `song[3].bass2` |
| At most **32 distinct patterns per track** (Hyphon's slots per track) | `song[40].kick` |
| `tracks` and `patterns` are not both present | `patterns` |

If a row plays a pattern on a track that pattern does not define, the track is
silent there and the import reports a warning. A pattern that no row plays is
skipped with a warning.

**Top-level `tracks` in v1.1** means one pattern, `"A"`. Without a `song` the
importer writes one measure that plays `"A"` on every track; with one, rows may
only name `"A"`.

### What the importer produces

| `SavedSongData` field | From |
|-----------------------|------|
| `trackStorage[track][slot]` | Each track's patterns in the order the song first plays them: slot 0 is the first pattern that track plays, slot 1 the next new one, … (32 slots per track) |
| `songStructure` | One `SongMeasure` per row, slot indexes, `null` = silent. Song Mode turns on when there is more than one measure |
| `pattern`, `activeTrackSlots` | Each track's slot 0 |
| `stepCount` | `globals.stepCount` (song meter) |
| `params.synthA` / `synthB` / `bass2` | The `params` of the pattern in that track's slot 0 |
| `trackParamStorage` | Per-slot 303 knobs — see below |
| `automationLanes` | Top-level lanes, then the tiled pattern lanes — see below |
| `version` | `4`; the linear arrangement is derived from `songStructure` on load, like any v1–v4 song |

**Synth params per pattern.** `tracks.synthA.params` (and `synthB`, `bass2`)
inside a pattern apply while that pattern plays. When a 303 track plays more
than one pattern and at least one of them declares `params`, every slot that
track uses gets a full snapshot in `trackParamStorage` (the per-slot recall
`.rbs` DEVL import uses): a pattern with its own `params` gets those, and one
without gets slot 0's — so leaving a pattern returns the knobs to the song's
sound.

**Sampler banks are song-wide.** Bank voice settings (`params`, `ttsText`,
`sampleUrl`) come from the first pattern, in sampler slot order, that defines
each `bankIndex`. Note steps are per pattern as usual.

### Automation in v1.1

- **Top-level `automation`** lanes are song-wide: they repeat every measure,
  exactly like v1.0 lanes.
- **Pattern `automation`** is pattern-local. On import, all pattern lanes on
  one `target.parameter` are merged into **one** song lane laid out on the
  song timeline (`scope: "song"`, `timeline: "song"`, point step =
  `measure × stepCount + step`), with the lane's points repeated in every
  measure where the target's track plays that pattern (`master` lanes: any
  track). That is the shape the scheduler and `.rbs` TRAK export read.
- Each occurrence plays as the lane plays when its pattern loops: it holds its
  first value until its first point and its last value after its last point.
  **Between occurrences the lane holds the value the last one ended on**, and
  before the first one it holds its first value — an automated parameter
  stays automated for the whole song. If that is not what you want, give the
  other patterns on that track a lane for the parameter too.
- A song-wide lane and a pattern lane on the same `target.parameter` is a
  `VALIDATION_ERROR` (`patterns.drop.automation[0]`): the song-wide lane would
  always win.
- Pattern lanes on one parameter take the first one's `interpolation`; a
  different one elsewhere is reported as a warning.

A `timeline: "song"` lane is read at the song position while Song Mode plays
(live, and in song-mode stem renders). In pattern mode and in the import
modal's audio preview it is read at the pattern step, so it plays its first
measure.

### Full example

[`test-fixtures/ai-song/song-mode.json`](../test-fixtures/ai-song/song-mode.json)
is a complete 16-step song: four patterns (`intro`, `groove`, `drop`, `break`)
over ten measures, `drop` with its own 303 sound and a cutoff sweep. It
imports as:

| Measure | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---------|---|---|---|---|---|---|---|---|---|---|
| `synthA` | — | — | groove (0) | groove (0) | drop (1) | drop (1) | break (2) | drop (1) | groove (0) | — |
| `kick` | intro (0) | intro (0) | groove (1) | groove (1) | drop (2) | drop (2) | — | drop (2) | intro (0) | intro (0) |

with `trackParamStorage.synthA` = `[groove, drop, groove]` knobs (break has no
`params`) and one `synthA.filterCutoff` lane whose sweep plays in measures 4,
5 and 7 and holds through the break.

---

## Silently ignored

These parse without error and appear in no warning, but have **no effect** on
the imported song:

| Input | Status |
|-------|--------|
| `tracks.<synth>.harmonizer` | Accepted by the schema; `AISongImporter.convertHarmonizer()` still validates one on request, but nothing attaches the result to the song. |
| `tracks.sampler[].phonemePainter` | Same — validated on request, never attached. |
| `meta.createdAt` | Stored as metadata; never parsed or range-checked. |
| Extra/unknown top-level keys | Ignored by the validator. In particular there is **no `effects` field** — an effects chain was never part of `AISongData` and the dead converter for it has been removed. |
| Drum voice parameters | Not expressible; kick/snare/hat params always come from importer defaults. |
| Automation on unrouted targets/parameters | Validated, converted and saved, but never dispatched — see [Which lanes actually reach an engine](#which-lanes-actually-reach-an-engine). |

## Errors

`convert()` returns a discriminated union. On failure, `error.type` is one of:

| Type | Meaning |
|------|---------|
| `VALIDATION_ERROR` | `field` + `message` name the offending path, e.g. `meta.prompt`, `globals.swing`, `automation[1].steps`, `song[3].bass2`, `patterns.drop.automation[0].steps` |
| `UNSUPPORTED_VERSION` | `meta.version` is not `"1.0"` or `"1.1"` |
| `CONVERSION_ERROR` | Threw while converting; `track` + `details` |
| `INVALID_NOTE` | Reserved for note-level failures |
| `STORAGE_ERROR` | Upload path only |

Recoverable problems (a note on step 40, an unparseable note name, a sampler
`bankIndex` of 9) do **not** fail the import — they are dropped and reported in
`result.report.warnings`.

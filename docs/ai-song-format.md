# AI song format (`AISongData` v1.0)

The JSON contract for handing a song spec to an AI agent and getting back
something Hyphon can play. An agent that follows this document produces a file
that the **AI Song** modal validates, imports, and loads into the sequencer.

- **Schema type:** [`src/importers/ai-song/types.ts`](../src/importers/ai-song/types.ts) (`AISongData`)
- **Validator:** `validateAISongData()` in the same file
- **Converter:** [`AISongImporter.convert()`](../src/importers/ai-song/AISongImporter.ts) → `SavedSongData`
- **Worked examples:** [`test-fixtures/ai-song/minimal.json`](../test-fixtures/ai-song/minimal.json), [`test-fixtures/ai-song/full.json`](../test-fixtures/ai-song/full.json)
- **Golden test:** [`src/__tests__/aiSongGolden.test.ts`](../src/__tests__/aiSongGolden.test.ts)

Anything the importer accepts is pinned by that golden test. Anything listed
under [Silently ignored](#silently-ignored) parses without error but has no
effect on the resulting song — do not spend tokens generating it.

---

## Top level

```jsonc
{
  "meta":     { ... },   // required
  "globals":  { ... },   // required
  "tracks":   { ... },   // required
  "automation": [ ... ]  // optional
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `meta` | ✅ | Song and generation metadata |
| `globals` | ✅ | Tempo, time signature, swing |
| `tracks` | ✅ | Must be an object; every track inside it is individually optional |
| `automation` | — | Array of automation lanes |

---

## `meta`

| Field | Type | Required | Rules |
|-------|------|----------|-------|
| `title` | `string` | ✅ | Non-empty, max 100 chars |
| `author` | `string` | ✅ | Non-empty |
| `version` | `"1.0"` | ✅ | Exactly the string `"1.0"`; anything else is `UNSUPPORTED_VERSION` |
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

`timeSignature` and `swing` are written to `SavedSongData.timeSignature` /
`SavedSongData.swing`, which are optional so songs saved before those fields
existed still load. Both are validated when present: a malformed value is a
`VALIDATION_ERROR`, not a silent drop.

> **Caveat:** `swing` currently round-trips through save/load but is *not* yet
> wired to the transport, so importing a swung song does not change playback
> feel. `timeSignature` is likewise stored rather than applied to the grid.
> Pattern length is always 32 steps regardless of the signature.

---

## `tracks`

Every track is optional; an absent track becomes an empty 32-step sequence.
Hyphon patterns are **always 32 steps** — the importer expands and clips to fit.

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

`bass2` is additionally reduced to the narrower `Bass2Params` shape: its
`waveform`, `pitch`, `filterCutoff`→`cutoff`, `filterResonance`→`resonance`,
`filterMode`, `decay` and `volume` carry over; `accent` and `envMod` take fixed
defaults (0.7 / 0.5).

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

`steps.length` must **exactly** match the pattern length, which the importer
infers from the drum tracks: the first non-empty drum array of length ≤ 16 means
16, anything longer means 32, and a song with no drum tracks means 32. A
mismatch is a `VALIDATION_ERROR`.

### Valid parameters per target

| Target | Parameters |
|--------|------------|
| `synthA`, `synthB` | `filterCutoff`, `filterResonance`, `filterMode`, `decay`, `accent`, `envMod`, `waveform`, `pitch`, `volume`, `drive`, `delayTime`, `delayFeedback`, `delayMix` |
| `bass2` | as above, minus the three `delay*` parameters |
| `kick` | `pitch`, `decay`, `tone`, `volume` |
| `snare` | `decay`, `tone`, `noise`, `volume` |
| `closedHat`, `openHat` | `pitch`, `decay`, `volume` |
| `sampler` | `filterCutoff`, `filterResonance`, `drive`, `volume`, `playbackSpeed` |
| `master` | `tempo`, `swing`, `masterVolume` |

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

## Errors

`convert()` returns a discriminated union. On failure, `error.type` is one of:

| Type | Meaning |
|------|---------|
| `VALIDATION_ERROR` | `field` + `message` name the offending path, e.g. `meta.prompt`, `globals.swing`, `automation[1].steps` |
| `UNSUPPORTED_VERSION` | `meta.version` is not `"1.0"` |
| `CONVERSION_ERROR` | Threw while converting; `track` + `details` |
| `INVALID_NOTE` | Reserved for note-level failures |
| `STORAGE_ERROR` | Upload path only |

Recoverable problems (a note on step 40, an unparseable note name, a sampler
`bankIndex` of 9) do **not** fail the import — they are dropped and reported in
`result.report.warnings`.

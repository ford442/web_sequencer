# Session pack format (`.hyphonpack.json`)

A **session pack** is a portable Session Launcher starter: a name, a [`SessionDocument`](session-launcher.md) (scenes and clips), the pattern slots those clips point at, and optional SYNTH A / B settings. Export the live session to share it; import a file to preview it and load it. Packs are **data only** — no code, no URLs, no audio.

| Piece | Where |
| --- | --- |
| Contract (JSON Schema 2020-12) | [`docs/schemas/session-pack.schema.json`](schemas/session-pack.schema.json) — generated, do not edit |
| Schema source | `src/session/pack/schema.ts` |
| Types, limits, version | `src/session/pack/format.ts` |
| Import: parse → migrate → validate → preview | `src/session/pack/validate.ts`, `migrate.ts`, `import.ts`, `preview.ts` |
| Export | `src/session/pack/export.ts` |
| Load planning (ids, slot collisions) | `src/session/pack/plan.ts` |
| Launcher UI | `src/components/session-launcher/` |
| State wiring | `src/hooks/appState/useSessionPacks.ts` |
| Starter files | `src/session/packs/library/*.hyphonpack.json`, listed in `src/session/packs/library.ts` |

## Minimal example

This file is a test fixture: `sessionPackFormat.test.ts` imports it with the real importer.

```json
{
  "format": "hyphon-session-pack",
  "formatVersion": 1,
  "id": "four-on-the-floor",
  "name": "Four on the Floor",
  "description": "One kick clip, one scene.",
  "author": "Example Author",
  "session": {
    "schemaVersion": 1,
    "quantization": "bar",
    "columns": {
      "partA": {"track":"partA","clips":[{"id":"c:partA:0","name":"1","slotIndex":0,"launchMode":"trigger","followAction":"none","followRepeatN":1,"empty":true}]},
      "partB": {"track":"partB","clips":[{"id":"c:partB:0","name":"1","slotIndex":0,"launchMode":"trigger","followAction":"none","followRepeatN":1,"empty":true}]},
      "bass2": {"track":"bass2","clips":[{"id":"c:bass2:0","name":"1","slotIndex":0,"launchMode":"trigger","followAction":"none","followRepeatN":1,"empty":true}]},
      "kick": {"track":"kick","clips":[{"id":"c:kick:0","name":"Four","slotIndex":0,"launchMode":"trigger","followAction":"none","followRepeatN":1,"empty":false}]},
      "snare": {"track":"snare","clips":[{"id":"c:snare:0","name":"1","slotIndex":0,"launchMode":"trigger","followAction":"none","followRepeatN":1,"empty":true}]},
      "closedHat": {"track":"closedHat","clips":[{"id":"c:closedHat:0","name":"1","slotIndex":0,"launchMode":"trigger","followAction":"none","followRepeatN":1,"empty":true}]},
      "openHat": {"track":"openHat","clips":[{"id":"c:openHat:0","name":"1","slotIndex":0,"launchMode":"trigger","followAction":"none","followRepeatN":1,"empty":true}]},
      "sampler": {"track":"sampler","clips":[{"id":"c:sampler:0","name":"1","slotIndex":0,"launchMode":"trigger","followAction":"none","followRepeatN":1,"empty":true}]}
    },
    "scenes": [
      { "id": "s:0", "name": "Go", "clipIds": { "kick": "c:kick:0" } }
    ]
  },
  "trackStorage": {
    "kick": [
      {
        "steps": [
          {"note":"C2","velocity":0.9},
          null,
          null,
          null,
          {"note":"C2","velocity":0.9},
          null,
          null,
          null,
          {"note":"C2","velocity":0.9},
          null,
          null,
          null,
          {"note":"C2","velocity":0.9},
          null,
          null,
          null
        ]
      }
    ]
  },
  "instruments": {
    "synthA": { "waveform": "macro-additive", "volume": 0.5, "macro": { "polyphony": 8, "lpgMode": "gate" } }
  }
}
```

## Fields

Every object is **closed**: a field that is not listed here is an error, not ignored.

### Top level

| Field | Type | Notes |
| --- | --- | --- |
| `format` | `"hyphon-session-pack"` | Required. Any other value is "not a pack". |
| `formatVersion` | integer | Required. `1` today. See [Versions](#versions-and-migrations). |
| `id` | string | Required. A slug: `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64. Collisions are resolved on import ([Ids](#ids-and-collisions)). |
| `name` | string | Required, 1–80 characters. |
| `description`, `author` | string | Optional, ≤ 500 / ≤ 80 characters. |
| `session` | object | Required. The session document, below. |
| `trackStorage` | object | Required. The patterns, below. |
| `instruments` | object | Optional. `synthA` and/or `synthB`, below. |

Names and descriptions may not contain control characters or the Unicode bidirectional override/isolate characters (U+202A–202E, U+2066–2069), which can make a name display as something it is not.

### `session`

The same document the song file stores in `SavedSongData.session` (`SESSION_DOCUMENT_VERSION` 1):

| Field | Notes |
| --- | --- |
| `schemaVersion` | `1`. |
| `quantization` | `immediate`, `step`, `beat`, `bar`, `2bars` or `4bars`. |
| `columns` | An object with **all eight** track keys (`partA`, `partB`, `bass2`, `kick`, `snare`, `closedHat`, `openHat`, `sampler`). Each is `{ "track": <its own key>, "clips": [...] }` with 1–32 clips. Every column has the same number of clips: one per row. |
| `scenes` | 0–32 scenes, no more than there are rows. Each is `{ "id", "name", "clipIds" }`; `clipIds` maps track keys to a clip id or `null`/missing. |

A clip is `{ "id", "name", "slotIndex", "launchMode", "followAction", "followRepeatN", "empty" }`:

- `id` — letters, digits and `: _ . -`, ≤ 64. Unique across the whole document (a scene names a clip by id alone). The app's own ids look like `c:kick:3`.
- `slotIndex` — 0–31: the pattern slot in `trackStorage` this clip plays. Clips *reference* patterns; they never contain notes. Two clips may reference the same slot, and a clip need not sit on the row of its slot.
- `launchMode` — `trigger`, `gate`, `toggle` or `one-shot`; `followAction` — `none`, `next`, `previous`, `random`, `stop` or `repeat`; `followRepeatN` — 1–64. See [session-launcher.md](session-launcher.md).
- `empty` — `true` for a placeholder cell. A clip with `"empty": false` **must** have a pattern in its slot.

### `trackStorage`

An object keyed by track; each value is an array of up to 32 **slots**, index = slot number, `null` or missing = empty. Missing tracks are empty.

- Every track except the sampler: a slot is a *pattern* `{ "steps": [...], "automation"?: {...} }`.
- `sampler`: a slot is an array of 1–8 patterns, one per sampler **bank**.
- `steps` has 1–64 entries (32 is the default grid). An entry is `null` (empty step) or a note.
- A note needs `note` (a pitch name `C-1`…`G9` — letter `A`–`G`, an optional `#`/`b`, octave; `G#9` is spelled right but above the MIDI range and is refused) and `velocity` (0–1). Everything else is optional: `length` (steps, 0–256), `chord` (up to 16 more pitch names), `slide`, `probability` (0–1), `microtiming` (−2…2 of a step), `retrigger`, `reverse`, `sliceIndex`, `phonemes` (≤ 64) and the other per-note parameters of the app's `Note` type (numbers within ±1e6, booleans, ≤ 512-point curves). A note field the app adds later must also be added to `src/session/pack/schema.ts`; it will not compile otherwise.
- `automation` maps a parameter name (`^[A-Za-z][A-Za-z0-9]{0,47}$`, never `__proto__`, `constructor` or `prototype`) to an array of ≤ 64 numbers or `null`s; ≤ 64 lanes per pattern.

### `instruments`

`synthA` / `synthB` are partial synth settings applied when the pack loads; omitted fields keep the part's current value. Supported fields and ranges:

| Field | Range |
| --- | --- |
| `waveform` | any waveform id the app can play, including the 24 `macro-*` models |
| `engine303`, `model303` | `open303`/`jc303`; a 303 voice id from the catalog |
| `pitch`, `pitchAmount`, `coarseTune` | −48…48 |
| `fineTune` | −1200…1200 |
| `filterCutoff` | 20…20000 Hz |
| `filterResonance` | 0…40 |
| `filterMode`, `drive`, `sustain`, `delayMix`, `portamento`, `formantShift`, `formantPitchLink` | 0…1 |
| `attack`, `decay`, `release`, `length`, `pitchAttack`, `pitchDecay` | 0…10 s |
| `volume` | 0…2 |
| `pan` | −1…1 |
| `delayTime` | 0…4 s; `delayFeedback` 0…0.99 |
| `vowel` | 0…4 |
| `macro` | `harmonics`, `timbre`, `morph`, `decay`, `lpgColour`, `spread`, `glide`, `auxMix` 0…1; `fmMod`, `timbreMod`, `morphMod` −1…1; `polyphony` integer 1…8; `lpgMode` `gate`/`ping` |

Not carried: BASS 2, drum and sampler settings, `model303Extra` (high-fidelity coefficients), samples and TTS text. A pack that needs audio says so in its description.

## Limits

| Limit | Value |
| --- | --- |
| File size | 4 MiB (UTF-8). Checked on the `File` before reading, and again on the text. |
| Slots per track / rows / scenes | 32 |
| Steps per pattern / sampler banks per slot | 64 / 8 |
| Nesting depth | 64 levels |
| Issues listed for one failed import | 25 |

All are in `PACK_LIMITS` (`format.ts`). Nothing is truncated: a value over a limit is an error. The depth cap exists so deeply nested input is refused before the stages that copy or print it; real packs nest 7 levels.

## Import

`importPackFile` / `importPackText` (and `parseSessionPackValue` for data that is already parsed) run these stages in order; each sees only what the previous one accepted, and **none of them touches app state**:

1. **Size** — oversized files are refused before they are read.
2. **`JSON.parse`** — no reviver, no `eval`.
3. **Migrate** — `migrateSessionPack` lifts older versions to this build's.
4. **Structure** — the schema, precompiled by ajv's standalone code generation (`src/session/pack/generated/packValidator.js`); the app ships these functions, not ajv. One issue is reported, with its path.
5. **References** — what a schema cannot say: clip and scene ids unique; scenes naming clips that exist *on that track*; non-empty clips with a pattern behind them; equal column lengths; playable pitch names. Up to 25 issues.
6. **Normalize** — a fresh `SessionPack` is built from the accepted fields.

Every issue is `{ code, path, message }` — for example `trackStorage.kick[0].steps[3].velocity: 7 is out of range; it must be at most 1.` Codes: `too-large`, `invalid-json`, `not-a-pack`, `unsupported-version`, `schema`, `reference`, `duplicate-id`, `inconsistent`, `note`, `export`, `unavailable` (the import code itself could not run, e.g. its lazy chunk failed to download).

The Session Launcher then shows a **preview** — name, scenes, tracks (clips, patterns, notes), the instruments the pack asks for and what they need (for example the native macro engine), and any pattern slots it would collide with. **Nothing is loaded until the user chooses Load pack.** A file that fails any stage leaves the session, the patterns and the instruments exactly as they were; there is no partial import.

### Security model

- A pack is parsed as JSON and checked against a closed schema. It cannot contain functions, scripts, URLs or references to other files, and the importer has no code path that fetches anything or evaluates anything from it. Unknown fields — `sampleUrl`, `icon`, `onLaunch`, `__proto__` — are rejected, not ignored.
- Text is rendered as text by React; names with control or direction-override characters are refused.
- Output objects come out of validated, closed objects, so a hostile key cannot reach a prototype.

### Ids and collisions

- **Pack ids.** An imported pack never takes the id of a starter or of an earlier import: `acid-live-set` becomes `acid-live-set-2`, then `-3`, … — the first free number, so the same inputs always give the same id. Importing the *identical* file again keeps its id and replaces the earlier import. The preview says when an id was changed.
- **Pattern slots.** A pack slot that would replace a *different, non-empty* pattern of the song is a collision (the same pattern, or an empty slot, is not). The preview lists them and the user chooses: **keep mine** (default) puts the pack's pattern in the lowest free slot of the same track and repoints the clips and scenes that name it (ids follow the `c:<track>:<slot>` convention; a clash gets `:r1`, `:r2`, …), or **replace mine**. If a track has no free slot the load fails with a message and changes nothing. The built-in and library starters keep their long-standing behaviour: they replace the slots they use.

## Export

**EXPORT PACK** writes the live session — its session document, `trackStorage` and SYNTH A / B — under the typed name (the id is the name as a slug). Before the file is offered it is run back through the importer; a session that would not import is reported instead of exported. Two things are normalized: instrument values are clamped to the ranges above (fields the format does not carry are dropped, with a note), and a clip marked non-empty whose slot holds no pattern is written as `"empty": true`. Round trips preserve the session document, every pattern slot (notes, chords, automation, sampler banks), scenes and links, and the supported instrument parameters (`sessionPackFormat.test.ts`).

## Versions and migrations

`formatVersion` is an integer. This build reads versions up to `SESSION_PACK_FORMAT_VERSION` and refuses newer ones with an `unsupported-version` message naming both. Migrations are pure functions in `PACK_MIGRATIONS` (`src/session/pack/migrate.ts`), keyed by the version they upgrade *from*; each runs on a deep copy and is stamped with the next version. Version 1 is the first format, so the table is empty. To change the format: bump `SESSION_PACK_FORMAT_VERSION`, add the migration for the old version, regenerate the schema, and keep a fixture of the old format in the tests.

## Starter library

Starters that ship as data live in `src/session/packs/library/` and are listed in `src/session/packs/library.ts`; each is its own lazily loaded chunk (a JSON module, shipped minified) and goes through the same migrate → validate stages as a user's file (`parseSessionPackValue`). The importer itself — validator, export, planner — is one more lazy chunk, loaded the first time the user imports, exports or opens one of these starters. They are original: patterns built with the app's own tools (`randomizeDrumTrack`, `randomizeMelodicTrack`, `euclideanRhythm`, `applyGrooveTemplate`, `humanizePattern`, fixed seeds) and its engines (the macro models, the 303, the drum kit, the sampler); no third-party material. `sessionPackLibrary.test.ts` fails if the list and the folder disagree or a file stops being a valid pack.

| Pack | Workflow |
| --- | --- |
| Ambient Drift | Evolving: two-bar macro chord movements chained with `next`, bells wandering with `random`, a heartbeat and a breath on toggled clips, `2bars` quantization |
| Broken Beat Workbench | Groove: syncopated kick/snare cells, funk and shuffle hats with microtiming, toggled layers, a one-shot fill, FM keys and bass |
| Vocal Sampler Booth | Performance: sampler banks as phrase, call and reply, sliced chop roll, a one-shot reverse swell, a gated stutter; vowel pad underneath |

## Regenerating the contract

```bash
pnpm run gen:session-pack-schema    # docs/schemas/session-pack.schema.json + generated/packValidator.js
pnpm run check:session-pack-schema  # drift check; part of pnpm lint
```

## Accessibility

The pack controls are ordinary buttons, a text field and a file input behind a button, in labelled groups (`Starter packs`, `Pack files`). The preview is a labelled region that takes focus when it opens; the collision choice is a fieldset with radio buttons; **Escape** closes the preview first and the launcher second, and focus returns to the Import button. Results are announced through the live region (`a11yAnnouncerStore`), errors as an alert. Enter, Space, arrows, Delete and Backspace only drive the clip grid when focus is in it, so the header buttons, the quantization select and the pack name field keep their own keys.

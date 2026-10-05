# Standard MIDI File (SMF) import/export pipeline

Generic DAW interchange: import/export format 0/1 `.mid` files. Independent
of the ReBirth/Electribe-native `.rbs` path (see
`docs/audio-engine/RBS_IMPORT_PIPELINE.md`) — `src/importers/smf/**` never
imports from `src/importers/rbs/**` and vice versa. RBS stays the
Electribe-native round-trip path; SMF is the "hand a pattern to any other
DAW" path.

## File layout

```
src/importers/smf/
  types.ts        Parsed/imported data shapes, channel-map defaults, GM drum map
  SmfParser.ts     .mid bytes -> ParsedSmf (MThd/MTrk, running status, tempo/timesig, sustain)
  SmfImporter.ts   ParsedSmf -> HyphonSmfSong (quantized 2-bar patterns in the file's meter, ImportReport)
  SmfExporter.ts   Hyphon pattern/song data -> .mid bytes (format 1)
  index.ts         Barrel

src/components/SmfImportModal.tsx   Import UI (drag & drop, report panel)
```

Companion to `RbsImportModal.tsx` at a smaller scale — SMF import needs no
per-track options panel because channel routing uses fixed GM-style
defaults rather than user-tunable ReBirth device targets.

## Lazy-loading (entry-chunk budget)

Per `docs/PERFORMANCE_BUDGET.md`, `src/importers/smf/**` must never land in
the entry chunk:

- `SmfImportModal` is `React.lazy()`-loaded from `App.tsx`, mounted only
  while `isSmfImportModalOpen` is true (mirrors `RbsImportModal`). It does
  its own static `import '../importers/smf'` at module scope — safe,
  because the whole module is behind the lazy boundary.
- `useSongStorage.ts`'s `exportSmfToFile()` does `await import('../importers/smf')`
  *inside* the click handler, not a top-level import. `handleSmfImport`'s
  parameter type is referenced with `import('../importers/smf').HyphonSmfSong`
  (a type-only position — erased at compile time, costs nothing at runtime).

## Grid convention (read this before touching quantization)

A Hyphon step is always a **16th note**, whatever the meter. One Hyphon
pattern is **2 bars** of the file's first time signature
(`smfPatternSteps` in `SmfImporter.ts`, built on `stepsPerBar` in
`src/utils/musicTheory.ts`):

```
ticksPerStep    = ppq / 4                       // 16th-note grid, every meter
stepsPerBar     = numerator * 16 / denominator  // 4/4 → 16, 3/4 → 12, 7/8 → 14
patternSteps    = 2 * stepsPerBar               // 4/4 → 32, 3/4 → 24, 7/8 → 28
ticksPerPattern = ticksPerStep * patternSteps
```

When two bars would exceed the 64-step maximum, a pattern is one bar. The
song gets `stepCount = patternSteps` and `timeSignature = [num, den]`, so
the pattern grid lines up with the source file's bar lines.

`ImportReport.timeSignatureMismatch` is set (with a warning) only when the
meter can't be represented:

- the denominator isn't 2/4/8/16 (e.g. 5/32) — patterns fall back to 32
  steps and the song is treated as 4/4, so bars will drift; or
- the file changes time signature mid-song — Hyphon has one meter per song,
  so only the first is kept (time-signature *changes* are out of scope).

The importer and exporter always use this same formula, so an SMF file
Hyphon exported and re-imports round-trips ticks and meter exactly (see
`src/__tests__/SmfExporter.test.ts`, including a 3/4 round trip).

## Channel routing (import)

| Channel (1-based) | Target |
|---|---|
| 1 | `partA` |
| 2 | `partB` |
| 3 | `bass2` |
| 10 | Drums — GM note 36/38/42/46 → kick/snare/closedHat/openHat; any other note → sampler bank 0 (`ImportReport.drumGmMisses`) |
| other | Round-robins across `partA`/`partB`/`bass2`, appended as **extra pattern slots** (its own section of measures tacked onto the end of the song) rather than inventing a new track — Hyphon's `TrackKey` set is fixed. |

`SmfImportOptions.channelMap` can override the default assignment per
0-based channel index.

## Automation

`CC74` (a de facto "filter cutoff" CC in many DAWs) on a channel routed to
`partA`/`partB`/`bass2` becomes a `filterCutoff`/`cutoff` automation lane
in the same `UnifiedAutomationLane` shape RBS's PCF conversion produces
(via `automationStore.convertHyphonLanes`) — same scheduler, no separate
SMF-specific automation path. CC74 on any other channel is skipped with a
report row rather than silently dropped or (incorrectly) written into RBS's
PCF representation.

Other CCs, pitch bend, and program change are parsed (available on
`ParsedSmf`) but not yet mapped to anything — a later issue can add
GM-program → waveform mapping.

## Note fields

- `Note.velocity`: MIDI 1–127 → normalized 0–1.
- `Note.length`: set (in steps) when a note's tick span covers more than
  one step; sustain-pedal (CC64) extends a note's end tick before this
  conversion happens, so a sustained note gets the right `length`.
- `Note.microtiming`: quantization remainder (fraction of a step, clamped
  to ±0.5) when `SmfImportOptions.quantize` is on (default).
- Two notes landing on the same step/track (chords, or a quantize
  collision) stack via `Note.chord` rather than one silently overwriting
  the other.

## Export

`SmfExporter` writes one SMF format-1 file: a conductor track (tempo +
time signature) plus one note track per non-empty Hyphon track (channels
mirror the import defaults; sampler banks get their own channels). The
conductor track carries the song's `timeSignature` (4/4 when absent), and
every measure is the song's `stepCount` long, with per-track loop lengths
(`trackLengths`) tiled into each measure as they play live. Pattern
mode exports the current pattern as one loop; song mode
(`useSongMode: true`) walks the full arrangement via
`src/utils/songTimeline.ts#resolveSongTimeline` — the same helper stem
export uses — so the file contains every measure in `SongStructure` order,
not just the current pattern.

## Testing

- `src/__tests__/SmfParser.test.ts` — hand-built binary fixtures (via
  `src/__tests__/smf/smfBinaryBuilder.ts`) covering running status, format
  0/1, velocity-0-as-note-off, sustain (CC64) note-length extension, tempo
  map, time signature, SysEx skipping, truncated-file EOT recovery, and a
  parse of the real `test-fixtures/10_isotherms.mid` fixture.
- `src/__tests__/SmfImporter.test.ts` — channel routing, GM drum mapping,
  velocity/length conversion, CC74 automation, multi-pattern song
  arrangement.
- `src/__tests__/SmfExporter.test.ts` — export → parse → import round trip
  (tick fidelity within one 16th note) and song-mode concatenation order.
- `tests/smf-roundtrip.spec.ts` (Playwright) — imports
  `test-fixtures/10_isotherms.mid` (a real SMF file — RBS's own tests use
  it as the *negative* fixture proving RBS rejects real MIDI bytes; here
  it's the *positive* fixture) through the actual UI and asserts no crash.
- RBS's existing negative-fixture tests (`RbsParser.test.ts`,
  `RbsCorpus.test.ts`) are untouched and still pass — `.mid` bytes under a
  `.rbs` filename are still rejected.

## Out of scope (v1)

MIDI 2.0, clip files, Ableton `.als`, program-change → waveform mapping,
freeze/audio stems. See the tracking issue for the full list.

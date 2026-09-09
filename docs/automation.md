# Automation + RBS Import Notes

This document summarizes the current automation architecture and how `.rbs` data is mapped into Hyphon playback state.

## Architecture overview

- `src/importers/rbs/RbsParser.ts` parses `.rbs` binary data into `RawRbsData`.
- `src/importers/rbs/RbsImporter.ts` converts `RawRbsData` into `HyphonSong`:
  - 16-step TB-303/drum patterns are expanded to 32-step Hyphon patterns by default.
  - PCF data can be converted into automation lanes or preserved as `song.pcfFilter` (`importPcfAsFilter`).
  - Supported automation parameters are mapped to Hyphon targets (`synthA`, `synthB`, `master`).
- `src/audio/automation/AutomationScheduler.ts` schedules lane values to engine targets at audio-clock time.
  - `scheduleFromLanes()` handles step-indexed lanes from app state/import.
  - `scheduleFromTrakEvents()` handles RBS TRAK tick events.
  - Open303 parameters are applied through `Open303Manager.scheduleParamAtTime()` per voice (`lead303`, `bass1`, `bass2`).
- WAM2 parameters use `target: 'wam'` and `parameter: '<slotId>/<paramId>'` via `AutomationScheduler.setWamHost()`.

## Lane value invariant

`AutomationLanePoint.value` (and therefore every `UnifiedAutomationLane` /
`HyphonAutomationLane` point) is **always normalized to [0, 1]**, whatever the
source (`rbs`, `recorded`, `ai`, `manual`) and whatever the target.

`originalRange` is **display metadata only** — the parameter's real-world range
(`[0, 127]` for RBS knobs, `[80, 12000]` Hz for a WAM cutoff) so the UI can show
a value a user recognises. It must never be used in scheduling arithmetic;
denormalizing with it at schedule time pins the applied parameter at its
maximum. `AutomationScheduler.scheduleFromLanes` enforces this with a dev-only
assertion that rejects out-of-range point values instead of scheduling them.

Consumers convert 0–1 into engine units themselves (e.g. PCF cutoff 0–1 → Hz via
`20 × 1000^v`, PCF resonance 0–1 → 0–127).

## TB-303 routing

`RbsImportOptions.tb303ATarget` / `tb303BTarget` (defaults `partA` / `bass2`) are
the single source of truth for which Hyphon voice a TB-303 track drives.
`resolveTb303Target()` in `importers/rbs/importOptions.ts` resolves the option to
a lane target, and notes (`patternConversion`), converted lanes + PCF lanes
(`automationConversion`) and sub-step TRAK events (`resolveTrakParamMapping`,
which defaults to `DEFAULT_RBS_IMPORT_OPTIONS`) all resolve through it — so a
track's notes and its knob automation always land on the same voice.

## Master lanes

The scheduler's `master` target only reaches `PcfEffect`: `pcfCutoff`,
`pcfResonance` and `pcfEnvAmount`. The importer therefore does not emit
`master.tempo`, `master.swing`, `master.volume` or `master.drumPcfModulation`
lanes — there is no audio-clock endpoint for them, and they would schedule into
a no-op. Tempo/swing are applied from `song.tempo` / `song.swing`, and the raw
values remain in `song.rbsMetadata` (`automation`, `pcfSettings`).

## Practical importer behavior

- Imported RBS automation points are normalized to `0..1`, sorted, quantized (default 16th), and de-duplicated by step.
- PCF target mapping (via the tb303A/tb303B routing options; `bass2` names the
  knobs `cutoff`/`resonance` as `Bass2Params` does):
  - `tb303A` → `<tb303ATarget>.filterCutoff` (default `synthA`)
  - `tb303B` → `<tb303BTarget>.cutoff` (default `bass2`)
  - `drums` → not converted (no endpoint); kept in `song.rbsMetadata.pcfSettings`
- If no automation lanes remain after conversion, `song.automation` is omitted.

## Testing touchpoints

- `src/__tests__/RbsParser.test.ts` validates sample-file parse + parse→convert flow.
- `src/__tests__/RbsImporter.test.ts` validates pattern/automation/PCF conversion behavior.
- `src/__tests__/AutomationScheduler.test.ts` validates TRAK/lane scheduling and Open303 param routing.

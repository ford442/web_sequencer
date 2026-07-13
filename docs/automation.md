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

## Practical importer behavior

- Imported RBS automation points are normalized to `0..1`, sorted, quantized (default 16th), and de-duplicated by step.
- PCF target mapping:
  - `tb303A` → `synthA.filterCutoff`
  - `tb303B` → `synthB.filterCutoff`
  - `drums` → `master.drumPcfModulation`
- If no automation lanes remain after conversion, `song.automation` is omitted.

## Testing touchpoints

- `src/__tests__/RbsParser.test.ts` validates sample-file parse + parse→convert flow.
- `src/__tests__/RbsImporter.test.ts` validates pattern/automation/PCF conversion behavior.
- `src/__tests__/AutomationScheduler.test.ts` validates TRAK/lane scheduling and Open303 param routing.

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

## Offline renders (stems, AI preview, 303 freeze)

Bounces play the same lanes as live playback (#1384). There is one resolver,
`src/audio/automation/laneResolver.ts`, and both sides read through it:

- **Live:** `AutomationScheduler.scheduleFromLanes` schedules
  `resolveLaneValuesAtStep()`; the step handler's per-note overrides use
  `resolveParamAtStep()`.
- **Offline:** `src/audio/offline/offlineLaneAutomation.ts` resolves the lanes
  onto the render's flat step axis with `resolveLaneTimeline()` — global step
  `g` plays pattern step `g % stepCount`, and in song mode pattern-scoped lanes
  follow `measure % 8` — then converts them for each renderer.

The rules: a lane plays when enabled and in scope; it is read at the pattern
step; a value outside `[0, 1]` is rejected in dev and clamped otherwise; the
first lane per `target:parameter` with a value wins the step.

| Renderer | What plays | Units |
|----------|------------|-------|
| `render303FreezeOffline` / `render303Offline*` (open303, jc303, highfid-cpu) | `Offline303PatternData.paramSteps`: cutoff, resonance, decay, envMod, accent, volume, set as each step starts and held | The normalised values the worklet gets live |
| `gpu-highfid` | An automated pattern renders through highfid-cpu: the shader takes one param set per pattern | — |
| Stems + AI preview (`renderSynthPattern`) | Filter cutoff + resonance; decay on 303 voices. 303 voices move the filter on every step of a held note, as the scheduler does; other voices keep the value the note started with, as the per-note override does | 303: `× 8000` Hz / `× 20` (`Open303Manager`'s knob scale); others: `× 20000` Hz / `× 20` (`playSynth`) |

What a renderer cannot play is reported, never dropped: `StemExportReport.automation`
(also in the ZIP's `metadata.json`, and a toast), and `AISongPreviewResult.automation`
(the preview's "Not in this preview" list). Not rendered offline:

- `drive`, `tune`, `abMix`, `slide` on the 303 freeze path — the offline engines
  have no such stage.
- `volume`, `envMod`, `accent`, `drive` on the stem path — the stem renderer
  plays a filtered oscillator with no stage for them (not even the knob value).
- Macro voices' filter lanes.
- **Master PCF lanes.** Live, `AutomationScheduler` routes them to
  `audioEngine.pcfEffect`, but nothing constructs a `PcfEffect`, so live
  playback does not play them either. Offline matches that.
- XM export: instruments are one-shot samples, which cannot carry automation.

Unrouted targets (drums, sampler, `filterMode`, `waveform`, `pitch`, delay) are
out of scope here; see #1387.

## Testing touchpoints

- `src/__tests__/RbsParser.test.ts` validates sample-file parse + parse→convert flow.
- `src/__tests__/RbsImporter.test.ts` validates pattern/automation/PCF conversion behavior.
- `src/__tests__/AutomationScheduler.test.ts` validates TRAK/lane scheduling and Open303 param routing.
- `src/__tests__/laneResolver.test.ts` checks live/offline parity: the fixture lanes resolve to exactly what the scheduler schedules.
- `src/__tests__/offlineAutomation.freeze.test.ts` is the spectral golden: a frozen 303 gets brighter and darker with the cutoff lane on every engine family; a flat render does not move.
- `src/utils/__tests__/offlineAutomation.preview.test.ts` and `stemExport.automation.test.ts` cover the preview and stem paths.

# Module Size Budget — Status

Soft budget: **~700 lines** per module. This note records where the tree actually
stands, because the tracking issue's audit had gone stale and nearly caused a
completed split to be redone.

## The four tracked hot modules — all resolved

| Module | Issue | Audited | Actual | Resolution |
|--------|-------|---------|--------|------------|
| `src/hooks/useAudioEngine.ts` | #1032 | 1072 | **405** | Split already landed; lifecycle/facade separation done. |
| `src/hooks/audioEngine/audioPlayback.ts` | #1031 | 1052 | **27** | Split already landed; now a facade over `audioPlayback/`. |
| `src/hooks/audioEngine/samplerPlayback.ts` | (this issue) | 955 | **deleted** | See below — the split had landed, the old file survived as a dead duplicate. |
| `src/components/__tests__/knobMaterial.contract.test.ts` | #1030 | 1920 | **gone** | Split into `__tests__/knobMaterial/`. |

### The sampler case is worth reading

`samplerPlayback/` already contained the split modules (`playSamplerVoice.ts`,
`samplerControls.ts`, `samplerStretchFx.ts`, `expressiveness.ts`) and
`useAudioEngine.ts` imports from **those**. The 955-line
`samplerPlayback.ts` alongside it exported `createSamplerPlayback`,
`SamplerVoiceContext` and `SamplerNoteParams` — and nothing in the repo imported
any of them.

It was dead code: a full duplicate of logic that already lived, split, in the
directory next to it. Deleting it is the correct "split", and it removes a
genuine hazard — the file was recent enough and plausible enough to read as the
live implementation.

**Lesson for the next hygiene pass:** confirm a hot module is actually reachable
before splitting it. `grep` for its exports, not just its filename.

**Update (2026-08-24):** the 973-line `samplerPlayback.ts` had come back into
the tree — a merge had reintroduced it as a byproduct of an unrelated change,
alongside three more unreachable siblings: `src/audio/playback/synthPlayback.ts`,
`drumPlayback.ts` and `samplerPlayback.ts` (only re-exported from
`src/audio/playback/index.ts`, which nothing imported). All four plus the
now-pointless `index.ts` are deleted again.
`src/hooks/audioEngine/samplerPlayback/__tests__/noDuplicateSamplerEntry.test.ts`
now guards the regression: it asserts the deleted paths stay gone,
`createPlaySamplerVoice` has exactly one definition in `src/`, and
`src/audio/playback/` contains only the live `PlaybackHealthMonitor.ts`.

## Merge artifacts

`scripts/check-root.mjs` now fails on any `*.orig` or `*.rej` in the tree
(skipping `node_modules`, build output and vendored SDKs). It runs as part of
`pnpm lint` and `pnpm check:root`, and `src/__tests__/checkRootHygiene.test.ts`
plants artifacts to prove the gate still bites.

At the time of writing the tree contained **zero** artifacts — the five listed in
the tracking issue had already been removed.

## Size gate

`scripts/check-module-size.mjs` fails CI when a `src/**/*.ts(x)` file exceeds
the 700-line soft budget **and its path is not mentioned anywhere in this
document**. It runs as part of `pnpm lint`. This means:

- Every file already over budget when the gate landed (2026-09-23) had to be
  listed once, below, with a reason — that's the "Modules over budget" table.
  The gate does not re-fail that historical inventory on every run.
- A file that grows past 700 lines without ever being added here fails CI
  immediately. Split it, or add a row with a one-line reason (a real
  exception, a tracked follow-up, or a split plan).
- The check only looks for the path string in this file — it does not parse
  the table format, so a mention anywhere (prose or table) satisfies it.

## Modules over budget (2026-09-23 audit)

| Lines | Module | Status |
|-------|--------|--------|
| 1004 | `src/utils/engineTelemetry.ts` | un-triaged |
| 991 | `src/components/KnobGPUContext.ts` | un-triaged — behavioural, see "Two shapes" below |
| 917 | `src/components/PhonemePainter.tsx` | un-triaged |
| 901 | `src/engines/rubberband/experimental/HybridNeuralPipeline.ts` | **quarantined** (2026-09-23) — see below; not barrel-exported, nothing in the app constructs it |
| 874 | `src/hooks/useAppState.tsx` | mega-hook; phase 1 (`uiModalsStore`) landed in #1259, phase 2 (transport/mix) in this PR, phases 3–6 remain (see file header) |
| 865 | `src/audio-worklets/rubberband-processor.ts` | already split once (09-07); further split not attempted here |
| 848 | `src/components/appParts/RackNode.tsx` | justified exception — see split plan below |
| 817 | `src/components/SamplerVoicePanel.tsx` | justified exception — see split plan below |
| 814 | `src/engines/Open303Manager.ts` | un-triaged |
| 811 | `src/utils/xmExport.ts` | un-triaged |
| 794 | `src/importers/rbs/types.ts` | flat type/declaration file — low priority, see "Two shapes" below |
| 792 | `src/engines/rubberband/performance/PerformanceOptimizer.ts` | un-triaged |
| 789 | `src/importers/ai-song/AISongImporter.ts` | un-triaged — behavioural, see "Two shapes" below |
| 770 | `src/hooks/useSongStorage.ts` | justified exception — see split plan below |
| 762 | `src/__tests__/AutomationScheduler.test.ts` | test file, un-triaged |
| 746 | `src/hooks/useStepHandler.ts` | un-triaged |
| 741 | `src/__tests__/wasmMigration.test.ts` | test file, un-triaged |
| 721 | `src/components/WaveformDisplay.tsx` | un-triaged |
| 720 | `src/engines/rubberband/FormantShifter.ts` | un-triaged |

`src/types.ts` is **resolved**: it was 990 lines and is now a 17-line
re-export barrel (`export * from './types/synth'` etc. — see below). It no
longer appears in this table.

### `src/types.ts` split (2026-09-23)

Split into `src/types/{synth,drums,sampler,pattern,automation,engine,song}.ts`
along the domains the tracking issue named. `src/types.ts` is now `export *`
only, so every pre-existing `from '../types'` import keeps working.
`OSCILLATOR_THEMES`, `OSCILLATOR_PANEL_IMAGES`, `waveformToOscillatorType` and
friends were UI helpers, not domain types — they moved to
`src/components/oscillatorThemes.ts` next to `WaveformSelector.tsx`; the three
callers (`OscillatorTypeSelector.tsx`, `OscillatorVariantSelector.tsx`,
`useHardwarePanels.tsx`) now import them from there instead.

### `HybridNeuralPipeline` quarantine (2026-09-23)

901 lines, Section 6 of `RUBBERBAND_ENHANCEMENT_PLAN.md` (neural vocoding).
`grep` for `HybridNeuralPipeline(` outside its own file and test turned up
nothing — no app code constructs it — and nothing imports the
`engines/rubberband` barrel except the barrel's own re-exports, so it wasn't
reachable from the app either way. Its `onnxruntime-web` import is already
`import type` only (fixed by #1293, prior to this pass — the static-import
claim in earlier audits was stale), so it wasn't contributing to the ORT
bundle graph, but the file itself is still a large, unreachable module: the
same shape as the sampler-playback and `LatencyCompensator` shadow-stack
cases above. Moved to `src/engines/rubberband/experimental/` (with its spec)
and dropped from the barrel's `export *` list, rather than deleted — Section 6
is real design work reserved for the neural-vocoder epic gated on #1257, not
abandoned duplicate code. Import it directly from that path if picking that
epic back up; don't re-add it to the barrel until something outside its own
tests wires it in.

### Split plans for the remaining justified exceptions

Not split in this pass — each is a complex, actively-used UI/data module
where a blind split risks the same "diverged shadow copy" hazard documented
above, and the project's own guidance is to verify UI changes in a running
browser before landing them. Recorded here as a plan for a focused follow-up:

- **`src/components/appParts/RackNode.tsx` (848 lines):** renders the full
  instrument rack (synth/bass2/drums/sampler panels + wiring). Split along its
  per-instrument panel sections (already visually distinct blocks) into
  `RackNode/SynthPanelSection.tsx`, `RackNode/DrumsPanelSection.tsx`,
  `RackNode/SamplerPanelSection.tsx`, leaving `RackNode.tsx` as the layout
  shell that wires them together (the `HardwareModule.tsx` split above is the
  template: memoized presentational piece out, shared-ref interaction hook
  out, shell stays thin).
- **`src/components/SamplerVoicePanel.tsx` (817 lines):** one panel covering
  pitch/voice, envelope, LFO/modulation and effects-send controls for a
  sampler voice. Split by control group into `SamplerVoicePanel/PitchSection.tsx`,
  `EnvelopeSection.tsx`, `ModulationSection.tsx`, `EffectsSection.tsx`, each
  taking the voice params slice and setter it needs; `SamplerVoicePanel.tsx`
  keeps the tab/accordion shell.
- **`src/hooks/useSongStorage.ts` (770 lines):** one hook covering save,
  load, import (legacy schema migration) and export. Split along those seams
  into `useSongStorage/{save,load,migrate,export}.ts`, each a plain function
  taking the state it needs rather than a hook, with `useSongStorage.ts` left
  as the thin hook that wires them to component state.

**`LatencyCompensator.ts` (was 1005 lines, deleted 2026-08-24):** a second,
unwired MIDI/timing system (`NoteScheduler`, `LatencyCompensator`,
`BpmTimingCalculator`, `MidiClockGenerator`) from the RUBBERBAND_ENHANCEMENT_PLAN
Section 9 stub set. Nothing outside its own 936-line test and the
`engines/rubberband` barrel referenced it, and the barrel itself has no
importers — the live MIDI/worklet clock (`TransportClockController` and
friends in `src/midi/clock/`) already owns this responsibility. Deleted rather
than wired in: keeping two timing systems, one live and one dead, is the same
shadow-stack hazard as the sampler-playback duplicate above.

### `MainSequencer.tsx` split (2026-08-24): a third shadow-stack hazard

Splitting the 964-line `MainSequencer.tsx` turned up another abandoned split
attempt sitting in `src/components/sequencer/`: `Sequencer.tsx`,
`SequencerRow.tsx` and `SvgStep.tsx` existed there already, but nothing
outside the folder imported `Sequencer.tsx` (the would-be entry point), and
they had badly diverged from the live inline versions in `MainSequencer.tsx`
— no bass2 track, no keyboard grid navigation, no phoneme labels, no zoom,
and (worse) their own `SvgStep` never wrote into the shared `refsArray`, so
the "is-current" playhead highlight silently would not have worked. Building
the real split on top of them would have reintroduced missing features
instead of removing duplication — the same class of hazard as the
sampler-playback and `LatencyCompensator` cases above. `sequencer/constants.ts`
had the same problem: its `TRACK_COLORS`/`ROWS` were live imports but stale
(missing bass2), while its `SEQUENCER_STYLES`/`getPatternColor` were unused
dead exports shadowed by better copies inline in `MainSequencer.tsx`.

Resolution: deleted the three stale files, updated `constants.ts`'s
`TRACK_COLORS`/`ROWS`/`SEQUENCER_STYLES` to match the current live behaviour,
and did a fresh extraction from the working inline code into
`sequencer/AutomationStep.tsx`, `SvgStep.tsx`, `SequencerRow.tsx` and
`SequencerRowWrapper.tsx`. `MainSequencer.tsx` now re-exports `ROWS`,
`AutomationStep` and the `SequencerRowHandle` type for its existing external
consumers (`Rack.tsx`, `AutomationStepA11y.test.tsx`) and is **315 lines**.
`sequencer/__tests__/noStaleSequencerSplit.test.ts` guards the regression.

### `HardwareModule.tsx` split (2026-08-24)

904 lines, no prior split attempt (unlike the two cases above — nothing stale
to clean up here). Split along its actual seams: `KnobOverlay` (the
memoized per-knob label/badge/a11y-slider overlay — pure presentational,
194 lines) moved to `KnobOverlay.tsx`; the native pointer/wheel/touch
interaction wiring, GPU/2D canvas render sync, and drag-HUD plumbing (five
`useEffect`s plus their helper callbacks, ~450 lines, all closing over the
same dozen refs) moved to `useHardwareModuleKnobRack.ts` as a single-purpose
hook with exactly one caller. `HardwareModule.tsx` itself is now **269
lines** — the props/config types, the automation context-menu state, and
the render tree that wires the extracted pieces together.

Two shapes worth distinguishing before splitting any of them:

- **Type/declaration files** (`src/importers/rbs/types.ts`) are long but flat.
  Length there costs little; splitting them churns imports across the repo
  for no real reviewability gain. Treat as low priority. (`src/types.ts` used
  to be in this bucket too — it was split anyway, per an explicit ask on the
  tracking issue, since it also held non-type UI helper tables that didn't
  belong in a types file regardless of length. `importers/rbs/types.ts` has
  no such mix, so it stays flat.)
- **Behavioural modules** (`AISongImporter`, `KnobGPUContext`) are where length
  actually hurts, and where a split pays for its merge risk.

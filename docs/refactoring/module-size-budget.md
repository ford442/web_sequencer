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

## Merge artifacts

`scripts/check-root.mjs` now fails on any `*.orig` or `*.rej` in the tree
(skipping `node_modules`, build output and vendored SDKs). It runs as part of
`pnpm lint` and `pnpm check:root`, and `src/__tests__/checkRootHygiene.test.ts`
plants artifacts to prove the gate still bites.

At the time of writing the tree contained **zero** artifacts — the five listed in
the tracking issue had already been removed.

## Modules still over budget (not in scope here)

These were not part of the tracked set and are **not** justified exceptions —
they are simply un-triaged. Recorded so the next pass starts from facts:

| Lines | Module |
|-------|--------|
| 1001 | `src/engines/rubberband/LatencyCompensator.ts` |
| 964 | `src/components/MainSequencer.tsx` |
| 960 | `src/importers/ai-song/AISongImporter.ts` |
| 959 | `src/components/KnobGPUContext.ts` |
| 936 | `src/engines/rubberband/__tests__/LatencyCompensator.test.ts` |
| 904 | `src/components/HardwareModule.tsx` |
| 892 | `src/types.ts` |
| 885 | `src/engines/rubberband/HybridNeuralPipeline.ts` |
| 855 | `src/audio-worklets/open303-processor.ts` |
| 853 | `src/components/PhonemePainter.tsx` |
| 841 | `src/components/appParts/RackNode.tsx` |
| 817 | `src/components/SamplerVoicePanel.tsx` |
| 803 | `src/importers/rbs/types.ts` |
| 792 | `src/engines/rubberband/performance/PerformanceOptimizer.ts` |
| 768 | `src/engines/rubberband/FormantShifter.ts` |
| 759 | `src/engines/Open303Manager.ts` |
| 756 | `src/utils/xmExport.ts` |
| 745 | `src/utils/engineTelemetry.ts` |
| 741 | `src/__tests__/wasmMigration.test.ts` |
| 710 | `src/components/WaveformDisplay.tsx` |
| 709 | `src/hooks/useAppState.tsx` |
| 702 | `src/hooks/useSongStorage.ts` |

Two shapes worth distinguishing before splitting any of them:

- **Type/declaration files** (`src/types.ts`, `src/importers/rbs/types.ts`) are
  long but flat. Length there costs little; splitting them churns imports across
  the repo for no real reviewability gain. Treat as low priority.
- **Behavioural modules** (`LatencyCompensator`, `MainSequencer`,
  `AISongImporter`, `KnobGPUContext`) are where length actually hurts, and where
  a split pays for its merge risk.

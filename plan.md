1. **Define Tuning Logic**:
   Modify `src/utils/musicTheory.ts` to include `TuningSystem` and `getTunedFrequency`.
   ```typescript
   export type TuningSystem = '12-TET' | '24-TET' | 'Just Intonation' | 'Pythagorean' | 'Bohlen-Pierce';
   export const TUNING_SYSTEMS: TuningSystem[] = ['12-TET', '24-TET', 'Just Intonation', 'Pythagorean', 'Bohlen-Pierce'];
   ```

2. **UI Update**:
   Modify `src/components/ScaleSelector.tsx` to include the `TuningSystem` dropdown. This makes it a globally accessible setting via the `currentScale` context.
   ```typescript
   export interface ScaleDefinition {
       root: string;
       scale: string;
       tuningSystem?: TuningSystem; // NEW
   }
   ```

3. **Pass Tuning Information**:
   - `src/types.ts`: Add `tuningSystem?: TuningSystem` and `rootNote?: string` to the `noteParams` object definitions in `AudioEngine` methods (`playSynth`, `playSampler`).
   - `src/hooks/useStepHandler.ts`: Ensure `currentScale` is passed to the `playSynth` / `playSampler` methods in `noteParams`.

4. **Apply Tuning in Synthesizers**:
   - Instead of using `noteToFrequency` in audio managers, we replace it with `getTunedFrequency(note, tuningSystem, rootNote)`.
   - Update `src/hooks/useStepHandler.ts`: Use `getTunedFrequency` to calculate `currentBaseFreq` around line 139 for last frequency tracking.
   - Update `src/engines/VoiceManager.ts`: Use `getTunedFrequency` when computing `freq`.
   - Update `src/audio/playback/synthPlayback.ts`: Use `getTunedFrequency` when computing `freq`.
   - Update `src/audio/playback/samplerPlayback.ts`: Modify playbackRate calculation to use direct frequency ratios. Target frequency via `getTunedFrequency`, base frequency using '12-TET' 'C4' (note 60) for the sample root, `playbackRate = targetFrequency / sampleBaseFrequency`.
   - **For Open303 (WASM)**: Keep it simple and force it to use '12-TET'. No pitch-bending for WASM unless strictly necessary.
   - Update `src/utils/renderAudio.ts` and `src/workers/renderer.worker.ts`: Replace internal `noteToFrequency` with full tuning logic or use the `getTunedFrequency` logic.
   - Make sure `currentScale` is persisted inside saved project structures, though it seems it's currently managed by `useAppState` so we'll check if `currentScale` needs to be added to `SavedSongData` in `types.ts` and `useSongStorage`.

5. **Verify**:
   - Run `git diff` to review and verify the modifications made.
   - Check where frequencies are computed and ensure the new logic is applied correctly to all the synthesizers.

6. **Test**:
   - Address the test failures related to `vite:import-analysis` (WASM imports). These are known environment issues but I will check if they impact the tests for this feature.
   - Run `pnpm test` to ensure tests pass.

7. **Pre Commit**:
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.

8. **Submit**:
   - Commit the changes and submit the branch.

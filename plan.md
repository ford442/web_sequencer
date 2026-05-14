1. **Create Vocal Overdrive Worklet**
   - Create a new AudioWorkletProcessor in `src/audio-worklets/vocal-overdrive-processor.ts`.
   - Implement nonlinear tube distortion directly inside the `process` loop. A simple formula like `Math.tanh(input * drive) / Math.tanh(drive)` or foldback distortion.
   - Expose `drive` and `tone` (simple lowpass filter) parameters.
2. **Register the Worklet**
   - Add the worklet to Vite build via `?worker&url` in `src/hooks/audioEngine/initialization.ts`.
   - Wait for `audioContext.audioWorklet.addModule()` to load it during initialization.
3. **Integrate into `useAudioEngine.ts`**
   - We will replace the standard Web Audio API `WaveShaperNode` used for `drive` on voices in `useAudioEngine.ts` with our custom `AudioWorkletNode('vocal-overdrive-processor')`!
   - Ensure the new node handles the `driveAmount` parameter. The tone parameter can be fixed or exposed globally.
4. **Update `agent_plan.md`**
   - Check off the "Vocal Overdrive Worklet" idea.
   - Add progress entry to the top of the Changelog.
5. **Pre-commit checks**
   - Run type checks and tests.

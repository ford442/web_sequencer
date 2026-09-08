1. **Update `RubberBandProcessor` parameter descriptors**
   - Add `{ name: 'autoTune', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0 }` to `parameterDescriptors` in `src/audio-worklets/rubberband-processor.ts`.
2. **Implement Zero-Crossing Pitch Detection and Correction**
   - In `RubberBandProcessor.ts`, add state variables for pitch tracking: `autoTuneLastSign`, `autoTuneSamplesSinceZero`, `autoTunePeriod`, `autoTuneSmoothedPeriod`.
   - Before setting `this.rubberBand.setPitchScale(finalPitch)` in `process()`, read the `autoTune` parameter.
   - If `autoTune > 0`, calculate a correction factor based on `autoTuneSmoothedPeriod`. We apply the pitch detection on the input grain signal (before RubberBand stretching) to find the source pitch. Or we detect it on the output. Measuring the output of RubberBand causes a feedback loop if we then adjust RubberBand's pitch based on it.
   - Wait, if we measure the pitch of the *input* buffer (during the FREEZE stream loop) or the *forward* stream, we can calculate the current unshifted pitch. Then we adjust `finalPitch` by the required correction ratio.
   - For a vocal sample, the pitch might be fluctuating.
   - Zero-crossing detection logic: Loop through `samplesToFeed` (the input slice) or the retrieved `outputView`. A simple zero-crossing detector on the `outputChannel` might be better. Let's do it on the `outputChannel` *after* retrieval, and apply the correction factor to the *next* block's `finalPitch`! This creates a 1-block delay but avoids complex lookahead.
   - In `process()`, loop through `outputChannel`. Track positive zero crossings to find period. `smoothedPeriod = smoothedPeriod * 0.9 + newPeriod * 0.1`.
   - Next block: `freq = sampleRate / smoothedPeriod`. Find nearest semitone. `correction = nearest_freq / freq`. `finalPitch *= (1.0 - autoTune) + autoTune * correction`.
3. **Wire up UI and Types**
   - Add `autoTune` to `src/types.ts` (`SynthParams` & `EffectsContextValue`, `NoteProperties`).
   - Add `autoTune: (v: number) => void;` to `useSamplerPanelState.ts` and `EffectsSendProperties.tsx`.
   - Add `<Knob label="AutoTune" value={currentParams.autoTune || 0} onChange={handlers.autoTune} min={0} max={1.0} step={0.01} color="indigo" unit="%" />` to `SamplerKnobControls.tsx`.
   - Update `playSamplerVoice.ts` to pass `autoTune` to `SingingVoiceHost`.
   - Update `effectsControl.ts` in `SingingVoice` to export `setAutoTune`.
4. **Architecture Review & Plan Update**
   - Complete pre-commit steps.
   - Submit the change and update `agent_plan.md` moving the task from Innovation Lab to active and marking it complete.

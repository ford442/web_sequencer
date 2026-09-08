Plan: Evaluate real-time pitch correction (Auto-Tune style) in the granular playback chain using zero-crossing detection.
1. Add `autoTune` parameter to `RubberBandProcessor` (0.0 to 1.0 depth).
2. Wire up `autoTune` in `src/types.ts` (Sampler voice params).
3. Wire up UI controls for `autoTune` in `SamplerKnobControls.tsx` (or `SynthGranularEffects.tsx`) and `EffectsSendProperties.tsx`. Include it in `useSamplerPanelState`, `playSamplerVoice`, and `effectsControl.ts`.
4. In `RubberBandProcessor.process()`, implement zero-crossing based pitch detection. We need to measure the frequency of the generated signal.
Wait, if it's Auto-Tune for TTS, the zero-crossing should probably be applied to the output of the grains BEFORE RubberBand so we can pass the corrected pitch multiplier to RubberBand. Or, even simpler, measure the zero crossings of the output signal (which is already pitch-shifted/time-stretched) and apply a dynamic pitch shift by modulating the pitch parameter sent to RubberBand? If we measure output, we have a feedback loop.
Better: Measure the pitch in the phoneme or output. RubberBand allows dynamic pitch shifting.
Wait! The task specifically says "Evaluate real-time pitch correction (Auto-Tune style) in the granular playback chain using zero-crossing detection."
If we measure the pitch of the *output*, we can detect its frequency.
Let's implement a zero-crossing detector on the granular output stream (or the final output) to detect the current frequency.
Wait, to pitch correct, we need to apply a shift. If we use RubberBand, we can just modulate its `pitchScale`.
But wait! RubberBand processes blocks. We can just detect the pitch of the `outputChannel` in the `RubberBandProcessor`.
Zero-crossing detection: Count samples between zero crossings. Frequency = SampleRate / (2 * samples_between_crossings).
Quantize this frequency to the nearest semitone frequency.
Calculate ratio = TargetFreq / DetectedFreq.
Wait, if we apply this ratio to the *next* block's RubberBand pitch, it might flutter or be unstable.
Let's look at how Auto-Tune works: it shifts the pitch to the nearest note.
Instead of modulating RubberBand, what if we just use a delay line in the output loop to do a granular pitch shift?
No, RubberBand *is* the pitch shifter. We can just adjust the pitch scale passed to RubberBand:
```
  // If autoTune > 0, calculate a pitch scale correction based on zero-crossing detection of the PREVIOUS block's output
```
Actually, let's implement the AutoTune inside `process` at the output stage, or right before.
Let's read the task again carefully:
"Evaluate real-time pitch correction (Auto-Tune style) in the granular playback chain using zero-crossing detection."

Zero-crossing detection for pitch tracking:
Maintain `lastSign`. When sign changes, check if it's a positive edge. If so, calculate the period (samples since last positive edge).
Smooth the period over a few cycles.
Freq = fs / period.
Nearest MIDI note = 12 * Math.log2(Freq / 440) + 69;
Target Freq = 440 * Math.pow(2, (Math.round(Nearest MIDI note) - 69) / 12);
Correction Ratio = Target Freq / Freq.

Apply correction ratio to RubberBand pitch scale!

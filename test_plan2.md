To implement Vocal Formant Envelope:
1. Add parameters to `types.ts`:
   - `formantEnvAttack` (default 0.1)
   - `formantEnvDecay` (default 0.5)
   - `formantEnvAmount` (default 0) (can be positive or negative shift amount)
   Add to `Note` and `SamplerBankParams`.

2. Update `FormantShifter.ts`:
   - Add a method to trigger the envelope: `triggerEnvelope(amount: number, attack: number, decay: number, time: number)`.
   - Modulating formants: currently, `formantShift` works by adding shift to filters, `formantLfo` uses an LFO hooked to `detune`. We can simply add another `GainNode` fed by a constant source to modulate `detune` for the envelope, or directly schedule `detune.linearRampToValueAtTime` on the peaking filters.
   Wait, if we use `linearRampToValueAtTime` on `detune` of the `filterNodes`, it will conflict with other things? No, `detune` is an AudioParam. We can schedule values on it. But `detune` is already modulated by the `lfoGain`. That's fine, AudioParams add up their inputs and intrinsic values.
   So we can just use `setValueAtTime`, `linearRampToValueAtTime`, `exponentialRampToValueAtTime` on `filter.detune`.
   Wait, `detune` value affects the frequency. 100 cents = 1 semitone.
   If `amount` is in semitones (e.g., up to 24 semitones), `amount * 100` cents.

3. Update `SingingVoice.ts`:
   - Call `formantShifter.triggerEnvelope` during `triggerSlice`.

4. Update `SamplerPanel.tsx` & `NoteSelector.tsx`:
   - UI controls for `Fmt Env Attack`, `Fmt Env Decay`, `Fmt Env Amount`.

5. Update `useAudioEngine.ts` & `App.tsx`:
   - Plumb properties through.

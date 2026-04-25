# Plan for Vocal Formant Envelope Implementation

1. **Update `types.ts`:**
   - In `SamplerBankParams` (line ~117), add:
     - `formantEnvAttack?: number; // Formant Envelope Attack time in seconds`
     - `formantEnvDecay?: number; // Formant Envelope Decay time in seconds`
     - `formantEnvAmount?: number; // Formant Envelope Amount (semitones shift, -24 to +24)`

   - In `Note` interface (line ~170), add:
     - `formantEnvAttack?: number;`
     - `formantEnvDecay?: number;`
     - `formantEnvAmount?: number;`

2. **Update `FormantShifter.ts`:**
   - Add a method to trigger the envelope:
     ```typescript
     triggerEnvelope(amount: number, attack: number, decay: number, triggerTime: number): void {
         if (this.filterNodes.length === 0) return;
         if (amount === 0) return;

         // We want to temporarily modulate the 'detune' AudioParam of the filter nodes
         // based on an AD (Attack-Decay) envelope on top of any existing value
         // However, detune is already used by LFO (via this.lfoGain)
         // AudioParams automatically sum multiple inputs and their inherent value.
         // We can schedule values on the param itself, BUT we don't want to mess up
         // manual base `detune` values or the `updateFilterChain` frequencies.
         // Actually, `updateFilterChain` changes the `frequency` param, not `detune`.
         // Let's check `createFilterChain`:
         // `filter.frequency.value = targetFreq`
         // `lfoGain.connect(filters[i].detune)`
         // This means `detune.value` is intrinsically 0, and LFO modulates it.
         // We can safely use `linearRampToValueAtTime` on `detune` param.
         // However, doing this overrides any automation applied to `detune.value`?
         // We're not automating `detune.value` elsewhere (it's 0), we automate `frequency`.
         // Wait, let's create a dedicated envelope `GainNode` connected to `detune` just like `lfoGain`.
         // This is cleaner: a constant source -> GainNode (envelope) -> filter.detune
     ```
   - Actually, a simple constant source `AudioBufferSourceNode` or `ConstantSourceNode` connected to a `GainNode`, which connects to `filter.detune`. We can automate the `gain` of this node!
   - Wait, `ConstantSourceNode` is standard.

3. **Update `SingingVoice.ts`:**
   - In `triggerSlice`, grab `formantEnvAttack`, `formantEnvDecay`, `formantEnvAmount` from `params` (global) or `overrides` (per step).
   - If they exist and `formantEnvAmount !== 0`, call `this.formantShifter.triggerEnvelope(...)`.
   - Update `setFormantEnvelope(...)` in `SingingVoice` so it can be updated real-time or triggered per step.

4. **Update `SamplerPanel.tsx`:**
   - Add knobs/sliders for `Fmt Attack`, `Fmt Decay`, `Fmt Amount` inside the formant UI section (near Formant Shift, Fmt LFO, etc.).
   - Add them to state and `paramHandlers`.

5. **Update `NoteSelector.tsx`:**
   - Add sliders for step-sequenced overrides of these parameters.

6. **Update `useAudioEngine.ts` and `App.tsx`:**
   - Plumb properties through `NoteSelector` into `noteParams`.
   - Apply them in `playSamplerVoice`.

Let's check `FormantShifter.ts` code again to see how we should implement the envelope safely.

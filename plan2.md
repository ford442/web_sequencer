1. **Types (`src/types.ts`)**:
   Add to `SamplerBankParams` and `Note` interface:
   - `formantEnvAttack?: number;`
   - `formantEnvDecay?: number;`
   - `formantEnvAmount?: number;`

2. **FormantShifter.ts (`src/engines/rubberband/FormantShifter.ts`)**:
   - We need an envelope node similar to LFO but triggered.
   - Let's add:
     - `private envNode: ConstantSourceNode | null = null;`
     - `private envGain: GainNode | null = null;`
   - Update `createFilterChain`:
     - Create `this.envNode = this.audioContext.createConstantSource();`
     - Create `this.envGain = this.audioContext.createGain();`
     - `this.envGain.gain.value = 0;` // Idle state
     - `this.envNode.connect(this.envGain);`
     - Connect `this.envGain` to `filters[i].detune` for boosting filters.
     - `this.envNode.start();`
   - Update `disconnect`: clean up `envNode` and `envGain`.
   - Add method:
     ```typescript
     triggerEnvelope(amount: number, attack: number, decay: number, triggerTime: number): void {
         if (!this.envGain) return;

         const t = triggerTime || this.audioContext.currentTime;
         const gainParam = this.envGain.gain;

         gainParam.cancelScheduledValues(t);
         gainParam.setValueAtTime(0, t);

         // amount is in semitones (-24 to 24)
         const peakGain = amount * 100; // cents

         if (attack > 0) {
             gainParam.linearRampToValueAtTime(peakGain, t + attack);
         } else {
             gainParam.setValueAtTime(peakGain, t);
         }

         if (decay > 0) {
             gainParam.linearRampToValueAtTime(0, t + attack + decay);
         } else {
             gainParam.setValueAtTime(0, t + attack);
         }
     }
     ```

3. **SingingVoice.ts (`src/engines/SingingVoice.ts`)**:
   - Add properties for formant envelope:
     ```typescript
     setFormantEnvelope(amount: number, attack: number, decay: number, triggerTime: number) {
         if (this.formantShifter) {
             this.formantShifter.triggerEnvelope(amount, attack, decay, triggerTime);
         }
     }
     ```
   - Call it in `triggerSlice` (using step overrides or global params).

4. **Hooks / UI Plumbing**:
   - `useAudioEngine.ts` (pass step overrides to `SingingVoice` and params).
   - `SamplerPanel.tsx`: add three knobs (Fmt Env Attack, Fmt Env Decay, Fmt Env Amount). Add defaults to `DEFAULT_SAMPLER_BANK_PARAMS`.
   - `NoteSelector.tsx`: add step property inputs for the three.

This plan hits everything cleanly.

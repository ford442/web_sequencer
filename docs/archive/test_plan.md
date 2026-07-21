1. **Analyze Requirements:**
   - Goal: Add a "Vocal Formant Envelope" specifically for formants.
   - Purpose: Create plucky or sweeping vocal filter effects on every note by modifying the formant shifting over time (Attack/Decay).
   - Task mentioned in `agent_plan.md` (removed; see git history):
     `[ ] **Vocal Formant Envelope:** Add a dedicated Attack/Decay envelope specifically for formants to create plucky or sweeping vocal filter effects on every note.`
   - Need to add properties to control Formant Envelope (e.g. Formant Attack, Formant Decay, Formant Envelope Amount).

2. **Check Current Formant Control:**
   - `FormantShifter.ts` handles formant shifting using a chain of Biquad filters.
   - Currently, it sets static shift values, or linear ramps (`updateFilterChain`), or LFO (`lfo`, `lfoGain`).
   - We need an envelope to modulate `f1Shift`, `f2Shift`, `f3Shift` or simply the `detune` / `frequency` of the peaking filters over time, triggered on Note On.

3. **Where to implement Formant Envelope?**
   - The formant filters are standard `BiquadFilterNode` created in `FormantShifter.ts`.
   - In `SingingVoice.ts`, we trigger note on. When a note is triggered, we can schedule an envelope on the Formant Filters' `detune` or `frequency` parameters, similar to how an amplitude or filter envelope works.
   - To do this, we need `formantEnvAttack`, `formantEnvDecay`, `formantEnvAmount` properties.
   - Let's add these to `Note` parameters (if it's per-step) or global sampler params. Wait, the backlog says "Add a dedicated Attack/Decay envelope specifically for formants to create plucky or sweeping vocal filter effects on every note."
   - We should add global controls for Formant Envelope to `SamplerBankParams` or similar, and map them in `SamplerPanel.tsx` UI. We might also want per-step overrides.

4. **Investigate Data Structures (`types.ts`):**

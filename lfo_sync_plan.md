# Updated Plan: LFO Rate Sync to Tempo

1. **Update Types (`src/types.ts`)**:
   - Add `freezeLfoSync?: boolean` and `formantLfoSync?: boolean` to `SamplerBankParams` and `Note`.
   - Ensure the types support passing these through. Note that `freezeLfoRate` and `formantLfoRate` will now represent a subdivision (like `0.25` for a sixteenth note) when sync is true.

2. **Update Audio Engine (`src/hooks/useAudioEngine.ts`)**:
   - `playSamplerVoice` (and `playSampler`) already receives `stepTime` (which is `60 / tempo / 4` representing a 16th note in seconds). We can calculate the tempo or directly calculate the Hz!
   - If `stepTime` is the duration of a 16th note, then 1 beat (quarter note) is `stepTime * 4`.
   - Tempo (BPM) = `60 / (stepTime * 4)`.
   - If `LfoRate` represents subdivision where `1` = 1 bar (4 beats), `0.25` = 1 beat (quarter note), `0.125` = eighth note.
     - Oh wait, the convention usually is: `1` = 1 bar, `1/2` = half note, `1/4` = quarter note.
     - We can use strings for subdivisions like `"1/4"`, `"1/8"` or just keep it as numbers: `1/4 = 0.25`, etc.
   - Or, we can just pass the calculated Hz. `Hz = (tempo / 60) * (1 / subdivision)`
     - Example: 120 BPM. 1 beat = 0.5s. Quarter note Hz = 2 Hz.
     - If subdivision is `1/4` (Quarter note): `(120 / 60) * (1 / 0.25)` -> `2 * 4 = 8 Hz`?
     - Let's clarify: if subdivision is `1` (whole note / 1 bar), at 120 BPM (4 beats per sec), duration is 2.0s. Hz = `1 / 2.0 = 0.5 Hz`.
     - So `Hz = (tempo / 60) / (subdivision_in_beats)`. Or better: `Hz = 1 / (stepTime * 16 * subdivision)`. Let's use `Hz = tempo / 60 / (4 * subdivision)` where subdivision is `1` for a whole note.
   - Let's convert in `playSamplerVoice`:
     ```typescript
     const tempo = 60 / (stepTime * 4);

     // For Formant
     const formantSync = noteParams?.formantLfoSync ?? params.formantLfoSync ?? false;
     let fRate = noteParams?.formantLfoRate ?? params.formantLfoRate ?? 0;
     if (formantSync && fRate > 0) {
         // Assuming fRate is subdivision where 1 = whole note (1 bar)
         // Hz = (tempo / 60) / (4 * fRate)  -- wait, if fRate=0.25 (quarter), then Hz = (120/60) / (4 * 0.25) = 2 / 1 = 2 Hz. Correct!
         fRate = (tempo / 60) / (4 * fRate);
     }
     voice.setFormantLfoRate(fRate, triggerTime);
     ```

3. **Update UI - `SamplerPanel` (`src/components/SamplerPanel.tsx`)**:
   - Add toggles (`<button role="switch">`) for `freezeLfoSync` and `formantLfoSync`.
   - When sync is `true`, change the `Knob` to a Dropdown (or a modified `Knob`) to select subdivisions:
     Options: "2 bars" (2), "1 bar" (1), "1/2" (0.5), "1/4" (0.25), "1/8" (0.125), "1/16" (0.0625).
     Actually, a `<select>` drop-down is perfect for this.

4. **Update UI - `NoteSelector` (`src/components/NoteSelector.tsx`)**:
   - Add the same sync toggles and `<select>` drop-downs for per-step overrides.

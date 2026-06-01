# Web Sequencer: Living Roadmap

**Mission:** Build the ultimate browser-based DAW, fusing classic MIDI workflow (Cubase-style) with next-generation AI Vocal Synthesis (TTS Sampling).

**Current Velocity:** 1 Feature per Run
**Architectural Focus:** Polyphony & Vocal Granularity

---

## 🚀 Active Backlog (Prioritized)

### Domain A: Audio Engine (Synth & Sampler)
- [x] **Step-Sequenced Bitcrusher / Decimator:** Add per-step bit reduction and downsampling to `rubberband-processor.ts` for rhythmically evolving lo-fi crunch textures on TTS vocals.
- [ ] **Time-Stretch Envelope:** Use an ADSR envelope to dynamically modulate the `timeRatio` of the granular engine, allowing vocals to rhythmically slow down or speed up over a single step.
- [x] **Refactor SingingVoice State:** Expose alignment state setters in `SingingVoice` to avoid type casting hacks and improve multi-bank alignment handling.
- [x] **TTS Slice Triggering:** Implement a logic where a MIDI Note NoteOn event can trigger a specific *slice* or *word* from the TTS buffer (e.g., Note C3 = "Hello", Note D3 = "World").
- [x] **Hybrid Polyphony:** Finalize `VoiceManager` to handle 8-voice polyphony for `synth-1` while keeping `synth-2` strictly monophonic (legato priority).
- [x] **Phoneme Elasticity:** Connect `rubberband.wasm` to the sequencer steps. If a note is dragged longer, the specific phoneme should time-stretch to match the duration without altering pitch.
- [x] **Polyphonic Singing:** Implement `SingingVoiceManager` to allow polyphonic playback (chords) for the TTS engine, supporting multiple simultaneous phoneme streams.

### Domain B: Editor Workflow (The "Cubase" Feel)
- [x] **Per-Step Delay Send:** Allow sequence steps to override the global delay send amount.
- [x] **Step-Sequenced Vibrato:** Allow individual sequencer steps to override the global Vibrato Depth, enabling natural vocal phrasing without affecting short rhythmic syllables.
- [x] **Vocal Envelope Shaper:** Upgraded the `ExpressiveVoiceProcessor` to use a full ADSR (Attack, Decay, Sustain, Release) envelope, exposing Decay and Sustain knobs to the `SamplerPanel` to allow granular shaping of TTS syllables into sharp plucks or smooth pads.
- [x] **Dynamic Tremolo (AM) Effect:** Expose the Tremolo effect from `ExpressiveVoiceProcessor` to the UI (Rate and Depth knobs) and map it to `SingingVoice` and `SamplerPanel` to make TTS playback more rhythmic.
- [x] **Per-Step Freeze Amount:** Implemented `freeze` parameter in `NoteSelector` and mapped it through `useAudioEngine` to `SingingVoice` to allow for rhythmic, per-step granular stutters and smears.
- [x] **Step-Sequenced Formant Shifts:** Allow users to pitch shift the formants of the TTS engine independently of the fundamental frequency per step.
- [x] **Text-to-Drumkit:** Implement logic to generate drum kit sequences by mapping short transient consonants to hats/snares and vowels to kicks based on TTS phrases.
- [x] **Dynamic Phoneme Pitch Glide:** Implemented pitch slide logic in `SingingVoice.ts`, `useAudioEngine.ts` and `App.tsx` to glide TTS pitch naturally when a step has slide enabled.
- [x] **Slice Mode UI:** Add a toggle in `SamplerPanel` to enable "Phoneme Slice Mode", allowing users to play slices via MIDI keyboard.
- [x] **Visual Slice Feedback:** Highlight the active phoneme slice in the UI during playback, visualizing real-time TTS articulation.
- [x] **Rubber-Band Selection:** Implement multi-note selection via mouse drag in `Sequencer.tsx` (and `App.tsx` main view).
- [x] **Clipboard Operations:** Standardize `Ctrl+C` / `Ctrl+V` logic to handle both Note Data *and* associated TTS Metadata (which word is attached to the note).
- [x] **Per-Step Parameters:** Create a UI to edit "Expression" or "Timbre" for individual sequencer steps (vital for humanizing TTS output).
- [x] **Melodic Lyric Mode:** Decouple "Slice Selection" from "Pitch" in the Sampler. Allow playing melodies (Pitch) while triggering specific phonemes (Slice Index) via `LyricMapper`.
- [x] **Note Slice UI:** Visualize the selected phoneme/slice index directly on the sequencer note (e.g., small text label) to improve TTS workflow.
- [x] **Unify Sequencer Components:** Refactor `App.tsx` to use the standalone `Sequencer` component or move `App.tsx` logic into a reusable view to reduce duplication.
- [x] **Glitch Mode:** Add a probability knob that randomly retriggers/stutters the start of a TTS sample (granular synthesis) in the UI.
- [x] **Cleanup Legacy Code:** Identify and remove unused components like `src/components/Sequencer.tsx` to streamline maintenance.
- [x] **Refactor NoteSelector Focus Management:** Verified `NoteSelector` robustness with new test suite `src/components/__tests__/NoteSelector.test.tsx` mocking `requestAnimationFrame`.
- [x] **Step-Sequenced Drive:** Allow individual sequencer steps to override the global Drive/Distortion amount for aggressive, rhythmic vocal accents.

- [x] **Glissando/Portamento Curves:** Allow users to draw custom pitch curves or select between Linear and Exponential glide types between steps. (Implemented Exponential Glide in `SingingVoice.ts`!)
- [x] **Per-Step Breath Intensity:** Allow sequence steps to override global breathiness for rhythmic breathing and whisper effects. (Implemented in `useAudioEngine.ts`!)
- [x] **Custom Sample Slicing UI:** Add a waveform view to `SamplerPanel` that allows users to manually add, move, and remove transient markers for slicing a custom WAV file instead of just auto-slicing by phoneme.
- [x] **Voice Layering / Chorus per Voice:** Allow a detune spread parameter per step for instant vocal thickening.

- [x] **Gesture Controls:** Implement pinch-to-zoom for the sequencer timeline to handle longer patterns or finer steps.
- [x] **Custom Waveform LFO:** Allow users to draw custom LFO shapes for formant and freeze modulation. (Implemented in FormantShifter and SamplerPanel using DrawableLFO and PeriodicWave via DFT!)
- [x] **Gesture Controls:** Implement pinch-to-zoom for the sequencer timeline to handle longer patterns or finer steps.
- [x] **Custom Waveform LFO:** Allow users to draw custom LFO shapes for formant and freeze modulation.

- [x] **Vocal Formant Envelope:** Add a dedicated Attack/Decay envelope specifically for formants to create plucky or sweeping vocal filter effects on every note.
- [x] **Step-Sequenced Reverb Types:** Allow sequence steps to override the global reverb type (e.g., switch from a small room to a massive hall on a specific snare or vocal slice).
- [x] **Per-Step Delay Send:** Allow sequence steps to override the global delay send amount to create rhythmic echoes for TTS or synth sequences.

### Domain C: Accessibility & Mobile
- [x] **Touch Targets:** Audit `Sequencer.tsx` click listeners to ensure mobile drag-to-create works smoothly.
- [x] **A11y Colors:** Verify high-contrast separation between `synth-1` (Chords) and `synth-2` (Lead) notes.
- [x] **Formant Automation:** Implemented continuous vowel morphing by drawing curves for formant shift over time, interpolating parameters globally.

---

* [2026-04-25] - Implemented Step-Sequenced Reverb Types: Added `reverbType` parameter to `Note` interface and updated `NoteSelector` UI to include a space dropdown (Room, Plate, Hall). Refactored `useAudioEngine.ts` to instantiate all three convolution spaces simultaneously to prevent pop artifacts on hot-swapping and updated `audioPlayback.ts` routing to send signals to the correct active `reverbNodesRef` based on the sequence step.
## 🧠 Innovation Lab (The "Dream" Log)
* [x] **Idea:** "Step-Sequenced Bitcrusher / Decimator" - Add per-step bit reduction and downsampling to the sampler for rhythmically evolving lo-fi crunch textures on TTS vocals.
* [ ] **Idea:** "Time-Stretch Envelope" - Use an ADSR envelope to dynamically modulate the `timeRatio` of the granular engine, allowing vocals to rhythmically slow down or speed up over a single step.
* [x] **Idea:** "Dynamic Reverb Density LFO" - Modulate the density or size of the reverb tail dynamically using an LFO for swirling, breathing spaces. (Implemented by modulating reverb send gain using a dedicated sine LFO in useAudioEngine!)
* [x] **Idea:** "Formant-Aware Reverb" - Dynamically adjust the reverb decay and EQ based on the active vowel being sung to prevent high-frequency sibilance buildup. (Implemented in `useAudioEngine.ts` via dynamic lowpass filter before convolution!)
* [x] **Idea:** "Spectral Panning" - Split the TTS audio into multiple frequency bands and dynamically pan them across the stereo field based on an LFO to create wide, swirling vocal textures.
* [x] **Idea:** "Spectral Sidechaining" - Duck specific frequencies (like low-end) instead of broadband gain when the kick drum hits, avoiding pumping artifacts on the highs. (Implemented via BiquadFilterNode lowshelf modulation!)
* [x] **Idea:** "AI Auto-EQ Assistant" - Automatically analyze the frequency spectrum of all tracks and subtly EQ conflicting frequencies to prevent masking (e.g., dipping 200Hz on Synths when the Bass plays).
* [x] **Idea:** "Vocal Overdrive Worklet" - Add a custom AudioWorklet for nonlinear vocal tube distortion.
* [x] **Idea:** "Rhythmic Gating" - Step-sequenced trance gate effect for vocals. (Implemented!)
* [x] **Idea:** "Rhythmic Gating" - Step-sequenced trance gate effect for vocals. (Implemented via square LFO parameter in RubberBandProcessor!)
* [x] **Idea:** "Rhythmic Gating" - Step-sequenced trance gate effect for vocals. (Implemented in `ExpressiveVoiceProcessor` and exposed to `NoteSelector` and `SamplerPanel` for rhythmic amplitude gating!)
* [x] **Idea:** "Spectral Granulator" - Add a granular synthesis mode to the sampler that uses FFT to freeze and smear TTS phonemes over time. (Implemented in Sampler and RubberBandProcessor via a 100ms looping Hann window!)
* [x] **Idea:** "Chord Evolving" - Allow drawing automation curves for the chord inversions or voicings used by `VoiceManager` in Polyphonic Synth A. (Implemented via automation track logic in `useStepHandler.ts` and `App.tsx`!)
* [x] **Idea:** "Step-Sequenced Formant Shifts" - Allow users to pitch shift the formants of the TTS engine independently of the fundamental frequency per step.
*These are concepts to be fleshed out by the agent during "Architect Mode".*

* [x] **Idea:** "Voice Layering / Chorus per Voice" - Allow a detune spread parameter per step for instant vocal thickening. (Implemented per-step choir in NoteSelector/useAudioEngine!)
* [x] **Idea:** "Lyric Track" - A global text input that automatically distributes syllables across selected MIDI notes. (Implemented via global Lyric Track lane and `sliceIndex` auto-mapping!)
* [x] **Idea:** "Choir Stack" - Using Polyphony to detune the TTS voice slightly on 3 channels to create a chorus effect. (Implemented via Polyphonic Singing update!)
* [x] **Idea:** "Gesture Controls" - Implement pinch-to-zoom for the sequencer timeline to handle longer patterns or finer steps.
* [x] **Idea:** "Per-Step Reverse" - Allow reversing the TTS sample on a per-step basis for creative rhythmic effects. (Implemented in Sampler phoneme slicing!)
* [x] **Idea:** "Dynamic Phoneme Pitch Bends" - Allow drawing pitch bend automation within a single phoneme slice (e.g. going up a fifth on a single vowel). (Implemented as Slide/Glide property!)
* [x] **Idea:** "Text-to-Drumkit" - Auto-generate a drum kit from a TTS phrase by mapping short transient consonants (t, k, p) to hats/snares and vowels to kicks/toms.
* [x] **Idea:** "Vocal Envelope Shaper" - Add granular attack/decay ADSR shaping explicitly for TTS syllables to create sharp plucks or smooth pads from any word. (Implemented in ExpressiveVoiceProcessor and exposed to SamplerPanel!)
* [x] **Idea:** "Dynamic Tremolo" - Expose Tremolo Rate and Depth to UI to pulse vocals. (Implemented!)
* [x] **Idea:** "LFO to Freeze Amount" - Automate the Freeze parameter with an LFO to create rhythmic pulsing granular clouds. (Implemented in RubberBandProcessor and exposed to SamplerPanel!)
* [x] **Idea:** "Per-Step Filter & Resonance" - Allow sequence steps to override cutoff and resonance for rhythmic acid-style filtering of TTS samples. (Implemented!)
* [x] **Idea:** "Filter Envelope Mod" - Allow the sequence steps to have an envelope mod amount that specifically shapes the filter envelope per step. (Implemented!)
* [x] **Idea:** "Vocal Formant LFO" - Introduce a Formant LFO with rate and depth controls for dynamic rhythmic Wah-Wah effects on TTS vowels. (Implemented in FormantShifter and SamplerPanel!)
* [x] **Idea:** "Step-Sequenced Formant LFO" - Allow individual steps to override the global Formant LFO rate and depth for highly articulated rhythmic sequences.
* [x] **Idea:** "Custom Waveform LFO" - Allow users to draw custom LFO shapes for formant and freeze modulation. (Implemented in FormantShifter and SamplerPanel using DrawableLFO and PeriodicWave via DFT!)
* [x] **Idea:** "LFO Rate Sync to Tempo" - Allow LFO rates (like Formant LFO or Freeze LFO) to sync to the sequencer tempo. (Implemented in NoteSelector, SamplerPanel, and useAudioEngine!)
* [x] **Idea:** "Microtonal Scale Mapping" - Allow specifying custom microtonal scales rather than the standard 12-TET for Synth and Sampler parts.
* [x] **Idea:** "Custom Waveform LFO" - Allow users to draw custom LFO shapes for formant and freeze modulation. (Implemented via DrawableLFO and FormantShifter Fourier Transform!)
* [x] **Idea:** "Glissando/Portamento Curve Drawing" - Allow users to draw custom pitch curves between steps, rather than just a linear glide. (Implemented!)
* [x] **Idea:** "Phoneme-Aware Velocity" - Automatically adjust the amplitude envelope attack/decay based on the phoneme type (e.g., plosives get faster attack, vowels get smoother attack). (Implemented via dynamic envelope overrides in `SingingVoice.ts`!)
* [x] **Idea:** "Spectral Morphing" - Implement functionality to morph spectrally between two different TTS phonemes or samples over a sequence of steps. (Implemented via FormantShifter Voice Character Morphing and step-sequenced automation!)
* [x] **Idea:** "Dynamic Reverb" - Allow users to draw automation curves for reverb send per step. (Implemented!)
* [x] **Idea:** "Global Saturation / Tape Warmth" - Add a master channel saturation unit to glue the mix together. (Implemented via WaveShaperNode!)
* [x] **Idea:** "Auto-Slice by Transients" - Use energy-based analysis to automatically detect and place slice markers at drum hits or clear transients when a custom sample is loaded. (Implemented via `AUTO-SLICE` button logic in `WaveformDisplay` and `SamplerPanel`!)
* [x] **Idea:** "Per-Step Delay Send" - Allow sequence steps to override the global delay send amount to create rhythmic echoes for TTS or synth sequences. (Implemented!)
* [x] **Idea:** "Vocal Formant Envelope" - Add a dedicated Attack/Decay envelope specifically for formants to create plucky or sweeping vocal filter effects on every note. (Implemented in FormantShifter and SamplerPanel!)
* [x] **Idea:** "Step-Sequenced Reverb Types" - Allow sequence steps to override the global reverb type (e.g., switch from a small room to a massive hall on a specific snare or vocal slice). (Implemented via three separate global ConvolverNodes inside useAudioEngine allowing glitchless dynamic per-step routing!)
* [x] **Idea:** "AI Auto-Mix Assistant" - Automatically adjusts levels, panning, and EQ based on track content to maintain a balanced mix. (Core deterministic version implemented 2026-06-26; dynamic activity-aware enhancement merged from alternate branches 2026-07-10.)
* [x] **Idea:** "Real-time Convolution Reverb for Vocal Spaces" - Enhance the dynamic reverb by allowing users to select impulse response types. (Implemented!)
* [x] **Idea:** "Per-Step Breath Intensity" - Allow sequence steps to override global breathiness for rhythmic breathing and whisper effects. (Implemented!)
* [x] **Idea:** "Advanced Slice Tuning" - Allow users to fine-tune slice sensitivity and adjust the threshold parameters for Auto-Slice. (Implemented in `SamplerPanel` and `WaveformDisplay`!)

* [x] **Idea:** "Per-Step Delay Send" - Allow sequence steps to override the global delay send amount. (Implemented!)
* [x] **Idea:** "Master Bus Compressor" - Add a `DynamicsCompressorNode` to the master output for gluing the mix together. (Implemented via a fixed "Glue Compressor" block before the Master Gain!)
* [x] **Idea:** "Sidechain Compression" - Allow routing the kick drum to a dedicated sidechain bus to dynamically duck the bass/synths. (Implemented via scheduled GainNode automation on kick hits!)
---

---

* [x] **Idea:** "Granular Envelope Follower" - Allow mapping the amplitude envelope of the voice sample to control granular parameters like grain size or freeze amount.
* **Idea:** "Granular Envelope Follower" - Allow mapping the amplitude envelope of the voice sample to control granular parameters like grain size or freeze amount.
* [x] **Idea:** "Vocal Harmony Parallel Bus" - Implement a dedicated bus to process all harmony vocal tracks together (e.g., glue compression, joint EQ) independently from the main lead vocal track.
* [x] **Idea:** "Multiband Distortion for TTS" - Create a specialized distortion effect that splits the vocal spectrum and only saturates the highs to simulate aggressive modern pop/rap vocal processing without muddying the fundamental pitch.
* [x] **Idea:** "Harmony Panning & Routing Fix" - Fix the master saturation bypass for harmony voices that prevented proper panning. Ensure pan parameters add up and clamp correctly.
* [x] **Idea:** "Dynamic Delay Times" - Add LFOs and envelopes to modulate delay time. (Implemented via global delayLfoRate and delayLfoDepth parameters accessible both globally in SamplerPanel and per-step in NoteSelector!)
* [x] **Idea:** "Formant Glide" - Add step-sequenced formant slide/glide. (Implemented via `slideFormant` toggle and `setFormantGlide` in AudioEngine/SingingVoice)
---

* [x] **Idea:** "Harmony Bus Parameters + Stereo Widener" - Expose compressor/EQ and optional widening parameters on the Vocal Harmony Parallel Bus to the UI.
* [x] **Idea:** "Dynamic Reverb Density LFO" - Modulate the density or size of the reverb tail dynamically using an LFO for swirling, breathing spaces. (Implemented by modulating reverb send gain using a dedicated sine LFO in useAudioEngine!)
* [x] **Idea:** "Spectral Panning" - Split the TTS audio into multiple frequency bands and dynamically pan them across the stereo field based on an LFO to create wide, swirling vocal textures.
---

## 📜 Changelog
* [2026-07-08] - Implemented Per-Step Panning: Added `pan` to `Note` interface and Audio Engine parameter blocks. Exposed a Pan slider in `NoteSelector.tsx` and wired it into `ContextMenuNode.tsx`. Updated `useAppState.tsx` to handle note property overrides for 'pan'. Modified `audioPlayback.ts` and `useStepHandler.ts` to merge per-step panning overrides during playback orchestration (handling Synth, Bass2, Sampler, and Drum routes).
* [2026-05-27] - Implemented Formant Glide: Added `slideFormant` parameter to `Note` interface and `NoteSelector` UI. Plumbed parameter through `useStepHandler` to track `lastSamplerFormantRef` and passed `slideFromFormant` down to `useAudioEngine`. Extended `SingingVoice` and `FormantShifter` to accept `setFormantGlide` scheduling via `linearRampToValueAtTime`. Fulfills the "Formant Glide" Innovation Lab idea.
* [2026-07-08] - Implemented Harmony Panning & Routing Fix: Fixed an issue where the panner node was routed back to `masterSaturation` instead of its intended spectral final destination, bypassing the `isHarmonyVoice` logic. Updated harmony voice parameter calculation to correctly sum and clamp (-1 to 1) panning between base sample settings and harmony settings to allow true wide stereo spread. Fulfills the "Harmony Panning & Routing Fix" Innovation Lab idea.
* [2026-07-07] - Implemented Dynamic Reverb Density LFO: Added `reverbLfoRate` and `reverbLfoDepth` to `SamplerBankParams` and `Note` interfaces. Exposed these parameters in `SamplerPanel` and `NoteSelector` for global and per-step control. Updated `useAudioEngine.ts` to modulate the reverb send gain with a dedicated sine wave `OscillatorNode`, creating rhythmic breathing and swirling spatial effects without introducing convolver artifacts. Fulfills the "Dynamic Reverb Density LFO" Innovation Lab idea.
* [2026-07-06] - Implemented Harmony Bus Parameters + Stereo Widener: Exposed `busCompressorThreshold`, `busEqGain`, and `busWidener` in `HarmonizerConfig` and `HarmonizerPopover`. Implemented Haas effect delay routing on the harmony parallel bus in `useAudioEngine.ts` for wide stereo spread. Fulfills the "Harmony Bus Parameters + Stereo Widener" Innovation Lab idea. Added new ideas: "Dynamic Reverb Density LFO" and "Spectral Panning".
* [2026-07-05] - Implemented Formant-Aware Reverb: Dynamically adjusted reverb send EQ (lowpass cutoff) based on active `formantShift` parameters in `useAudioEngine.ts` to prevent high-frequency sibilance buildup on bright vowels. Added new idea: Dynamic Reverb Density LFO.
* [2026-07-04] - Implemented Multiband Distortion for TTS: Updated `vocal-overdrive-processor.ts` to include a 1-pole state variable filter crossover. Applied asymmetric tube clipping specifically to the high-frequency band to prevent fundamental pitch muddying.
* [2026-07-03] - Implemented Vocal Harmony Parallel Bus: Created a dedicated parallel bus (`harmonyBusGainRef` -> `harmonyCompressorRef` -> `harmonyEQRef`) in `useAudioEngine.ts`. Routed harmony voices (where `isHarmonyVoice` is true) through this bus for independent glue compression and EQ before re-joining the master chain. Fulfills the "Vocal Harmony Parallel Bus" idea.
* [2026-07-01] - Implemented Rhythmic Gating: Added `gateDepth` and `gateRate` parameters to the `Note` interface and `SamplerBankParams`. Exposed UI controls in `NoteSelector` and connected them through `useAudioEngine.ts` to the `rubberband-processor.ts` AudioWorklet, creating a smoothed, step-sequenced trance gate effect.
* [2026-07-01] - Implemented Microtonal Scale Mapping: Added multiple microtonal tuning systems (e.g., 24-TET, Just Intonation, Bohlen-Pierce) to `musicTheory.ts` with `applyMicrotonalTuning` logic. Added a new tuning dropdown to the `ScaleSelector` UI. Wired `tunedNoteToFrequency` logic through `constants.ts`, `SingingVoice.ts`, and `VoiceManager.ts` to allow both Synthesizers and Sampler to play in custom tunings dynamically.
* [2026-05-03] - Implemented Granular Pitch Quantization: Added `grainPitchQuantize` parameter to `RubberBandProcessor` parameter descriptors to snap frozen grain pitch to quantized semitone intervals (e.g. 5=fourths, 7=fifths, 12=octaves). Wired the parameter through `SingingVoice.ts`, `useAudioEngine.ts`, `SamplerPanel.tsx`, and `NoteSelector.tsx` for both global and per-step control. Added comprehensive tests. Fulfills the "Granular Pitch Quantization" Innovation Lab idea.
* [2026-05-03] - Implemented Tape Stop Effect: Added `triggerTapeStop(duration)` and `resetTapeStop()` to the `AudioEngine` in `useAudioEngine.ts`, using `exponentialRampToValueAtTime` on the master gain node for a smooth fade-out. Wired the Escape key in `App.tsx` and added a dedicated "TAPE STOP" button to the master utilities UI. Added tests for button rendering and Escape key behavior. Fulfills the "Tape Stop Effect" Innovation Lab idea.
* [2026-06-30] - Implemented Granular Envelope Follower per-step: Added `freezeEnvDepth` and `grainEnvDepth` to `Note` interface and `NoteSelector` UI, routing them through `useAudioEngine.ts` to allow step-sequenced envelope modulation of the granular parameters. Fulfills the "Granular Envelope Follower" idea.
* [2026-07-01] - Implemented Spectral Sidechaining: Upgraded the `sidechainBus` from a standard `GainNode` to a `BiquadFilterNode` (lowshelf at 250Hz). Modulated the filter gain (in dB) via `triggerSidechainDuck` instead of broadband amplitude, ducking only the low-end of synth and bass tracks when the kick hits to preserve high-frequency transients. Fulfills the "Spectral Sidechaining" Innovation Lab idea. Added new idea: "AI Auto-EQ Assistant".
* [2026-06-29] - Implemented Sidechain Compression: Added `sidechainBus` between the master saturation and master compressor to duck Synths/Basses when the kick drum triggers. Implemented `triggerSidechainDuck` in `audioPlayback.ts` to use deterministic native browser parameter scheduling (`linearRampToValueAtTime` / `exponentialRampToValueAtTime`) on the new sidechain gain node to avoid CPU overhead and achieve a classic EDM pump. Fulfills the "Sidechain Compression" Innovation Lab idea.
* [2026-06-28] - Implemented LFO Rate Sync to Tempo: Added toggles and subdivision dropdowns to `SamplerPanel` and `NoteSelector` for `freezeLfoRate` and `formantLfoRate`. Updated `useAudioEngine.ts` to calculate real-time Hz values from BPM and note subdivisions when sync mode is enabled. Fulfills the "LFO Rate Sync to Tempo" Innovation Lab idea. Added new idea: "Granular Envelope Follower".
* [2026-06-27] - Implemented Master Bus Compressor: Inserted a default `DynamicsCompressorNode` configured as a gentle "Glue Compressor" (Threshold: -15dB, Ratio: 4:1, Attack: 30ms, Release: 250ms) into the master audio chain (`masterSaturation` -> `masterCompressor` -> `masterGain` -> `masterPanner`). Updated `useAudioEngine.ts` to reflect the new master bus input point and updated `PlaybackRefs`.
* [2026-05-08] - Implemented Custom Waveform LFO: Added `DrawableLFO` component to allow users to draw custom LFO shapes for formant modulation. Integrated with `FormantShifter.ts` to convert the drawn array into a `PeriodicWave` using a Discrete Fourier Transform (DFT), passing `formantLfoShape` from the `SamplerPanel` through `SingingVoice` and `useAudioEngine`. Added new ideas: "LFO Rate Sync to Tempo" and "Microtonal Scale Mapping".
* [2026-06-27] - Implemented Vocal Formant Envelope: Added Formant Envelope parameters to `SamplerBankParams` and `Note` interfaces, allowing users to modulate formant detune amounts via an attack/decay envelope on `ConstantSourceNode` and `GainNode`. Added global and per-step controls to `SamplerPanel` and `NoteSelector`.
* [2026-06-27] - Verified Gesture Controls: Confirmed pinch-to-zoom is fully implemented in `MainSequencer.tsx` and marked as complete.
* [2026-06-27] - Implemented Per-Step Delay Send: Added `delaySend` parameter to `Note` interface and updated `NoteSelector` UI to include a slider. Plumbed the parameter through `App.tsx` and updated `useAudioEngine.ts` to allow both Sampler (`playSamplerVoice`) and Synth (`VoiceManager`) engines to override the global delay send bus per-step. Fulfills the "Per-Step Delay Send" Innovation Lab idea.
* [2026-06-26] - Implemented Custom Waveform LFO: Added a new `DrawableLFO` canvas component to `SamplerPanel` allowing users to draw an arbitrary LFO shape. Added a Discrete Fourier Transform (DFT) engine inside `FormantShifter.ts` to convert the normalized shape into a `PeriodicWave` used by the internal Web Audio `OscillatorNode`.
* [2026-06-25] - Implemented Step-Sequenced Formant Shifts: Added `formantShift` parameter to `Note` interface and `NoteSelector` UI. Wired it through `useAudioEngine` and `useStepHandler` to allow per-step overrides of the global Formant Shift parameter, fulfilling the "Step-Sequenced Formant Shifts" Innovation Lab idea.
* [2026-07-09] - Implemented Dynamic Delay Times: Added `delayLfoRate` and `delayLfoDepth` to `SamplerBankParams` and `Note` interfaces. Attached an `OscillatorNode` to modulate the global `delayNode.delayTime` in `useAudioEngine.ts`. Added UI controls to `SamplerPanel` and `NoteSelector` for global and per-step automation of the wobble effect. Added new idea: "Step-Sequenced Envelope Follower".
* [2026-06-24] - Implemented Real-time Convolution Reverb for Vocal Spaces: Added `ReverbType` ('room', 'plate', 'hall') to `types.ts` and updated `useAudioEngine.ts` to dynamically generate and swap the convolution impulse response based on the selected type using `createReverbImpulseResponse`. Added a dropdown selector to `App.tsx` next to the Master Saturation control to allow global reverb type switching.
* [2026-06-23] - Implemented Advanced Slice Tuning: Added an auto-slice sensitivity slider to the `WaveformDisplay` component. Plumbed the sensitivity state through `SamplerPanel` down to `PhonemeAligner.detectSegmentBoundaries` via a new `thresholdMultiplier` parameter, allowing users to fine-tune transient detection for different sample types.
* [2026-06-22] - Implemented Auto-Slice by Transients: Added an "AUTO-SLICE" button to the `WaveformDisplay` component that uses energy-based peak detection in `PhonemeAligner.ts` to automatically detect drum hits and transients and populate custom slice markers.
* [2026-06-21] - Implemented Custom Sample Slicing UI: Enhanced `WaveformDisplay.tsx` to support interactive mousedown, drag, and double-click events, allowing users to manually slice custom WAV files directly on the canvas. Connected to the AudioEngine via `setAlignment`.
* [2026-06-20] - Implemented Glissando/Portamento Curves & Per-Step Breath Intensity: Added `slideType` parameter (Linear/Exponential) to allow musical variations of pitch glides in TTS, and allowed individual steps to override global breath noise via `breathIntensity`. Added Custom Sample Slicing UI to Active Backlog.
* [2026-06-19] - Implemented Global Saturation: Added a master channel `WaveShaperNode` with a variable distortion curve mapped to a "Warmth" (Saturation) slider in the top utility UI. Routed the entire master mix through it to add glue and presence. Added new idea: "AI Auto-Mix Assistant".
* [2026-06-18] - Implemented Dynamic Reverb: Added a `ConvolverNode` hooked up to the master output with a generated exponential decay noise impulse response. Mapped `reverbSend` from individual sequence steps in `NoteSelector` to send audio from the TTS `SingingVoice` into the new global reverb bus. Added new idea: "Global Saturation / Tape Warmth".
* [2026-06-17] - Implemented Spectral Morphing: Added `characterMorph` and `morphTarget` to allow smooth interpolation between voice characters (e.g., male to female) per sequence step using `FormantShifter.ts`. Added Morph knob and target selector to `SamplerPanel.tsx` and override controls to `NoteSelector.tsx`.
* [2026-06-16] - Implemented Phoneme-Aware Velocity: Modified `triggerSlice` in `SingingVoice.ts` to dynamically scale the amplitude envelope attack and decay based on the `phoneme.category` parameter (e.g., extremely fast attack for plosives, smoother attack for vowels). Added new Innovation Lab idea: Spectral Morphing.
* [2026-03-31] - Implemented Phoneme-Aware Velocity: Modified `SingingVoice.ts` and `triggerSlice` to dynamically scale the envelope attack and decay based on the `phoneme.category` properties (e.g. extremely fast attacks for plosives, smooth for vowels) for more natural articulated vocal rendering. Added new idea: Voice Layering / Chorus per Voice.
* [2026-06-15] - Implemented Step-Sequenced Vibrato: Added `vibratoDepth` controls to the `NoteSelector` component and wired them into `App.tsx` and `useAudioEngine.ts` to allow per-step overrides of the global Vibrato Depth for natural phrasing. Added new ideas: "Glissando/Portamento Curve Drawing" and "Phoneme-Aware Velocity".
* [2026-06-14] - Implemented Step-Sequenced Formant LFO: Added `formantLfoRate` and `formantLfoDepth` controls to the `NoteSelector` component and wired them into `App.tsx` and `useAudioEngine.ts` to allow per-step overrides of the global Formant LFO settings for dynamic, rhythmic Wah-Wah effects. Added new idea: Custom Waveform LFO.
* [2026-06-13] - Implemented Vocal Formant LFO: Added `formantLfoRate` and `formantLfoDepth` to `FormantShifter.ts`, routing an internal oscillator to the detune parameters of the peaking filters to create a rhythmic Wah-Wah effect. Added UI controls to `SamplerPanel.tsx`. Fulfills the "Vocal Formant LFO" Innovation Lab idea. Added new idea: Step-Sequenced Formant LFO.
* [2026-06-12] - Implemented Chord Evolving: Added 'Chord Inversion' automation parameter allowing users to draw curves that dynamically shift the inversions of chords per step for synth and bass tracks, fulfilling the Chord Evolving Innovation Lab idea.
* [2026-06-11] - Implemented Global Lyric Track: Replaced `LyricMapper` dialog with a dedicated `LyricTrack` component in `App.tsx`. Text generation now automatically maps syllables/words to consecutive active notes in the sequence using `sliceIndex`, fulfilling the Lyric Track Innovation Lab idea.
* [2026-05-08] - Implemented Dynamic Tremolo Effect: Exposed Tremolo Rate and Depth knobs to the `SamplerPanel` UI and mapped them through `useAudioEngine.ts` and `SingingVoice.ts` down to the `RubberBandProcessor` AudioWorklet to allow dynamic amplitude modulation for rhythmic pulsing effects on vocals.
* [2026-06-10] - Implemented Vocal Envelope Shaper: Upgraded `ExpressiveVoiceProcessor` to support a full ADSR (Attack, Decay, Sustain, Release) envelope for TTS samples. Added Decay and Sustain knobs to the `SamplerPanel` UI and mapped parameters via `SingingVoice` and `useAudioEngine`. Added a new Innovation Lab task for Tremolo Effect.
* [2026-06-09] - Implemented Filter Envelope Mod: Added `envMod` control to `NoteSelector` and wired it through `App.tsx` and `audioPlayback.ts` to allow step-sequenced filter envelope modulation amounts.
* [2026-06-08] - Implemented Per-Step Filter & Resonance: Mapped `noteParams.filterCutoff` and `noteParams.filterResonance` in `useAudioEngine.ts` to process per-step filter configurations correctly on both stretch (TTS SingingVoice) and standard buffer sampler playback nodes.
* [2026-06-07] - Implemented LFO to Freeze Amount: Added `freezeLfoRate` and `freezeLfoDepth` to `RubberBandProcessor` parameter descriptors and processing logic to allow rhythmic granular cloud pulsing. Integrated UI controls in `SamplerPanel`.
* [2026-06-07] - Implemented Per-Step Freeze Amount: Added `freeze` parameter to `NoteSelector` UI and mapped to `noteParams` in `useAudioEngine` and `SingingVoice.ts` for per-step granular synthesis control.
* [2026-03-14] - Implemented Step-Sequenced Formant Shifts: Updated `SingingVoice.ts` to utilize `FormantShifter.ts` and enabled formant shifting in `useAudioEngine.ts` to process per-step timbre offsets correctly via Biquad filters.
* [2026-06-06] - Implemented Spectral Granulator: Added `freeze` parameter to `RubberBandProcessor` to continuously loop a ~100ms Hann-windowed grain when activated. Wired to `SamplerPanel` and `NoteSelector` for global and per-step granular smearing.
* [2026-06-06] - Implemented Formant Automation: Updated `FormantShifter.ts`, `SingingVoice.ts`, and `useAudioEngine.ts` to support continuous interpolation (`linearRampToValueAtTime`) of formant shifting over step durations during automation playback.
* [2026-06-06] - Implemented Spectral Granulator (Freeze): Integrated granular freeze into `rubberband-processor.ts` by halting the sample read pointer and looping a ~100ms grain, smearing TTS phonemes. Added Freeze knob to SamplerPanel.
* [2026-06-05] - Implemented Text-to-Drumkit Feature: Added a 'TEXT TO DRUMS' action in the Lyric Mapper that automatically populates the Kick, Snare, and Hi-Hat tracks by rhythmically mapping TTS phonemes based on their phonetic properties (vowels to kicks, fricatives/plosives to hats and snares).
* [2026-06-04] - Implemented Dynamic Phoneme Pitch Glide: Enhanced `SingingVoice` and sequencer to slide between TTS phonemes smoothly when slide is active.
* [2026-06-03] - Implemented Per-Step Reverse: Updated `SingingVoice.ts` and `useAudioEngine.ts` to allow reversing individual TTS phoneme slices on a per-step basis, matching the "Per-Step Reverse" Innovation Lab idea.
* [2026-03-03] - Implemented A11y Colors: Updated `getNoteColor` logic to apply complementary hue shifts and lightness contrast for `synth-2` (Bass/partB) notes vs `synth-1` (Lead/partA), significantly improving visual separation in the sequencer.
* [2026-05-08] - Roadmap re-initialized for long-term recursion.
* [2026-05-08] - Implemented Vocal Envelope: Added Attack/Release envelope controls to `ExpressiveVoiceProcessor` and exposed them to `SamplerPanel` to allow softer vocal attacks and prevent clicks on rapid retriggering. Improved `SingingVoice.ts` precise noteOff timing handling via absolute target times.
* [2026-05-08] - Implemented Glitch Mode UI: Added probability knob for random TTS retriggers.
* [2026-06-02] - Implemented Polyphonic Singing: Added `SingingVoiceManager` to handle a pool of TTS voices, enabling chord playback and multi-voice "Choir" effects in the Sampler.
* [2026-06-01] - Wired up Melodic Lyric Mode in `App.tsx`, connecting state to `SamplerPanel` toggle and `MainSequencer` rendering. Verified and tested `NoteSelector` accessibility.
* [2026-05-30] - Implemented Note Slice UI: Visualized TTS phonemes directly on sequencer steps in `MainSequencer.tsx`. Verified absence of legacy `Sequencer.tsx`.
* [2026-02-05] - Implemented Phoneme Elasticity in Sampler Engine.
* [2026-05-21] - Refactored SingingVoice state management to eliminate type casting hacks and improve multi-bank alignment handling.
* [2026-05-22] - Implemented TTS Slice Triggering (Phoneme Mode) in Audio Engine.
* [2026-05-23] - Implemented Slice Mode UI in SamplerPanel, enabling Phoneme Slice Mode triggering via MIDI keys.
* [2026-05-24] - Implemented Rubber-Band Selection (Shift+Drag) in the main sequencer view (`App.tsx`), enabling multi-step selection and bulk deletion.
* [2026-05-25] - Implemented Hybrid Polyphony using `VoiceManager`, enabling 8-voice polyphony for Synth A and legato monophony for Synth B.
* [2026-05-26] - Implemented Visual Slice Feedback in SamplerPanel using canvas-based WaveformDisplay and imperative playback highlighting.
* [2026-05-27] - Implemented Clipboard Operations (Ctrl+C/V) and Drag-to-Edit (Painting) in the main sequencer view (`App.tsx`).
* [2026-05-28] - Implemented Per-Step Parameters (Timbre, Probability, Microtiming) in Audio Engine and NoteSelector UI.
* [2026-05-29] - Implemented Phoneme-Aware Time Stretching DSP in RubberBandProcessor, enabling dynamic vowel stretching during playback.
* [2026-05-29] - Implemented Melodic Lyric Mode: Added `sliceIndex` to Note data, allowing independent pitch control and slice triggering for "Singing" TTS. Updated LyricMapper to preserve pitch.
* [2026-05-30] - Refactored Sequencer UI: Extracted `Sequencer`, `SequencerRow`, `SvgStep` into dedicated components, removed legacy code, and centralized sequencer constants.
## 2026-06-26 - Implemented AI Auto-Mix Assistant: Added a deterministic heuristic system triggered via the '✨ AUTO-MIX' button in the master utilities UI. The assistant automatically sets levels and spreads panning across Synth A, Synth B, TB-303 Bass, Drum Kits, and 8-channel Sampler tracks. Connected StereoPannerNodes natively into Open303Manager, VoiceManager, and AudioPlayback to process 'pan' properly on the audio thread.

* [2026-07-10] - Enhanced AI Auto-Mix Assistant (from alternate branch merge): Upgraded `handleAutoMix` in `useAppState.tsx` to dynamically analyze sequencer step activity across all tracks. Panning intelligently spreads or centers synths based on which are active; volumes are density-aware (attenuate busy tracks for headroom); filter cutoff/resonance dynamically adjusted on synths to prevent masking when bass or vocals are prominent. Fulfills and extends the "AI Auto-Mix Assistant" idea with content-aware logic.

* [x] **Idea:** "Tape Stop Effect" - Add a global performance effect that smoothly slows down playback rate to zero, simulating a turntable or tape machine stopping. (Implemented in `useAudioEngine.ts` with `triggerTapeStop` using `exponentialRampToValueAtTime` on master gain, wired to Escape key and a dedicated UI button in `App.tsx`!)
* [x] **Idea:** "Granular Pitch Quantization" - Add a parameter to the granular engine that forces grains to snap to specific pitch intervals (e.g. perfect fifths or octaves) as they smear, creating crystalline robotic effects. (Implemented in `rubberband-processor.ts` with `grainPitchQuantize` parameter, wired through `SingingVoice.ts`, `useAudioEngine.ts`, `SamplerPanel.tsx`, and `NoteSelector.tsx`!)
* [2026-07-02] - Implemented Rhythmic Gating: Added step-sequenced trance gate effect for vocals. Added `tranceGate` parameter to `Note` interface and UI. Implemented square LFO amplitude modulation synchronized in `rubberband-processor.ts`. Fulfills "Rhythmic Gating" Innovation Lab idea. Added new ideas: "Vocal Harmony Parallel Bus" and "Multiband Distortion for TTS".
* [2026-07-02] - Implemented Rhythmic Gating: Added `gateRate` and `gateDepth` to `ExpressiveVoiceProcessor.ts` to apply a square-wave LFO to the amplitude envelope, creating classic trance gate effects on vocals. Plumbed parameters through `SingingVoice.ts`, `useAudioEngine.ts`, and updated `SamplerPanel` and `NoteSelector` to allow global and per-step control.
* [2026-07-01] - Implemented Microtonal Scale Mapping: Added `TuningSystem` types (12-TET, 24-TET, Just Intonation, Pythagorean, Bohlen-Pierce) to `musicTheory.ts` and `ScaleSelector`. Pushed tuning state through `NoteParams` down to `VoiceManager`, `synthPlayback`, `samplerPlayback` and Web Worker for correct tuning rendering offline.
* [2026-05-08] - Implemented AI Auto-EQ Assistant: Added a `bassSidechainEQBus` (peaking filter at 250Hz) to `initializeMasterOutput`. Implemented `triggerBassEQDuck` to dynamically duck this EQ band on the master synth bus whenever a Bass note (303 or synth bass) triggers, preventing low-mid frequency masking and fulfilling the AI Auto-EQ Assistant Innovation Lab idea. Added new ideas: "Vocal Overdrive Worklet" and "Rhythmic Gating".
* [2026-05-12] - Implemented Performance Fixes for CI and TS Types: Cleaned up mismatched properties between `SamplerBankParams` UI and internal type definitions (`coarseTune`, `fineTune`, `formantShift`, `quality`, `lockToSequencer`). Cleaned up custom sequencer optimization patch.

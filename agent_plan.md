# Web Sequencer: Living Roadmap

**Mission:** Build the ultimate browser-based DAW, fusing classic MIDI workflow (Cubase-style) with next-generation AI Vocal Synthesis (TTS Sampling).

**Current Velocity:** 1 Feature per Run
**Architectural Focus:** Polyphony & Vocal Granularity

---

## 🚀 Active Backlog (Prioritized)

### Domain A: Audio Engine (Synth & Sampler)
- [x] **Refactor SingingVoice State:** Expose alignment state setters in `SingingVoice` to avoid type casting hacks and improve multi-bank alignment handling.
- [x] **TTS Slice Triggering:** Implement a logic where a MIDI Note NoteOn event can trigger a specific *slice* or *word* from the TTS buffer (e.g., Note C3 = "Hello", Note D3 = "World").
- [x] **Hybrid Polyphony:** Finalize `VoiceManager` to handle 8-voice polyphony for `synth-1` while keeping `synth-2` strictly monophonic (legato priority).
- [x] **Phoneme Elasticity:** Connect `rubberband.wasm` to the sequencer steps. If a note is dragged longer, the specific phoneme should time-stretch to match the duration without altering pitch.
- [x] **Polyphonic Singing:** Implement `SingingVoiceManager` to allow polyphonic playback (chords) for the TTS engine, supporting multiple simultaneous phoneme streams.

### Domain B: Editor Workflow (The "Cubase" Feel)
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

### Domain C: Accessibility & Mobile
- [x] **Touch Targets:** Audit `Sequencer.tsx` click listeners to ensure mobile drag-to-create works smoothly.
- [x] **A11y Colors:** Verify high-contrast separation between `synth-1` (Chords) and `synth-2` (Lead) notes.
- [x] **Formant Automation:** Implemented continuous vowel morphing by drawing curves for formant shift over time, interpolating parameters globally.

---

## 🧠 Innovation Lab (The "Dream" Log)
* [x] **Idea:** "Spectral Granulator" - Add a granular synthesis mode to the sampler that uses FFT to freeze and smear TTS phonemes over time. (Implemented in Sampler and RubberBandProcessor via a 100ms looping Hann window!)
* [x] **Idea:** "Chord Evolving" - Allow drawing automation curves for the chord inversions or voicings used by `VoiceManager` in Polyphonic Synth A. (Implemented via automation track logic in `useStepHandler.ts` and `App.tsx`!)
* **Idea:** "Step-Sequenced Formant Shifts" - Allow users to pitch shift the formants of the TTS engine independently of the fundamental frequency per step.
* **Idea:** "Custom Sample Slicing UI" - Add a waveform view to `SamplerPanel` that allows users to manually add, move, and remove transient markers for slicing a custom WAV file instead of just auto-slicing by phoneme.
*These are concepts to be fleshed out by the agent during "Architect Mode".*

* [x] **Idea:** "Lyric Track" - A global text input that automatically distributes syllables across selected MIDI notes. (Implemented via global Lyric Track lane and `sliceIndex` auto-mapping!)
* **Idea:** "Choir Stack" - Using Polyphony to detune the TTS voice slightly on 3 channels to create a chorus effect. (Implemented via Polyphonic Singing update!)
* **Idea:** "Gesture Controls" - Implement pinch-to-zoom for the sequencer timeline to handle longer patterns or finer steps.
* [x] **Idea:** "Per-Step Reverse" - Allow reversing the TTS sample on a per-step basis for creative rhythmic effects. (Implemented in Sampler phoneme slicing!)
* [x] **Idea:** "Dynamic Phoneme Pitch Bends" - Allow drawing pitch bend automation within a single phoneme slice (e.g. going up a fifth on a single vowel). (Implemented as Slide/Glide property!)
* **Idea:** "Text-to-Drumkit" - Auto-generate a drum kit from a TTS phrase by mapping short transient consonants (t, k, p) to hats/snares and vowels to kicks/toms.
* [x] **Idea:** "Vocal Envelope Shaper" - Add granular attack/decay ADSR shaping explicitly for TTS syllables to create sharp plucks or smooth pads from any word. (Implemented in ExpressiveVoiceProcessor and exposed to SamplerPanel!)
* [x] **Idea:** "Dynamic Tremolo" - Expose Tremolo Rate and Depth to UI to pulse vocals. (Implemented!)
* [x] **Idea:** "LFO to Freeze Amount" - Automate the Freeze parameter with an LFO to create rhythmic pulsing granular clouds. (Implemented in RubberBandProcessor and exposed to SamplerPanel!)
* **Idea:** "LFO to Freeze Amount" - Automate the Freeze parameter with an LFO to create rhythmic pulsing granular clouds.
* [x] **Idea:** "Per-Step Filter & Resonance" - Allow sequence steps to override cutoff and resonance for rhythmic acid-style filtering of TTS samples. (Implemented!)
* [x] **Idea:** "Filter Envelope Mod" - Allow the sequence steps to have an envelope mod amount that specifically shapes the filter envelope per step. (Implemented!)
* [x] **Idea:** "Vocal Formant LFO" - Introduce a Formant LFO with rate and depth controls for dynamic rhythmic Wah-Wah effects on TTS vowels. (Implemented in FormantShifter and SamplerPanel!)
* [x] **Idea:** "Step-Sequenced Formant LFO" - Allow individual steps to override the global Formant LFO rate and depth for highly articulated rhythmic sequences.
* **Idea:** "Custom Waveform LFO" - Allow users to draw custom LFO shapes for formant and freeze modulation.
* **Idea:** "Glissando/Portamento Curve Drawing" - Allow users to draw custom pitch curves between steps, rather than just a linear glide.
* [x] **Idea:** "Phoneme-Aware Velocity" - Automatically adjust the amplitude envelope attack/decay based on the phoneme type (e.g., plosives get faster attack, vowels get smoother attack). (Implemented via dynamic envelope overrides in `SingingVoice.ts`!)
* [x] **Idea:** "Spectral Morphing" - Implement functionality to morph spectrally between two different TTS phonemes or samples over a sequence of steps. (Implemented via FormantShifter Voice Character Morphing and step-sequenced automation!)
* [x] **Idea:** "Phoneme-Aware Velocity" - Automatically adjust the amplitude envelope attack/decay based on the phoneme type (e.g., plosives get faster attack, vowels get smoother attack). (Implemented via dynamic envelope scaling in `triggerSlice`!)
* **Idea:** "Dynamic Reverb" - Allow users to draw automation curves for reverb send per step.

---

## 📜 Changelog
* [2026-06-17] - Implemented Spectral Morphing: Added `characterMorph` and `morphTarget` to allow smooth interpolation between voice characters (e.g., male to female) per sequence step using `FormantShifter.ts`. Added Morph knob and target selector to `SamplerPanel.tsx` and override controls to `NoteSelector.tsx`.
* [2026-06-16] - Implemented Phoneme-Aware Velocity: Modified `triggerSlice` in `SingingVoice.ts` to dynamically scale the amplitude envelope attack and decay based on the `phoneme.category` parameter (e.g., extremely fast attack for plosives, smoother attack for vowels). Added new Innovation Lab idea: Spectral Morphing.
* [2026-03-31] - Implemented Phoneme-Aware Velocity: Modified `SingingVoice.ts` and `triggerSlice` to dynamically scale the envelope attack and decay based on the `phoneme.category` properties (e.g. extremely fast attacks for plosives, smooth for vowels) for more natural articulated vocal rendering. Added new idea: Voice Layering / Chorus per Voice.
* [2026-06-15] - Implemented Step-Sequenced Vibrato: Added `vibratoDepth` controls to the `NoteSelector` component and wired them into `App.tsx` and `useAudioEngine.ts` to allow per-step overrides of the global Vibrato Depth for natural phrasing. Added new ideas: "Glissando/Portamento Curve Drawing" and "Phoneme-Aware Velocity".
* [2026-06-14] - Implemented Step-Sequenced Formant LFO: Added `formantLfoRate` and `formantLfoDepth` controls to the `NoteSelector` component and wired them into `App.tsx` and `useAudioEngine.ts` to allow per-step overrides of the global Formant LFO settings for dynamic, rhythmic Wah-Wah effects. Added new idea: Custom Waveform LFO.
* [2026-06-13] - Implemented Vocal Formant LFO: Added `formantLfoRate` and `formantLfoDepth` to `FormantShifter.ts`, routing an internal oscillator to the detune parameters of the peaking filters to create a rhythmic Wah-Wah effect. Added UI controls to `SamplerPanel.tsx`. Fulfills the "Vocal Formant LFO" Innovation Lab idea. Added new idea: Step-Sequenced Formant LFO.
* [2026-06-12] - Implemented Chord Evolving: Added 'Chord Inversion' automation parameter allowing users to draw curves that dynamically shift the inversions of chords per step for synth and bass tracks, fulfilling the Chord Evolving Innovation Lab idea.
* [2026-06-11] - Implemented Global Lyric Track: Replaced `LyricMapper` dialog with a dedicated `LyricTrack` component in `App.tsx`. Text generation now automatically maps syllables/words to consecutive active notes in the sequence using `sliceIndex`, fulfilling the Lyric Track Innovation Lab idea.
* [Date] - Implemented Dynamic Tremolo Effect: Exposed Tremolo Rate and Depth knobs to the `SamplerPanel` UI and mapped them through `useAudioEngine.ts` and `SingingVoice.ts` down to the `RubberBandProcessor` AudioWorklet to allow dynamic amplitude modulation for rhythmic pulsing effects on vocals.
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
* [Date] - Roadmap re-initialized for long-term recursion.
* [Date] - Implemented Vocal Envelope: Added Attack/Release envelope controls to `ExpressiveVoiceProcessor` and exposed them to `SamplerPanel` to allow softer vocal attacks and prevent clicks on rapid retriggering. Improved `SingingVoice.ts` precise noteOff timing handling via absolute target times.
* [Date] - Implemented Glitch Mode UI: Added probability knob for random TTS retriggers.
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

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

### Domain C: Accessibility & Mobile
- [x] **Touch Targets:** Audit `Sequencer.tsx` click listeners to ensure mobile drag-to-create works smoothly.
- [ ] **A11y Colors:** Verify high-contrast separation between `synth-1` (Chords) and `synth-2` (Lead) notes.

---

## 🧠 Innovation Lab (The "Dream" Log)
*These are concepts to be fleshed out by the agent during "Architect Mode".*

* **Idea:** "Lyric Track" - A global text input that automatically distributes syllables across selected MIDI notes.
* **Idea:** "Choir Stack" - Using Polyphony to detune the TTS voice slightly on 3 channels to create a chorus effect. (Implemented via Polyphonic Singing update!)
* **Idea:** "Gesture Controls" - Implement pinch-to-zoom for the sequencer timeline to handle longer patterns or finer steps.
* **Idea:** "Formant Automation" - Draw curves for formant shift over time (not just per step) for continuous vowel morphing.
* **Idea:** "Per-Step Reverse" - Allow reversing the TTS sample on a per-step basis for creative rhythmic effects.

---

## 📜 Changelog
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

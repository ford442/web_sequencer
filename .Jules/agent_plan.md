# Agent Plan

## Active Backlog
- [x] Implement Phoneme-driven auto-rhythm generation for TTS
- [x] Add granular random jitter per phoneme
- [x] Add multi-voice unison detune
- [ ] Optimize TTS memory footprint
- [x] Add granular synthesis window shape control for TTS playback
- [x] Implement per-phoneme granular synthesis grain size control
- [ ] Could we create a visually interactive overlay on the sequencer for modifying TTS granular envelope shapes directly per note?

## Innovation Lab
- [x] What if we could link voice affinity directly to WebGPU/WASM buffers, preventing redundant host-to-device memory copies on voice steal?
- [x] Implement reverse TTS sample per step
- [x] Implement Phoneme Envelope shaping per step
- [x] Implement Expressive Note Transitions for Vowels

- [x] Optimize TTS memory footprint
- [x] Implement Lyric Track parsing
- [x] Implement Vowel-Preserving Time Stretch for TTS voices
- [x] Implement per-phoneme pitch drift/vibrato
- [x] Add Formant Modulation LFO
- [x] Add Formant Glide per phoneme
- [ ] Add granular random jitter per phoneme
- [x] Optimize Voice Manager state syncing
- [x] Add granular synthesis window shape control for TTS playback
- [x] What if we could apply an LFO to the TTS formant shift directly from the step sequencer?

## Refactoring Roadblocks
- [x] Ensure all VoiceManagers (e.g., VoiceManager, SingingVoiceManager) use similar logic patterns for acquiring/releasing/stopping voices to prevent unexpected UI/Audio desync issues.
- Now that VoicePool centralizes state syncing, consider abstracting fallback engine management from VoiceManager into a general sub-manager.
- What if we explored a true zero-allocation path for TTS Voice scheduling using RingBuffers directly from the sequencer?

## Architecture Review
- Completed the "Optimize Voice Manager state syncing" task by removing the redundant `activeVoices` map in `SingingVoiceManager` and relying entirely on the base `VoicePool` class implementation (`activeIndices`, `startTimes`). This reduces memory allocations and aligns with the generic pool structure constraint.
- Velocity Check: Refactoring went smoothly. The architecture is much cleaner without duplicate voice maps. Also completed linking voice affinity directly to WebGPU/WASM buffers to prevent redundant host-to-device memory copies by correctly providing a bankId to `acquireVoiceForBank`.
- Completed the "Implement per-phoneme granular synthesis grain size control" task from the Innovation Lab backlog by adding `grainSize` and `formantShift` fully to `PhonemeData`, updating the `PhonemeAligner` SharedArrayBuffer stride to 10, and modifying the `RubberBandProcessor` AudioWorklet to natively read and apply the `grainSize` parameter during FREEZE stream synthesis.
- Moved two ideas from the Innovation Lab into the Active Backlog to ensure the pipeline stays full.
- Velocity Check: Adding new per-phoneme parameters is well-documented and straightforward due to the clean separation between main thread Web Audio API (formants) and AudioWorklet (grain/pitch).

## Roadmap

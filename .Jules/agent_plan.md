# Agent Plan

## Active Backlog
- [x] Implement Phoneme-driven auto-rhythm generation for TTS
- [x] Add granular random jitter per phoneme
- [x] Add multi-voice unison detune
- [ ] Optimize TTS memory footprint
- [x] Add granular synthesis window shape control for TTS playback
- [x] Implement per-phoneme granular synthesis grain size control
- [x] Could we create a visually interactive overlay on the sequencer for modifying TTS granular envelope shapes directly per note?
- [x] What if we could modulate the grain size with an LFO or envelope to create "breathing" textures?


## Innovation Lab
- [x] What if we could link voice affinity directly to WebGPU/WASM buffers, preventing redundant host-to-device memory copies on voice steal?
- [x] Implement reverse TTS sample per step
- [x] Implement Phoneme Envelope shaping per step
- [x] Implement Expressive Note Transitions for Vowels
- [x] Explore spectral panning per grain to create a wide stereo field for TTS voices.
- [x] Explore multi-band spectral compression for the TTS output

- [x] Optimize TTS memory footprint
- [x] Implement Lyric Track parsing
- [x] Implement Vowel-Preserving Time Stretch for TTS voices
- [x] Implement per-phoneme pitch drift/vibrato
- [x] Add Formant Modulation LFO
- [x] Add Formant Glide per phoneme
- [x] Optimize Voice Manager state syncing
- [x] Add granular synthesis window shape control for TTS playback
- [x] What if we could apply an LFO to the TTS formant shift directly from the step sequencer?

- [x] Explore overlapping stereo grains (true OLA instead of one looped grain)
- [ ] Explore linking grain pan to phoneme voicing (vowels wider than consonants) without a new SAB field

## Innovation Lab
- [ ] Experiment with non-linear grain panning (e.g. spiral LFO paths for spectral bands during freeze)
- [ ] Evaluate real-time cross-synthesis by injecting a secondary ringbuffer signal into the granulator envelope

## Refactoring Roadblocks
- [x] Ensure all VoiceManagers (e.g., VoiceManager, SingingVoiceManager) use similar logic patterns for acquiring/releasing/stopping voices to prevent unexpected UI/Audio desync issues.
- Now that VoicePool centralizes state syncing, consider abstracting fallback engine management from VoiceManager into a general sub-manager.
- What if we explored a true zero-allocation path for TTS Voice scheduling using RingBuffers directly from the sequencer?

## Architecture Review
- Completed the "Optimize Voice Manager state syncing" task by removing the redundant `activeVoices` map in `SingingVoiceManager` and relying entirely on the base `VoicePool` class implementation (`activeIndices`, `startTimes`). This reduces memory allocations and aligns with the generic pool structure constraint.
- Velocity Check: Refactoring went smoothly. The architecture is much cleaner without duplicate voice maps. Also completed linking voice affinity directly to WebGPU/WASM buffers to prevent redundant host-to-device memory copies by correctly providing a bankId to `acquireVoiceForBank`.
- Completed the "Implement per-phoneme granular synthesis grain size control" task from the Innovation Lab backlog by adding `grainSize` and `formantShift` fully to `PhonemeData`, updating the `PhonemeAligner` SharedArrayBuffer stride to 10, and modifying the `RubberBandProcessor` AudioWorklet to natively read and apply the `grainSize` parameter during FREEZE stream synthesis.
- Completed "Could we create a visually interactive overlay on the sequencer for modifying TTS granular envelope shapes directly per note?" by adding both a `DrawableLFO` to `SynthGranularEffects` and a `<select>` menu for predefined window shapes. Wired `customWindowShape` and `windowShape` through `playSamplerVoice`, `EffectsControlMixin`, and `RubberBandProcessor`. The custom drawable shape allows per-note granular windowing control while predefined shapes provide quick presets. The AudioWorklet handles both Float32Array shapes and numeric shape indices gracefully.
- Moved ideas from the Innovation Lab into the Active Backlog and added new ideas to ensure the pipeline stays full.
- Velocity Check: Working with `DrawableLFO` and the message passing infrastructure proved robust for exposing complex array modulations. Per-note granular control is now directly accessible from the sequencer UI overlays.
- Completed "What if we could modulate the grain size with an LFO or envelope to create breathing textures?" by adding a `grainLfoPhase` calculation right after the existing `freezeLfoPhase` logic in the `RubberBandProcessor` AudioWorklet. This feeds an LFO modulation scalar directly into the `baseGrainSize` calculation.
- Added a new idea to the Innovation Lab: "Explore multi-band spectral compression for the TTS output".
- Velocity Check: Wiring up LFO parameters is becoming increasingly streamlined as the boilerplate (params -> types -> UI hooks) is well-established. Performance is well-preserved by calculating the LFO per-block (`framesInBlock`) rather than per-sample in the hot loop.
- Completed "Explore multi-band spectral compression for the TTS output" by implementing a lightweight 3-band dynamics processor in the `RubberBandProcessor`. We avoided a heavy true STFT magnitude compressor and instead used per-sample SVF (1-pole approx for ~300Hz and ~3kHz crossovers) with fast envelope followers (1-5ms attack, 40-80ms release). The output uses downward/upward compression with a dry/wet mix. It is strictly bypassed when the parameter `spectralCompression` is 0 to ensure zero overhead otherwise.

- Completed "Explore spectral panning per grain to create a wide stereo field for TTS voices" by implementing a latch-based spectral pan per grain in the `RubberBandProcessor`. The panning is applied to 3 SVF bands (Low, Mid, High) after the mono retrieval. Constant-power L/R panning multipliers are calculated and held per grain cycle when `grainPanSpread` > 0.
- Velocity Check: Utilizing a sticky `grainWrapPending` latch set during the FREEZE input loop and consumed during output retrieval successfully decouples the grain schedule from the RubberBand latency, providing a stable stereo field without dropping the time-stretch functionality.
- Completed "Explore overlapping stereo grains (true OLA instead of one looped grain)" by modifying the `RubberBandProcessor` granulator input logic. Replaced the single `freezePhase` with an array of two active grain states. A secondary grain is dynamically activated when the primary grain crosses its 50% boundary. Overlapped grains are summed directly into the input heap utilizing standard Window functions (Hann/Hamming) which preserve unity gain.
- Velocity Check: OLA logic cleanly integrates with the existing RubberBand input pointer stream, significantly improving the smoothness of the spectral freeze effect. The spectral pan latching was updated to only trigger on primary grain completion to avoid rapid stereo flutter.

## Roadmap
- Completed "Explore multi-band spectral compression for the TTS output". I added `spectralComp` to `RubberBandProcessor` using a 3-band SVF filter structure (Chamberlin method) with envelope followers and custom gain reduction stages. Wired the parameter through state managers and hooks, and added a UI slider to the synth granular effects overlay for direct sequencing capability.

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
- [x] Explore non-linear envelope shapes for the granular synthesis window (e.g. exponential vs linear curves)


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
- [x] Explore linking grain pan to phoneme voicing (vowels wider than consonants) without a new SAB field

## Innovation Lab
- [ ] Experiment with non-linear grain panning (e.g. spiral LFO paths for spectral bands during freeze)
- [ ] Evaluate real-time cross-synthesis by injecting a secondary ringbuffer signal into the granulator envelope
- [x] What if we mapped TTS syllable volume directly to filter cutoff in the granular engine?
- [x] Explore generating dynamic sub-harmonics for TTS vowels to add body/presence to synthesized speech.
- [x] What if we added a subtle saturation stage exclusively to the generated sub-harmonic signal to make it cut through mix buses better on smaller speakers?
- [x] Explore a TTS vocal stack chorus effect using post-retrieve micro-delay taps.
- [ ] Investigate envelope follower ducking for sidechain effects (Needs cross-engine wiring, e.g. inputs[1] or SAB from drum path, do not use local vocal envelope).

- [ ] Investigate dynamic EQ ducking during vocal synthesis to prevent sub-harmonic and spectral comp masking from fighting against heavy basslines.
- [ ] Investigate envelope follower ducking in the granular engine for sidechain effects based on percussive hits.
- [x] What if we linked granular playback speed directly to the LFO rate, allowing the playback position to oscillate?
- [ ] Explore non-linear mapping for the envelope follower driving ducking in the granular engine
- [ ] Investigate reverse-playback buffer wrapping for granular streams allowing continuous ping-pong looping of arbitrary grain segments.
- [ ] What if we applied spectral morphing based on the phoneme transition matrix to smoothly interpolate between distinct TTS syllables?

## Refactoring Roadblocks
- [x] Ensure all VoiceManagers (e.g., VoiceManager, SingingVoiceManager) use similar logic patterns for acquiring/releasing/stopping voices to prevent unexpected UI/Audio desync issues.
- Now that VoicePool centralizes state syncing, consider abstracting fallback engine management from VoiceManager into a general sub-manager.
- What if we explored a true zero-allocation path for TTS Voice scheduling using RingBuffers directly from the sequencer?

## Architecture Review
- Completed "What if we mapped TTS syllable volume directly to filter cutoff in the granular engine?" by applying a 1-pole IIR lowpass filter to the combined grain output in the `RubberBandProcessor`. Muffled syllables (lower volume) exponentially map to a lower cutoff frequency, creating a dynamic dampening effect for speech.
- Velocity Check: Moving the cutoff calculation outside the inner granular loop fixed the initial performance regression where filter state sharing and heavy Math operations were causing audio artifacts. The current approach is computationally cheap and correctly isolates states.
- Completed "What if we linked granular playback speed directly to the LFO rate, allowing the playback position to oscillate?". Implemented `posMod` inside the `RubberBandProcessor` freeze logic to modulate the `grainCenterActive`. Wired the `grainPosOscillation` parameter up through the AudioWorklet into the Sampler UI and granular note effect properties.
- Velocity Check: By isolating the offset modification strictly within the `initGrain` loop for freeze streaming, we safely avoided smearing the Rubber Band real-time stretchy processor which avoids latency hunting artifacts.
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
- Completed "Explore linking grain pan to phoneme voicing (vowels wider than consonants) without a new SAB field" by utilizing the existing `isVowel` flag from the `PhonemeData` buffer (already available at `baseIndex + 2`). This was threaded up to the spectral panning logic to dynamically reduce the pan spread by 70% during consonants, creating a much more natural stereo image for speech.
- Velocity Check: Passing `isVowel` through the worklet's getter function avoided any new allocations or buffer expansions. Adding the 8th tuple item was clean and the performance impact is zero since it's only evaluated once per grain wrap.


- Completed the task: "What if we could apply an LFO to the TTS formant shift directly from the step sequencer?"
  - Built a robust FormantModulator topology directly inside `FormantShifter.ts`.
  - Refactored `FormantShifter.ts` to lazily construct the Biquad filter chain and LFO nodes using `ensureFilterChain()`.
  - Modified `disconnect()` so it unplugs inputs and outputs without destroying the internal filter chain and LFO, resolving the issue where modulations were lost upon note re-triggers.
  - Dynamically scaled minimum peak gains for Formant filters using `Math.max(Math.abs(semitonesShift) * 2, this.lfoDepth * 8)` ensuring the LFO sweep is richly audible even when the static shift is neutral (0).
- Velocity Check: Diagnosing the graph lifecycle proved crucial. Moving away from tearing down graph topologies on every trigger toward a patch-cable `disconnect` pattern is much healthier for continuous polyphonic modulations.
- Completed "What if we added a subtle saturation stage exclusively to the generated sub-harmonic signal to make it cut through mix buses better on smaller speakers?". Modified the `RubberBandProcessor` to apply a simple and efficient soft clipper to the generated sub-octave bass tone right after the low pass filter. This introduces harmonic saturation while keeping the cost extremely low.
- Velocity Check: The soft clipper is inexpensive to compute inside the worklet since we are using `x / (1.0 + abs(x))`. It successfully broadens the spectral presence of the sub-harmonic on devices with poor low-frequency reproduction. Added new ideas to the Innovation Lab.
- Completed "What if we mapped TTS syllable volume directly to filter cutoff in the granular engine?". Implemented a 1-pole low pass filter in `RubberBandProcessor` where the cutoff frequency maps dynamically between 400Hz and 8000Hz based on the `pVol` read from the phoneme stride buffer. Scaled depth based on whether it is a vowel (`isVowel`) so consonants don't lose clarity. Wired parameter up to UI.
- Velocity Check: Utilizing a 1-pole LPF correctly placed after amplitude multiplication and before the 3-band spectral split effectively avoided conflicting with the multi-band compressor. Applying smoothing on `targetCutoff` completely eliminated zipper noise across phoneme transitions.

- Completed "Explore a TTS vocal stack chorus effect using micro-delayed grains". To preserve the inner granular freeze loop budget, the chorus was implemented as a post-retrieve stereo tap delay instead of an additional freeze grain. Added `vocalChorus` parameter. It introduces micro-delays (7-23ms) with unipolar block-rate LFOs and constant power stereo imaging. Consonants receive a 70% reduction in wet mix to avoid smearing transients, relying entirely on the existing `isVowel` SAB property.
- Velocity Check: Strict early-out bypass guarantees zero CPU cost when `vocalChorus === 0`. The DSP takes advantage of block-rate evaluation for LFO increments to avoid per-sample overhead.

- Completed "Explore non-linear envelope shapes for the granular synthesis window (e.g. exponential vs linear curves)". Added Gaussian and Sharp Exponential shapes to `RubberBandProcessor` logic. Exposed the shapes via `windowShape` values 4 and 5 in the `RubberBandProcessor` parameter descriptor and the UI dropdowns (`SamplerKnobControls.tsx` and `SynthGranularEffects.tsx`).
- Velocity Check: Using mathematically straightforward algorithms for non-linear windowing preserves the audio thread performance budget without allocating massive new arrays.

## Roadmap
- Completed "Explore a TTS vocal stack chorus effect using micro-delayed grains". Implemented as a post-retrieve stereo tap-delay chorus with `isVowel` dynamic wet balancing and strict 0-bypass, wired up to UI knobs and sequenced overlays via the `vocalChorus` parameter.
- Completed "What if we added a subtle saturation stage exclusively to the generated sub-harmonic signal...". I added an inexpensive soft-clipper to the sub-bass signal path inside the AudioWorklet before mixing it back with the dry signal.
- Completed "Explore multi-band spectral compression for the TTS output". I added `spectralComp` to `RubberBandProcessor` using a 3-band SVF filter structure (Chamberlin method) with envelope followers and custom gain reduction stages. Wired the parameter through state managers and hooks, and added a UI slider to the synth granular effects overlay for direct sequencing capability.
- Completed "Explore linking grain pan to phoneme voicing". Added dynamic reduction of `grainPanSpread` during consonants in `RubberBandProcessor` by passing `isVowel` from the phoneme SAB up to the spectral pan generator.
- Completed "Explore generating dynamic sub-harmonics for TTS vowels to add body/presence to synthesized speech". Added a new zero-crossing sub-octave divider circuit directly in the `RubberBandProcessor` AudioWorklet hot path. The divider triggers exclusively when the `isVowel` flag from the `PhonemeData` shared array buffer is active, tracking zero crossings to synthesize a square wave one octave down. This is then smoothed by a 2-pole low pass filter (cutoff ~80Hz) to produce a clean, deep sine-like sub bass tone that follows the original vocal pitch perfectly. Added a "Sub Bass" UI slider to sequencer properties to control the blend amount. UI/state wiring landed; worklet existed earlier. Velocity check: thin vertical slice, same shape as `spectralComp`.
- Completed "What if we mapped TTS syllable volume directly to filter cutoff in the granular engine?". Added a new `phonemeFilterMod` parameter that applies a simple 1-pole Low-Pass Filter to the grain output path. The cutoff frequency scales dynamically with the phoneme volume `pVol`, making louder syllables sound brighter and softer syllables sound darker. The parameter is exposed via the UI for sequencing.
- Completed "Explore generating dynamic sub-harmonics for TTS vowels to add body/presence to synthesized speech". Added a new zero-crossing sub-octave divider circuit directly in the `RubberBandProcessor` AudioWorklet hot path. The divider triggers exclusively when the `isVowel` flag from the `PhonemeData` shared array buffer is active, tracking zero crossings to synthesize a square wave one octave down. This is then smoothed by a 2-pole low pass filter (cutoff ~80Hz) to produce a clean, deep sine-like sub bass tone that follows the original vocal pitch perfectly. Added a "Sub Bass" UI slider to sequencer properties to control the blend amount.

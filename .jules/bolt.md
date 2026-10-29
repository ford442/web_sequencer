## 2024-05-24 - [Avoid TypedArray.subarray() in high-frequency loops]
**Learning:** In the `RingBuffer` (and other high-frequency audio/worker communication paths), using `TypedArray.prototype.subarray()` in combination with `.set()` allocates a new TypedArray view object on the heap for every block. In a real-time context (like `AudioWorklet`), this creates significant per-block garbage collection pressure that degrades the real-time audio budget and can lead to audio dropouts.
**Action:** Replace `.subarray()` calls with explicit `for` loops for data copying in high-frequency, performance-critical paths (e.g., inside `push` and `pull` methods) to completely avoid TypedArray view allocation.
## 2024-11-25 - Avoid Event-Rate Optimizations for GC in AudioWorklets
**Learning:** Not all `push()` or array allocations in an `AudioWorklet` are created equal. Trying to replace rare event-driven arrays (like `noteOnTimes` or throttled message queues) with circular buffers is a waste of time and does not measurably improve the real-time audio budget. The critical path for GC optimization is eliminating allocations that happen *every quantum* (e.g. 128 samples, ~375Hz) or every FFT hop.
**Action:** When hunting for GC optimization targets, explicitly verify whether the allocating code block runs continuously on the `process()` hot-path or only during infrequent user events. Only optimize the continuous allocations by pre-allocating scratch objects at the class level and mutating them.
## 2024-12-05 - Avoid array allocations inside DSP sample loops
**Learning:** In `spectralEffects.ts`, the DSP loop was allocating a new array (`const bands = [low, mid, high]`) for every single sample when spectral compression was active. At 48kHz, this meant 48,000 arrays allocated per second per voice, causing massive GC pressure and degrading real-time audio budget. The fix was to pre-allocate a class-level `scratchBands` Float32Array and mutate it in place. Additionally, `Math.exp()` constants for compression were computed per-sample instead of being hoisted out of the loop.
**Action:** When writing or refactoring per-sample DSP loops in AudioWorklets, never allocate new arrays or objects. Always use pre-allocated class properties (e.g., `this.scratchBands`) and mutate them. Hoist all math that depends only on the sample rate (like attack/release coefficients) outside the loop to the block level.
## 2024-12-05 - Avoid Redundant Linear Lookups in AudioWorklet Hot Paths
**Learning:** In `RubberBandProcessor`, calling `this.getPhonemeDataAtSample()` multiple times per quantum for various DSP effects executed an O(N) array search every time, compounding GC pressure (from property access) and CPU budget overhead. Because `currentSamplePtr` is constant outside of the streaming phase, redundant evaluations for individual effects are completely unnecessary.
**Action:** Evaluate `getPhonemeDataAtSample` once at the beginning of the `process()` function (for setup logic) and update it once immediately after `currentSamplePtr` advances. Cache this tuple in a local block-scoped variable and use it for all downstream DSP checks.

## 2024-12-07 - Optimize Math & Array Allocations in AudioWorklet Hot Paths
**Learning:** Per-quantum allocations (`this.sampleRate` fallback) and block-level loops with expensive transcendental operations (`Math.pow`, `Math.log10`, `Math.sin`) degrade real-time performance. Additionally, multiple modules redundantly calling `getPhonemeDataAtSample` wastes CPU cycles via O(N) array lookups.
**Action:**
1. Cache per-quantum constants (like `this.sampleRate`) instead of re-evaluating inline.
2. Hoist transcendental calculations out of the per-sample loop in `Bitcrusher`, `SpectralBandProcessor`, and `PhonemeToneFilter`. Algebraic simplification (combining logs) allows removing operations.
3. Replace block loops simulating exponential curves with `Math.pow()` direct calculations.
4. Introduce pre-computed `Float32Array` lookup tables with linear interpolation for window shapes in `GranularEngine`.
5. Call `getPhonemeDataAtSample` only once per audio quantum block and pass the resulting tuple (`pData`) through `FrozenGrainParams` and to sub-processors to eliminate redundant scans.

## 2024-12-07 - Pre-compute window shapes in GranularEngine
**Learning:** In `granularEngine.ts`, the DSP loop was calculating window shapes using expensive transcendental math (`Math.cos`, `Math.exp`, `Math.pow`, `Math.sin`) per sample and per active grain. This was happening up to 2 times per sample frame, degrading real-time performance on the audio thread.
**Action:** Replace these expensive per-sample calculations with pre-computed `Float32Array` lookup tables and fast linear interpolation, hoisting the transcendental math out of the hot path to module-load time.

## 2024-12-07 - Pre-allocate object pools for events in AudioWorklet hot paths
**Learning:** Appending to an array (using `push()`) or creating object literals inside an AudioWorklet's `process()` path (e.g., when accumulating pending artifacts for batched reporting) allocates memory per quantum or per event on the hot path. This creates continuous GC pressure that can degrade real-time audio budget, especially if artifacts are detected frequently.
**Action:** Replace `Array.push()` logic with a pre-allocated fixed-size object pool (e.g., `pendingArtifactsPool: Array.from({ length: 32 }, ...)`) tracked by a counter (`pendingArtifactsCount`). Mutate the primitive fields of the pre-allocated objects in place, and only slice the active elements when sending `postMessage` batch reports (which happens at a lower interval, not per quantum).

## 2024-12-10 - Optimize Exponential Decay Loops in AudioWorklets
**Learning:** In AudioWorklets, block-level exponential decay loops (e.g., `for (let i = 0; i < blockFrames; i++) { this.env *= releaseMult; }`) that don't depend on per-sample signal data needlessly consume CPU cycles on the hot path (O(N) operation per quantum). These empty DSP loops can be mathematically simplified to O(1) using `Math.pow()`.
**Action:** Replace O(N) exponential decay loops with an O(1) operation (e.g., `this.env *= Math.pow(releaseMult, blockFrames)`) to reduce unnecessary CPU overhead on the real-time audio thread.

## 2024-12-10 - Optimize Modulo, Math.floor, and Transcendentals in AudioWorklet Loops
**Learning:** Inside per-sample DSP loops (like `ExpressiveVoiceProcessor.ts`), modulo operators (`%`), `Math.floor`, and transcendental functions (`Math.sin`) consume a measurable amount of the CPU budget. The overhead compounds quickly at 44.1kHz when multiple modulations (vibrato, tremolo, gate, delay buffers) are active simultaneously.
**Action:** Replace modulo operators with explicit bounds checks (`if (++idx >= length) idx = 0`). Replace `Math.floor` with bitwise OR (`value | 0`). Replace `Math.sin` with a module-level pre-computed lookup table (e.g. `Float32Array`) and linear interpolation (`fastSin`).

## 2024-12-11 - Cache Invariant Transcendental Math in AudioWorklets
**Learning:** In AudioWorklet DSP modules (e.g., `TransientShaper`, `DrumDuckEnvelope`, `VocoderEffect`), variables like envelope release multipliers are often calculated using `Math.exp()` and `Math.pow()` inside the `process()` hot path every quantum (128 samples). Since these values often only depend on `sampleRate` or a static parameter, recomputing them every block wastes CPU cycles.
**Action:** Cache these invariant values as class properties. Use a check like `if (sampleRate !== this.cachedSampleRate)` to only recalculate them on instantiation or when the underlying constants actually change, completely eliminating `Math.exp` and `Math.pow` from the continuous hot path.

## 2025-01-20 - Extract Array Property Accesses from DSP Inner Loops
**Learning:** In AudioWorklet DSP hot paths (per-sample inner loops), repeatedly accessing object properties that are arrays (e.g., `this.eqState.lp[channel]`) incurs significant overhead. For instance, in `DrumDuckEnvelope`, these lookups slowed down the `applyMasterDuck` process substantially because V8 could not easily hoist the array index lookup out of the loop.
**Action:** Extract such properties into block-scoped local variables (e.g., `let lp = this.eqState.lp[channel];`) before entering the per-sample inner loop. Update the local variable inside the loop, and save its final value back to the array property after the loop finishes. This optimizes memory access and drastically improves execution speed.
## 2025-03-03 - [Extract per-channel state in VocoderEffect]
**Learning:** In AudioWorklet DSP hot paths (per-sample inner loops), accessing object properties from arrays (e.g. `this.env[channel]`) adds unnecessary overhead. The properties can be extracted to local variables outside the inner loop to eliminate O(N) array property lookups per quantum on the hot path.
**Action:** Extracted array state variables to local variables before the inner loop, updated them within the loop, and wrote them back to the array afterwards in `src/audio-worklets/rubberband/vocoderEffect.ts`.

## 2025-01-22 - Avoid Unmeasurable Micro-Optimizations in AudioWorklets
**Learning:** Replacing a single `Math.pow()` or `midiToHz(127)` inside `process()` with a cached variable in `PcfProcessor` was rejected because it is a negligible micro-optimization (saving a single O(1) operation every 128 samples). Furthermore, hardcoding `midiToHz(127)` as exactly 20000 instead of computing the true frequency caused an auditory regression.
**Action:** Do not submit PRs for micro-optimizations that have no measurable gain, especially if they risk altering exact math. Only optimize continuous allocations or expensive operations inside the per-sample inner loop, not operations that happen once per 128-sample block unless they are measurably slow.
## 2025-03-03 - [Cache Invariant Transcendental Math in AudioWorklets]
**Learning:** In AudioWorklet DSP modules, variables like envelope multipliers and cutoff frequencies are often calculated using `Math.exp()` and `Math.pow()` inside the `process()` hot path every quantum (128 samples). In `pcf-processor.ts`, `envelopeDecayRate` and `baseCutoff` values were being repeatedly used in `Math.pow` calculations on every block.
**Action:** Extracted these calculations by caching the block decay multiplier (updating it only when `blockSize` or the rate parameter changes) and pre-calculating the static `baseHz` mapped from `baseCutoff` on parameter change. This totally eliminated `Math.pow` calls per-block on the hot path without altering the math.
## 2025-03-03 - Extract array property accesses from DSP inner loops
**Learning:** In AudioWorklet DSP hot paths (per-sample inner loops), accessing object properties from arrays (e.g. `this.fastEnv[channel]`) adds unnecessary overhead. Extracting them to local variables outside the inner loop eliminates O(N) array property lookups per quantum on the hot path, resulting in measurable performance improvements in effects like `TransientExtractor`, `SubHarmonicsEffect`, and `ToneFilters`.
**Action:** Extract array state variables to local variables before the inner loop, update them within the loop, and write them back to the array afterwards in hot loop AudioWorklets to reduce overhead.

## 2024-10-26 - Math.pow vs Math.exp + Math.log in AudioWorklets
**Learning:** In V8, `Math.pow(x, y)` with fractional exponents inside hot DSP loops is extremely slow compared to `Math.exp(y * Math.log(x))`. Microbenchmarks show the latter is nearly twice as fast.
**Action:** When working on AudioWorklet `process` methods or heavily used inner DSP loops, avoid `Math.pow` for fractional exponents and use pre-computed inverse constants with `Math.exp(Math.log())` instead.
## 2024-03-03 - [Object Allocation in AudioWorklet process()]
**Learning:** Returning array literals from helper functions inside the audio-thread `process()` inner-loops (like `renderedVoices()` yielding new `NativeVoiceRef` objects on every call) creates large garbage collection overhead. Since audio blocks are processed very frequently, small objects created per block quickly result in garbage collection pauses which disrupt audio output.
**Action:** Instead of recreating intermediate structs, explicitly maintain and mutate pre-allocated class properties (e.g. tracking index counts into a fixed array of pre-allocated objects).
## 2025-03-03 - Extract array property accesses from DSP inner loops
**Learning:** In AudioWorklet DSP hot paths (per-sample inner loops), accessing object properties from arrays (e.g. `this.buffer[channel]`) adds unnecessary overhead. Extracting them to local variables outside the inner loop eliminates O(N) array property lookups per quantum on the hot path, resulting in measurable performance improvements in effects like `VocalChorusEffect`.
**Action:** Extract array state variables to local variables before the inner loop, update them within the loop, and write them back to the array afterwards in hot loop AudioWorklets to reduce overhead. When working with arrays of statically known sizes like stereo buffers, extract the array reference (e.g. `buffers = this.buffer`) outside the loop and retain standard array lookups inside to maintain robustness.

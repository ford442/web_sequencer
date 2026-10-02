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
## 2024-05-24 - [Avoid TypedArray.subarray() in high-frequency loops]
**Learning:** In the `RingBuffer` (and other high-frequency audio/worker communication paths), using `TypedArray.prototype.subarray()` in combination with `.set()` allocates a new TypedArray view object on the heap for every block. In a real-time context (like `AudioWorklet`), this creates significant per-block garbage collection pressure that degrades the real-time audio budget and can lead to audio dropouts.
**Action:** Replace `.subarray()` calls with explicit `for` loops for data copying in high-frequency, performance-critical paths (e.g., inside `push` and `pull` methods) to completely avoid TypedArray view allocation.

## 2024-12-07 - Optimize Math & Array Allocations in AudioWorklet Hot Paths
**Learning:** Per-quantum allocations (`this.sampleRate` fallback) and block-level loops with expensive transcendental operations (`Math.pow`, `Math.log10`, `Math.sin`) degrade real-time performance. Additionally, multiple modules redundantly calling `getPhonemeDataAtSample` wastes CPU cycles via O(N) array lookups.
**Action:**
1. Cache per-quantum constants (like `this.sampleRate`) instead of re-evaluating inline.
2. Hoist transcendental calculations out of the per-sample loop in `Bitcrusher`, `SpectralBandProcessor`, and `PhonemeToneFilter`.
3. Introduce pre-computed `Float32Array` lookup tables with linear interpolation for window shapes in `GranularEngine`.
4. Call `getPhonemeDataAtSample` only once per audio quantum block and pass the resulting tuple (`pData`) through `FrozenGrainParams` and to sub-processors to eliminate redundant scans.

## 2024-12-07 - Pre-compute window shapes in GranularEngine
**Learning:** In `granularEngine.ts`, the DSP loop was calculating window shapes using expensive transcendental math (`Math.cos`, `Math.exp`, `Math.pow`, `Math.sin`) per sample and per active grain. This was happening up to 2 times per sample frame, degrading real-time performance on the audio thread.
**Action:** Replace these expensive per-sample calculations with pre-computed `Float32Array` lookup tables and fast linear interpolation, hoisting the transcendental math out of the hot path to module-load time.

## 2024-12-07 - Avoid inline object allocations in postMessage calls
**Learning:** In multiple audio worklets (\`open303/engineSelection.ts\`, \`open303/engineSession.ts\`, \`prophecy-processor.ts\`, etc.), inline object literals were being passed to \`this.port.postMessage({ type: '...', data: ... })\`. While \`postMessage\` relies on structured cloning, allocating the literal itself repeatedly (especially in continuous or interval-based paths like \`live-ab-cpu\` reports) causes garbage collection pressure on the audio thread.
**Action:** Pre-allocate a single message object as a class property (e.g. \`private readonly reportMessage = { ... }\`) and mutate its fields before sending it to eliminate per-interval GC allocations, as \`postMessage\` clones the current state synchronously.

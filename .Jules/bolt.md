## 2024-05-18 - AudioWorklet Closure Allocations
**Learning:** Returning closures from helper methods (like `beginProcess() => endProcess`) inside an `AudioWorkletProcessor.process()` loop creates extreme garbage collection pressure, as these closures are allocated on every quantum (128 frames) on the real-time audio thread. At 48kHz, this translates to hundreds of closures per second per active worklet, rapidly degrading the performance budget.
**Action:** Always prefer updating pre-allocated instance fields (`this.t0`, `this.blockFrames`) and exposing separate setup/teardown methods (`beginProcess()`, `endProcess()`) to avoid function allocation on the audio thread hot paths.

## 2024-05-18 - requestAnimationFrame Array Allocations
**Learning:** Allocating typed arrays (e.g. `new Float32Array()`) inside a `requestAnimationFrame` loop creates constant, high-frequency garbage collection on the main thread (60+ times per second).
**Action:** Hoist these array allocations to module level or instance/ref variables, and update their elements in place via indexed assignment.
## 2026-09-14 - Live master limiter 4x detect oversample
**Learning:** The `TruePeakLimiter` was running its true-peak detector at 8x oversampling during live playback, consuming ~13% of the real-time audio thread budget (`masterLoudness` processor). Offline exports strictly require 8x to avoid near-Nyquist inter-sample peak artifacts, but the live pass can safely degrade to 4x.
**Action:** When configuring the live `MasterLoudnessStage`, set `detectOversample: 4` via `LimiterSettings` to significantly reduce the quantum cost without compromising offline render quality.

## 2024-05-18 - AudioWorklet Block-Rate Coefficient Interpolation
**Learning:** Performing transcendental math operations (like `Math.cos` and `Math.sqrt`) inside a per-sample AudioWorklet DSP loop creates significant CPU overhead, especially when modulating parameters like filter cutoffs at audio rate.
**Action:** When smoothing dynamic parameters (like SVF or 1-pole filter cutoffs), compute the start and end values for the block boundary, calculate the required filter coefficients at both boundaries, and linearly interpolate the *coefficients* across the per-sample loop. This removes expensive math from the inner loop while maintaining smooth, zipper-free parameter changes.
## 2026-10-04 - AudioWorklet Allocations inside updateHistory
**Learning:** Returning closures from helper methods and allocating objects and arrays in real-time loops like `ArtifactDetector.updateHistory` or `FFT.forward` causes GC pressure on the audio thread. While optimizing `pendingArtifacts` wasn't useful because it doesn't happen continuously, `updateHistory` does.
**Action:** Used circular buffers with index pointers for `ArtifactHistory`, `fluxHistory`, and `qualityHistory` and prevented `Array.push()` and `Array.shift()`. Stored the returned FFT result object in `this.fftResultObj` and modified `forward()` to mutate and return that object rather than reallocating.
## 2024-05-18 - AudioWorklet time-ordered queue optimization
**Learning:** In AudioWorklet event scheduling (like `parameterQueue.ts` or `triggerQueue.ts`), using `this.pending.push(entry)` followed by `this.pending.sort((a, b) => a.audioTime - b.audioTime)` allocates a new arrow function (closure) and runs a full sort on the audio thread for every scheduled event. This causes unnecessary garbage collection pressure and CPU overhead on a hot path.
**Action:** Use in-place sorted insertion (scanning backwards and inserting with `splice()`) instead of pushing and sorting. This eliminates the closure allocation and takes advantage of the fact that most events are scheduled sequentially, making the backwards scan O(1) in the common case.

## 2026-10-07 - AudioWorklet true-peak mirrored history buffer
**Learning:** The true-peak FIR interpolator inner loop performed a bounds check `if (idx === TAPS_PER_PHASE) idx = 0;` on every multiply-add, causing a significant performance bottleneck (13% of the audio budget).
**Action:** Allocate a history buffer of double the size, write each incoming sample twice (`idx` and `idx + TAPS_PER_PHASE`), and eliminate the bounds check from the inner loop, reducing the detector cost by ~36%.

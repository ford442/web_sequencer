## 2024-05-18 - AudioWorklet Closure Allocations
**Learning:** Returning closures from helper methods (like `beginProcess() => endProcess`) inside an `AudioWorkletProcessor.process()` loop creates extreme garbage collection pressure, as these closures are allocated on every quantum (128 frames) on the real-time audio thread. At 48kHz, this translates to hundreds of closures per second per active worklet, rapidly degrading the performance budget.
**Action:** Always prefer updating pre-allocated instance fields (`this.t0`, `this.blockFrames`) and exposing separate setup/teardown methods (`beginProcess()`, `endProcess()`) to avoid function allocation on the audio thread hot paths.

## 2024-05-18 - requestAnimationFrame Array Allocations
**Learning:** Allocating typed arrays (e.g. `new Float32Array()`) inside a `requestAnimationFrame` loop creates constant, high-frequency garbage collection on the main thread (60+ times per second).
**Action:** Hoist these array allocations to module level or instance/ref variables, and update their elements in place via indexed assignment.
## 2026-09-14 - Live master limiter 4x detect oversample
**Learning:** The `TruePeakLimiter` was running its true-peak detector at 8x oversampling during live playback, consuming ~13% of the real-time audio thread budget (`masterLoudness` processor). Offline exports strictly require 8x to avoid near-Nyquist inter-sample peak artifacts, but the live pass can safely degrade to 4x.
**Action:** When configuring the live `MasterLoudnessStage`, set `detectOversample: 4` via `LimiterSettings` to significantly reduce the quantum cost without compromising offline render quality.

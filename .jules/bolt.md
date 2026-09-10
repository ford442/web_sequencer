## 2024-XX-XX - [Optimize FFT]
**Learning:** Pre-allocating scratch arrays for Float32Array in high frequency tasks like FFT (`forward`, `magnitude`) instead of doing `new Float32Array(...)` significantly reduces garbage collection allocations, preventing CPU spikes on the audio thread. Because AudioWorklet runs continuously, avoiding array creation is crucial.
**Action:** When working on real-time DSP logic (like FFT or ArtifactDetector), pre-allocate typed arrays as properties in the class instead of returning new ones. Be aware that tests might expect fresh arrays, so testing files may need to duplicate the data.

## 2026-09-10 - [Optimize AudioWorklet Return Objects]
**Learning:** Returning inline object literals (e.g., `return { a: 1, b: 2 }`) from AudioWorklet `process()` helpers (like `LiveHighFidGuard.record` or `DrumDuckEnvelope.process`) causes unnecessary garbage collection (GC) pressure inside the hot path. Over time, these allocations pile up and cause GC pauses, degrading the audio performance budget.
**Action:** When a helper function returns multiple values in the audio thread, pre-allocate the return object as a class instance property (e.g., `private readonly result = { a: 0, b: 0 }`) and update/return it in place.

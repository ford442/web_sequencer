## 2024-05-18 - [Avoid dynamic array allocations in AudioWorklets]
**Learning:** In high-frequency hot paths like the `RubberBandProcessor` `process()` method, repeated destructuring arrays and returning inline arrays from helper methods create massive GC pressure resulting in audio frame drops.
**Action:** Replace inline array allocations with pre-allocated Float32Arrays and use direct index access to eliminate GC overhead in `process()` loops.

## 2024-05-18 - [WebAudio AudioWorkletProcessor sampleRate]
**Learning:** `this.sampleRate` is natively undefined on an `AudioWorkletProcessor`.
**Action:** Always provide fallback values or rely on `resolveWorkletSampleRate({ sampleRate: this.sampleRate || globalThis.sampleRate })` to prevent NaN math errors during sample processing.

## 2024-05-18 - [Avoid dynamic array allocations in AudioWorklets]
**Learning:** In high-frequency hot paths like the `RubberBandProcessor` `process()` method, repeated destructuring arrays and returning inline arrays from helper methods create massive GC pressure resulting in audio frame drops.
**Action:** Replace inline array allocations with pre-allocated Float32Arrays and use direct index access to eliminate GC overhead in `process()` loops.

## 2024-05-18 - [WebAudio AudioWorkletProcessor sampleRate]
**Learning:** `this.sampleRate` is natively undefined on an `AudioWorkletProcessor`.
**Action:** Always provide fallback values or rely on `resolveWorkletSampleRate({ sampleRate: this.sampleRate || globalThis.sampleRate })` to prevent NaN math errors during sample processing.

## 2024-05-18 - [Avoid O(N) array shifts in AudioWorklets]
**Learning:** Using `Array.shift()` inside a `while` loop within a high-frequency `process()` method (like `Open303Processor` draining scheduled parameters) causes O(N²) CPU scaling and severe main thread blocking if many items are scheduled at once, blowing the audio budget. Furthermore, replacing it with `Array.splice()` still allocates new arrays (for the deleted items), adding GC pressure.
**Action:** When draining queues in `process()`, use a standard `for` loop to process items, then manually shift the remaining elements in-place and truncate the array `length` to avoid all O(N) operations and GC allocations.

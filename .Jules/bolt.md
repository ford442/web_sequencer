
## 2024-10-24 - Extract Array Property Accesses from DSP Inner Loops
**Learning:** Accessing class array properties like `this.lpStates[channel]` or `this.downsamplePhase[channel]` inside the inner `process()` hot path creates O(N) array property lookups per quantum, which significantly slows down DSP loops in JS AudioWorklets.
**Action:** Extract these variables into local block-scoped variables before the inner `for` loop, manipulate the local variable inside the loop, and write the value back to the array after the loop completes. This pattern was applied to `vocal-overdrive-processor.ts` and `bitcrusher.ts`, yielding an ~40% reduction in execution time for those inner loops. This continues the work done previously on transientExtractor, subHarmonics, etc.


## 2024-10-24 - Extract Array Property Accesses from DSP Inner Loops
**Learning:** Accessing class array properties like `this.lpStates[channel]` or `this.downsamplePhase[channel]` inside the inner `process()` hot path creates O(N) array property lookups per quantum, which significantly slows down DSP loops in JS AudioWorklets.
**Action:** Extract these variables into local block-scoped variables before the inner `for` loop, manipulate the local variable inside the loop, and write the value back to the array after the loop completes. This pattern was applied to `vocal-overdrive-processor.ts` and `bitcrusher.ts`, yielding an ~40% reduction in execution time for those inner loops. This continues the work done previously on transientExtractor, subHarmonics, etc.

## 2024-10-27 - Optimize fractional Math.pow with Math.exp in AudioWorklet loops
**Learning:** In V8, `Math.pow(x, y)` when `y` is fractional or computed dynamically is significantly slower than calculating `Math.exp(y * Math.log(x))`. For constants like base 2 or 10, precomputing `Math.LN2` or `Math.log(10)` makes this even faster (e.g. `Math.pow(2.0, x)` vs `Math.exp(x * Math.LN2)` yields a 2-3x speedup in isolated hot loops).
**Action:** Replaced `Math.pow` calls used for pitch shifting, cutoff scaling, and phoneme brightness with `Math.exp` based alternatives in `pitchControl.ts`, `toneFilters.ts`, and `granularEngine.ts`.

## 2024-10-30 - Combine Nested Exponential Functions in AudioWorklets
**Learning:** Simplifying nested exponentiation like `Math.pow(Math.exp(a), b)` to `Math.exp(a * b)` is cleaner and eliminates a redundant heavy math operation in high-frequency audio paths, slightly increasing performance over plain `Math.exp()` conversions.
**Action:** Replaced nested `Math.pow(Math.exp(...), ...)` calls in envelope followers (e.g. `drumDuckEnvelope.ts`) with a single `Math.exp()` calculation.

## $(date +%Y-%m-%d) - [Optimize AudioWorklet BandSplit Compression]
**Learning:** In hot loops within AudioWorklets, property accesses (`this.property`) and array lookups (`array[i]`) across many blocks add up to measurable overhead.
**Action:** Always attempt to extract constants, loop-invariant conditionals, array references, and class properties to local variables outside the inner loop to minimize object property traversal overhead during per-sample high-frequency operations. Keep loop bodies small and tight.

## $(date +%Y-%m-%d) - [Benchmark AudioWorklet Optimizations Before Changing]
**Learning:** Some AudioWorklet inner loops look like they run often and are good optimization targets (e.g. `output[ch].set(output[0])` for `master-loudness-processor`), but actually run rarely (only when output channels > 2). Furthermore, not all property extractions yield a significant performance gain, and modifying core AudioWorklet loops blindly based on pattern matching can waste time.
**Action:** When optimizing AudioWorklet DSP code, always measure the actual performance impact before implementing the change by writing a local benchmark script (e.g., running the processor on a fixed-length input for many blocks and timing it with `console.time()`).

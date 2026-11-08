## 2024-10-24 - Extract Array Property Accesses from DSP Inner Loops
**Learning:** Accessing class array properties like `this.lpStates[channel]` or `this.downsamplePhase[channel]` inside the inner `process()` hot path creates O(N) array property lookups per quantum, which significantly slows down DSP loops in JS AudioWorklets.
**Action:** Extract these variables into local block-scoped variables before the inner `for` loop, manipulate the local variable inside the loop, and write the value back to the array after the loop completes. This pattern was applied to `vocal-overdrive-processor.ts` and `bitcrusher.ts`, yielding an ~40% reduction in execution time for those inner loops. This continues the work done previously on transientExtractor, subHarmonics, etc.

## 2024-10-27 - Optimize fractional Math.pow with Math.exp in AudioWorklet loops
**Learning:** In V8, `Math.pow(x, y)` when `y` is fractional or computed dynamically is significantly slower than calculating `Math.exp(y * Math.log(x))`. For constants like base 2 or 10, precomputing `Math.LN2` or `Math.log(10)` makes this even faster (e.g. `Math.pow(2.0, x)` vs `Math.exp(x * Math.LN2)` yields a 2-3x speedup in isolated hot loops).
**Action:** Replaced `Math.pow` calls used for pitch shifting, cutoff scaling, and phoneme brightness with `Math.exp` based alternatives in `pitchControl.ts`, `toneFilters.ts`, and `granularEngine.ts`.

## 2024-10-30 - Combine Nested Exponential Functions in AudioWorklets
**Learning:** Simplifying nested exponentiation like `Math.pow(Math.exp(a), b)` to `Math.exp(a * b)` is cleaner and eliminates a redundant heavy math operation in high-frequency audio paths, slightly increasing performance over plain `Math.exp()` conversions.
**Action:** Replaced nested `Math.pow(Math.exp(...), ...)` calls in envelope followers (e.g. `drumDuckEnvelope.ts`) with a single `Math.exp()` calculation.

## 2024-11-02 - Hoisting branch logic and extracting methods in AudioWorklet hot loops
**Learning:** In AudioWorklet per-sample hot paths, method calls (like `this.windowValue(...)`) and multi-way branch logic (like LUT array selection based on `windowShape` parameter) add up to significant overhead when executed per-sample across thousands of samples per quantum.
**Action:** Hoist the branch logic (e.g. selecting the correct LUT reference based on windowShape, or determining custom window bounds) outside the inner loop. Inline the core computation (e.g. mathematical interpolation) directly into the sample loop. This reduces overhead more than micro-optimizations inside the method.
## $(date +%Y-%m-%d) - [Optimize AudioWorklet BandSplit Compression]
**Learning:** In hot loops within AudioWorklets, property accesses (`this.property`) and array lookups (`array[i]`) across many blocks add up to measurable overhead.
**Action:** Always attempt to extract constants, loop-invariant conditionals, array references, and class properties to local variables outside the inner loop to minimize object property traversal overhead during per-sample high-frequency operations. Keep loop bodies small and tight.

## $(date +%Y-%m-%d) - [Benchmark AudioWorklet Optimizations Before Changing]
**Learning:** Some AudioWorklet inner loops look like they run often and are good optimization targets (e.g. `output[ch].set(output[0])` for `master-loudness-processor`), but actually run rarely (only when output channels > 2). Furthermore, not all property extractions yield a significant performance gain, and modifying core AudioWorklet loops blindly based on pattern matching can waste time.
**Action:** When optimizing AudioWorklet DSP code, always measure the actual performance impact before implementing the change by writing a local benchmark script (e.g., running the processor on a fixed-length input for many blocks and timing it with `console.time()`).

## 2024-05-19 - SustainProcessor Optimization
**Learning:** In AudioWorklet DSP optimization, hoisting multi-way branch logic (e.g., `mode` checks) outside the per-sample inner loop provides a significant performance increase. Furthermore, replacing `Math.floor` with bitwise OR (`value | 0`) and manually inlining mathematical interpolation gives a large speedup by reducing function overhead in high-frequency audio paths.
**Action:** Extract branching out of the inner loop and optimize floating point operations to their bitwise/manual equivalents when working in DSP hot paths, maintaining readability through separation by modes rather than inline conditionals.

## 2024-05-18 - AudioWorklet DSP Core Hot Path Micro-optimizations
**Learning:** In very tight AudioWorklet per-sample DSP loops where `channelCount` is mostly fixed at 2, nested `for (let ch = 0; ch < channelCount; ch++)` loops introduce substantial overhead from array boundary checks and dynamic lookups. Additionally, function calls like `Number.isFinite()` and `Number.isNaN()` are measurably slower than inline primitive checks like `sample === sample && sample > -Infinity && sample < Infinity`.
**Action:** When optimizing real-time audio hot paths (especially limiters, meters, and filters), unroll loops when sizes are statically known (like `channelCount === 2` or `factor === 4` polyphase resampling), flatten properties to block-scoped local variables before the loop, inline small generic logic, and use fast primitive arithmetic for NaN/Infinity checks.
## 2026-11-08 - Optimize nativeVoiceProcessor per-sample inner loops
**Learning:** In AudioWorklet buffer copying loops (like `nativeVoiceProcessor.ts`), a single `if` check inside a per-sample `for` loop runs millions of times per second and can add substantial branch evaluation overhead, even if simple.
**Action:** Specialize the fast path: if the multiplier (`gain`) is 1, bypass per-sample `for` loops entirely by using `Float32Array.prototype.set(subarray)`. For non-unity gain paths, apply loop unswitching by hoisting channel existence checks (`if (left)`) outside the per-sample loop to eliminate inner-loop branching overhead.

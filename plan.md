1. **Optimize `SpectralBandProcessor` in `src/audio-worklets/rubberband/spectralEffects.ts`**
   - Replace the expensive `Math.log10(env) - Math.log10(threshold)` with an algebraic equivalent using `Math.pow`.
   - The current code:
     `const over = 20 * Math.log10(env[b]) - 20 * Math.log10(threshold);`
     `const grDb = Math.min(over * (1.0 - 1.0 / ratio), maxGR);`
     `return band * Math.pow(10, -grDb / 20);`
   - can be mathematically simplified to avoid `log10` entirely in the hot loop:
     `const slope = 1.0 - 1.0 / ratio;` (hoisted outside)
     `const maxEnv = threshold * Math.pow(10, maxGR / (20 * slope));` (hoisted outside)
     `const maxGRMultiplier = Math.pow(10, -maxGR / 20);` (hoisted outside)
     Then, inside the hot per-sample loop:
     `if (env >= maxEnv) return band * maxGRMultiplier;`
     `return band * Math.pow(env / threshold, -slope);`
   - This prevents ~3 `Math` calls (`2 x log10`, `1 x pow` vs `1 x pow`) per sample, per band (3 bands total). This provides a massive ~10x speedup for this specific method as demonstrated by the benchmark.

2. **Optimize `DrumDuckEnvelope.applyMasterDuck` in `src/audio-worklets/rubberband/drumDuckEnvelope.ts`**
   - The method computes `const w = 2.0 * Math.sin(Math.PI * centerFreq / sampleRate);` per call. Since `centerFreq = 350.0` is fixed, this only needs to be computed once per block, but we can avoid even doing it per-block if the sampleRate doesn't change by caching it on the class instance, similar to how it's done in `SpectralBandProcessor`.

3. **Verify Changes**
   - Run tests: `pnpm test`
   - Run linter: `pnpm lint`

4. **Add Bolt Journal Entry**
   - Document that simplifying logarithmic/exponential formulas using algebra removes slow transcendental math (`log10`, `pow`, etc.) from AudioWorklet per-sample DSP loops.

5. **Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.**
   - Run the pre commit check script to make sure we're good to submit.

6. **Submit PR**
   - Submit the PR with the title `⚡ Bolt: [AudioWorklet] Simplify transcendental math in hot loops` and detailed impact metrics.

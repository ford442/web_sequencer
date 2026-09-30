1. **Optimize `resolveWorkletSampleRate` in `RubberBandProcessor`**: The function `resolveWorkletSampleRate` is called repeatedly inside the hot `process` loop (multiple times per quantum). This allocates inline objects inline (`{ sampleRate: this.sampleRate || globalThis.sampleRate }`) resulting in unnecessary GC pressure. As specified in `memory`, I should cache the resolved sample rate at the beginning of `process` and reuse it.

2. **Optimize `getPhonemeDataAtSample` in `RubberBandProcessor`**: `getPhonemeDataAtSample` is called multiple times per block (in lines 359, 730, 791, 792, 840), executing an O(N) linear search each time. Since `currentSamplePtr` is constant throughout the output retrieval phase (where these effects are applied), I should evaluate it once at the start of the block and update it once immediately after `currentSamplePtr` advances. I will replace the redundant calls with the cached `pData` tuple.

3. **Pre-commit testing**: Run `pnpm test` and `pnpm lint` and whatever checks are mentioned in `pre_commit_instructions` or AGENTS.md.

4. **Add Bolt learning**: Write a critical learning entry in `.jules/bolt.md` based on what we discovered and optimized.

5. **Submit PR**: Submit the performance optimization with the required format in PR title and description.

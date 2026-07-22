## 2026-07-16 - Hoist closures safely out of real-time audio hot paths
**Learning:** Hoisting closures out of high-frequency paths like `playSamplerVoice` requires careful refactoring, specifically defining the function once at the module level. Repeated use of Python `.replace()` can inadvertently duplicate code blocks when multiple identical matches exist (e.g. `export interface`). If the file gets corrupted during patching, immediately `git checkout main -- <file>` to reset state instead of attempting iterative repairs on corrupted code.
**Action:** In the future, explicitly define hoisted functions with clean parameter maps and use targeted diffs or surgical replacements. Always check the exact matches and count replacements in Python scripts.

## 2026-07-22 - Audio Degrade Policy vs UI Micro-Memoization
**Learning:** In a real-time DAW environment, optimizing user-facing audio processing (like Worklet FFT hop sizes or downstream Web Audio node bypassing via `undefined` parameters) has a far higher ROI than minor React UI memoization (like wrapping drum pads).
**Action:** When acting as Bolt, always prioritize real-time audio constraints, WASM bridge hot loops (`@perf-bottleneck`), or Worklet degradation parameters before attempting to squeeze single-digit component re-renders out of React.

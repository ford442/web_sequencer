## 2024-05-23 - Bug Discovery in audioExport
**Learning:** Found a critical bug in WAV export where reusing a variable `pos` (used for header byte offset) as a sample loop index caused the first 44 samples to be skipped.
**Action:** Always verify variable scope and reuse, especially in "C-style" manual byte writing code. When refactoring/optimizing, check for logical errors in the original code first.

## 2024-05-23 - Environment Dependencies Blocking Frontend Verification
**Learning:** The frontend verification workflow relies on `vite` which might fail if build artifacts (WASM) are missing, even if the component under test is pure React. This blocks visual verification of specific components.
**Action:** In environment-heavy apps, rely on component-level unit tests (like `HardwareModule.test.tsx` which mocks WebGPU/WASM) for verification when full app build is not possible.

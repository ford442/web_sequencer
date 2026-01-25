## 2024-05-23 - Bug Discovery in audioExport
**Learning:** Found a critical bug in WAV export where reusing a variable `pos` (used for header byte offset) as a sample loop index caused the first 44 samples to be skipped.
**Action:** Always verify variable scope and reuse, especially in "C-style" manual byte writing code. When refactoring/optimizing, check for logical errors in the original code first.

## 2024-05-23 - Environment Dependencies Blocking Frontend Verification
**Learning:** The frontend verification workflow relies on `vite` which might fail if build artifacts (WASM) are missing, even if the component under test is pure React. This blocks visual verification of specific components.
**Action:** In environment-heavy apps, rely on component-level unit tests (like `HardwareModule.test.tsx` which mocks WebGPU/WASM) for verification when full app build is not possible.

## 2024-05-24 - React List Performance Trap
**Learning:** In interactive lists (like a keyboard) where only one item changes state at a time, mapping over a large array inside the parent component forces the entire list to re-render. `React.memo` on the parent is useless if the children are not memoized components.
**Action:** Extract the list item into a separate `React.memo` component and ensure event handlers passed to it are stable (using `useCallback` + `useRef` for state access) to isolate updates to the single modified item.

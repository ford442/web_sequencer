## 2024-05-14 - Sequencer React Performance Enhancements
**Learning:** In a highly interactive app where the parent component (`useAppState.tsx`) manages large, deep arrays (like a step sequencer), relying on deep cloning via `JSON.parse(JSON.stringify(state))` creates entirely new references for every array item on every state update. This completely defeats child component memoization (e.g., `React.memo` with strict equality comparators) because React sees a new object reference every single time, leading to full re-renders of massive UI elements like 256-step sequencer grids.
**Action:** When updating a step in a sequencer, only use shallow clones via spread operators for the specific track array and the specific step being modified (`[...prev.steps]`, `{ ...stepData }`). Maintain exact object references for tracks that are not touched. Additionally, in custom `React.memo` comparators dealing with arrays of objects, use shallow array checking helpers instead of `JSON.stringify()`, saving CPU cycles without sacrificing cache correctness.

## 2024-05-16 - Sequencer React Memoization Enhancements
**Learning:** When using immutable update patterns (like shallow cloning) in a parent component, child components wrapped in `React.memo` do not need expensive custom `areEqual` functions that loop through arrays to check for deep equality. The parent's immutable update guarantees that if a change occurred, the array reference itself will be different. Deep array equality checks inside `areEqual` functions for arrays with 256 elements per row add massive, redundant CPU overhead on every render cycle.
**Action:** Replace custom `arraysEqual` loops inside `React.memo` comparators with simple reference equality (`prev.steps === next.steps`). This is vastly faster and correctly detects updates when the parent state management creates new array references for mutations.

## 2024-05-24 - Inner Thrashing in Sequencer Row Component Rendering
**Learning:** Even when `SequencerRow` and `MelodicSequencerRow` are wrapped in `memo` with an optimized `areEqual` function (`prev.steps === next.steps`), they can still suffer from inner thrashing. Because they iterate to create up to 32 `<SvgStep>` or `<MelodicStep>` elements inline on every render cycle, whenever ANY non-excluded prop changes (or context forces a re-render), React must diff 32 potentially deeply nested SVG components per row across 8 rows (256 components).
**Action:** Always wrap the array mapping that produces repeated child elements (like `renderedSteps` loops or `<TrackSlotButton>` loops) in a `useMemo` hook, scoped exactly to the dependencies that affect the visual output of those steps. This ensures React receives the exact same element references and short-circuits the reconciliation process for the steps themselves when the row re-renders for unrelated reasons.
## 2026-05-19 - Component Memoization
**Learning:** Components wrapped with React.memo that take callbacks as props will still re-render if the callbacks are recreated on every render of the parent component. Replacing React.memo with memo and use callbacks helps minimize renders and improve UI fluidity
**Action:** Use memo everywhere where React.memo is used and use useCallback.
## 2026-05-19 - Detach Visual Zoom from React State
**Learning:** Chasing down useMemo/useCallback dependencies for rapidly changing layout props (like zoom) is often a losing battle. Passing  as a prop forced 256 SVG steps per row to re-render constantly during scrolling, crushing the main thread.
**Action:** Bypassed the React render cycle entirely for gestures by imperatively updating a CSS custom property (`--zoom-level`) via `requestAnimationFrame`, and using a debouncer to sync the final zoom value back to React state.
## 2024-05-17 - Detach Visual Zoom from React State
**Learning:** Chasing down useMemo/useCallback dependencies for rapidly changing layout props (like zoom) is often a losing battle. Passing `zoom` as a prop forced 256 SVG steps per row to re-render constantly during scrolling, crushing the main thread.
**Action:** Bypassed the React render cycle entirely for gestures by imperatively updating a CSS custom property (`--zoom-level`) via `requestAnimationFrame`, and using a debouncer to sync the final zoom value back to React state.
## 2026-05-21 - Stabilized Global Context Handlers
**Learning:** Passing unstabilized inline functions through context completely invalidates `React.memo` on all downstream consumer components, leading to massive re-renders.
**Action:** Always wrap global context handlers (like those in `useAppState.tsx`) in `useCallback` with precise dependency arrays before passing them down.
## 2024-05-19 - Component Memoization
**Learning:** Components wrapped with React.memo that take callbacks as props will still re-render if the callbacks are recreated on every render of the parent component. Replacing React.memo with memo and use callbacks helps minimize renders and improve UI fluidity
**Action:** Use memo everywhere where React.memo is used and use useCallback.

## 2025-10-24 - Stable fallbacks for React.memo
**Learning:** Using an inline fallback like `onApply={onApply || (() => {})}` silently defeats `React.memo` on the child component because a new arrow function reference is created on every render.
**Action:** Create a module-scoped constant (e.g. `const noop = () => {};`) and use it as the fallback (`onApply={onApply || noop}`) to ensure a stable reference is passed down, preserving memoization. For functions that require component state, wrap them in `useCallback` with a proper dependency array.

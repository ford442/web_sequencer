## 2024-05-14 - Sequencer React Performance Enhancements
**Learning:** In a highly interactive app where the parent component (`useAppState.tsx`) manages large, deep arrays (like a step sequencer), relying on deep cloning via `JSON.parse(JSON.stringify(state))` creates entirely new references for every array item on every state update. This completely defeats child component memoization (e.g., `React.memo` with strict equality comparators) because React sees a new object reference every single time, leading to full re-renders of massive UI elements like 256-step sequencer grids.
**Action:** When updating a step in a sequencer, only use shallow clones via spread operators for the specific track array and the specific step being modified (`[...prev.steps]`, `{ ...stepData }`). Maintain exact object references for tracks that are not touched. Additionally, in custom `React.memo` comparators dealing with arrays of objects, use shallow array checking helpers instead of `JSON.stringify()`, saving CPU cycles without sacrificing cache correctness.

## 2024-05-16 - Sequencer React Memoization Enhancements
**Learning:** When using immutable update patterns (like shallow cloning) in a parent component, child components wrapped in `React.memo` do not need expensive custom `areEqual` functions that loop through arrays to check for deep equality. The parent's immutable update guarantees that if a change occurred, the array reference itself will be different. Deep array equality checks inside `areEqual` functions for arrays with 256 elements per row add massive, redundant CPU overhead on every render cycle.
**Action:** Replace custom `arraysEqual` loops inside `React.memo` comparators with simple reference equality (`prev.steps === next.steps`). This is vastly faster and correctly detects updates when the parent state management creates new array references for mutations.
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

## 2026-05-25 - Shallow clones for clipboard operations
**Learning:** Using `JSON.parse(JSON.stringify())` to deep clone arrays during clipboard operations (like copy/paste) in a React application with strict immutable state patterns (like a sequencer) creates entirely new object references for *all* items, including those that haven't changed. This breaks `React.memo` on massive repeating components (like sequencer rows) because the parent state sees a completely new array reference, forcing a full re-render of untouched tracks and steps.
**Action:** Replace `JSON.parse(JSON.stringify())` with shallow cloning techniques (e.g., spread operator `...` and `.map()`) in clipboard and state update functions. Ensure that only the specifically modified track or step receives a new object reference, preserving the references of untouched elements so `React.memo` can correctly bypass rendering them.

## 2026-05-25 - Stable fallbacks for React components
**Learning:** Using inline fallback functions, such as `onPitchChange || (() => {})`, as props for child components defeats React's memoization. A new arrow function reference is created on every render, causing the child component to unnecessarily re-render even if its actual dependencies haven't changed.
**Action:** Create a module-scoped constant or a shared utility function (e.g., `export const noop = () => {};` in `src/utils/noop.ts`) and use it as the fallback (e.g., `onPitchChange || noop`). This provides a single, globally stable reference that maintains the integrity of `React.memo`.

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

## 2024-05-24 - JSON.parse(JSON.stringify()) Optimization Pitfall
**Learning:** When trying to optimize performance by removing `JSON.parse(JSON.stringify())` deep clones, do not blindly replace them with shallow clones (like spread operators or `.map`) on global initializer objects, default templates, or version history records. Doing so causes "State Bleed" where deeply nested structures retain references to the global template. If a user modifies an effect config on Track 1, it mutates the global template, thereby breaking Track 2. Additionally, custom mapping logic on complex objects like `VersionHistory` risks data loss by accidentally dropping unmapped fields.
**Action:** Only optimize `JSON.parse` with shallow/immutable updates for hot-path UI event handlers (like `pasteSteps` or track edits) where the specific path being mutated is known and controlled. For cold paths like app initialization or saving, leave the deep clone intact or use `structuredClone()` to guarantee absolute reference detachment.

## 2026-05-26 - Sequencer React Performance Enhancements (useMemo on inner arrays)
**Learning:** In heavily repeated layout components wrapped in `React.memo` (like `SequencerRow`), relying solely on parent memoization isn't enough when arrays of child elements (`renderedSteps`, `TrackSlotButton` arrays) are mapped out inline. Doing so forces inner array regeneration on every transient parent prop change or visual state update that bypasses `React.memo`'s comparator. Custom `areEqual` comparators in `React.memo` that omit callback props to rely on strict object references frequently cause "stale closures," breaking core component interaction.
**Action:** When a parent sequence row passes its custom `areEqual` check, ensure the generated arrays of 32+ SVG inner components are strictly wrapped in `useMemo` hooks, keeping the dependencies bound to exact visual and structural state (like `steps`, `activeSlot`, etc.) rather than inline anonymous functions or constantly updating parent refs. When defining `React.memo` custom `areEqual` functions, you should avoid dropping callback props from the comparison unless the parent guarantees they are absolutely stable (or uses a `useRef` event bus pattern) to prevent stale state references on click events.

## 2024-05-28 - React Memo Comparator Deep Clone Pitfalls
**Learning:** Using `JSON.stringify(prev.props) !== JSON.stringify(next.props)` inside a `React.memo` custom `areEqual` function for small arrays (like a `loadedBanks` boolean array) forces expensive memory allocation and serialization on *every single render cycle*. Even though it "works" to check array content, it adds unnecessary CPU overhead for components that evaluate frequently.
**Action:** Replace `JSON.stringify` comparisons inside memo comparators with a simple array shallow equality check: `prev.arr.length !== next.arr.length || prev.arr.some((val, i) => val !== next.arr[i])`. This achieves the exact same value comparison with significantly lower CPU cost and no garbage collection pressure.

## 2024-05-30 - AudioWorklet GC Thrashes via Object Allocation
**Learning:** Calling `updateConfig({ nested: { value } })` inside an `AudioWorkletProcessor.process()` loop creates new objects every ~3ms (128 samples). This produces intense garbage collection pressure on the audio thread, risking audio dropouts and general CPU bloat, particularly when scaling polyphony or FX instances. Object spreading (`...`) compound this by churning through allocations.
**Action:** Always implement direct setter methods (`setVibrato(rate, depth)`, `setEnvelope()`, etc.) that directly mutate the inner configuration state in high-frequency contexts like AudioWorklets, avoiding fresh objects and deep merges entirely on the hot path.

## 2024-05-30 - Deep Array Comparison in React Memo
**Learning:** Using deep array comparison inside a custom `areEqual` comparator for `React.memo` (like `prevBanks.some((val, i) => val !== nextBanks[i])`) when the parent state management already guarantees immutable updates (via shallow cloning) is redundant and expensive. It adds massive CPU overhead on every render cycle for large components like `SamplerPanel`.
**Action:** Replace custom deep array checks inside `React.memo` comparators with simple reference equality (`prev.loadedBanks !== next.loadedBanks`) when the parent state management correctly creates new array references for mutations.
## 2026-06-09 - AudioWorkletNode Allocation in Hot Paths
**Learning:** Initializing new `AudioWorkletNode` instances directly inside high-frequency note-triggering functions (like `playSamplerVoice`) causes significant GC pressure and potential audio dropouts, as it requires allocating not just JS wrapper objects but full Web Audio graph nodes and background processing structures.
**Action:** Implement and use an `AudioNodePool` to pre-allocate and reuse `AudioWorkletNode` instances (e.g. for distortion and expressive processing). When a note triggers, acquire a node, apply parameters via `parameterData` updates, and safely return it to the pool (with `disconnect` and a `TEARDOWN` message) in the `noteOff` or `setTimeout` handlers.

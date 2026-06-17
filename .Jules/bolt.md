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

## 2026-05-27 - Shallow Update Structural Sharing in Massive Contexts
**Learning:** In a large global state provider (like `useAppState.tsx`), spreading deep object structures (like `[...copy.sampler]`) on hot-path handlers (`handleNoteSelect`, `handlePitchChange`, `handleNotePropertyChange`) creates entirely new array references even when only a single step on a single track changes. This defeats `React.memo` across the board, forcing every other untouched sequencer row (and its 256 internal elements) to needlessly re-render.
**Action:** Use isolated, pure, structural-sharing update helpers (e.g., `updateSamplerStep`, `updateTrackStep`) within `setPattern` callbacks. These helpers surgically clone only the specific array indexes down to the modified step, preserving precise object references for every other track and bank. This guarantees that `React.memo` comparators on massive repeating components correctly short-circuit and bypass rendering for unchanged paths.

## 2024-05-28 - Un-memoized Derived JSX in Modals
**Learning:** Mapping complex data structures directly to large blocks of JSX within a component's render function (especially modals like `AISongModal` with many visual nodes, e.g. 8x32 automation visualization rows) forces React to recalculate and recreate the entire node tree on every minor state update (e.g. dragging a file over, progress bar ticks). Reusing duplicated mappings (e.g., repeating the `Object.entries(trackStats.noteCounts).map` logic inline when it was already available from a `useMemo`) drastically amplifies this issue.
**Action:** Always extract complex array-to-JSX mappings into `useMemo` blocks (or reuse existing ones). Keep the component render path clean by simply referencing the memoized UI components to maintain a lightweight React rendering footprint during parent state changes or fast animations.

## 2024-05-30 - Memoization Defeat by Inline Handlers
**Learning:** Components wrapped with `React.memo` (like `PropertySlider` or custom buttons) will still re-render unnecessarily if the parent component (like `NoteSelector`) passes inline arrow functions (`onChange={(e) => onPropertyChange('prop', e.target.value)}`) or dynamically curried functions as props. This defeats the shallow equality check because a new function reference is created on every render.
**Action:** Instead of passing inline closures or creating many small sub-components, attach a `data-property` attribute to the input/button elements (e.g., `<input data-property="timeStretchEnvDepth" ... />`). Then, create a single, stable `useCallback` event handler that reads the property key dynamically via `e.target.dataset.property` and updates the state. This completely eliminates new function references on the render path and maximizes `React.memo` efficiency.

## 2024-05-19 - Refactoring Large Files (> 1000 lines)
**Learning:** Refactoring massive React components (like `NoteSelector` and modals) by extracting structural UI repetition into adjacent sub-components significantly reduces file size without triggering massive context/prop-drilling refactors. However, highly-coupled stateful services (like `AISongStorage.ts`) and monolithic custom hooks (like `useAudioEngine.ts`) resist simple file extraction due to cascading TypeScript cyclic dependencies.
**Action:** Successfully split 10 out of 12 files over 1000 lines into smaller files under 700 lines. Left `AISongStorage.ts` and `useAudioEngine.ts` as-is to preserve build stability. Future refactoring of these tightly-coupled state files requires slow, methodical extractions of pure functions before attempting to split the stateful classes/hooks themselves.

## 2026-06-09 - Forcing Array Maps Still Destroys Memoization
**Learning:** In `handleAutomationChange`, there was an attempt to update a single nested object (automation) by forcing a full map over the array: `updateSamplerStep(prev, bankIdx, -1, () => null)`. Passing `-1` ensured no steps were updated, but the outer map call still generated entirely new array references for `steps`, breaking `React.memo` and causing catastrophic UI re-renders during automation drawing.
**Action:** When updating a sibling object inside an array (like updating `automation` instead of `steps` on a Sampler Bank), never use standard "step update" helpers that blindly map the entire structure. Map *only* the specific level being targeted: `sampler.map((b, i) => i === bankIdx ? { ...b, automation: nextAutomation } : b)`.
## 2026-06-15 - Stabilized useUndoRedo Return Object
**Learning:** Custom hooks that return unmemoized object literals (like `{ push, undo }`) create a new object reference on every render. If these objects are included in a global context (like `useAppState`), any `useEffect` or `useMemo` depending on them will bust constantly, causing massive re-renders across the app (like firing a keydown effect on every frame).
**Action:** Always wrap the return value of custom hooks in `useMemo` if it returns an object or array literal, especially if that return value is destined for a React Context or a dependency array.
## 2026-06-15 - Persistent VoiceFXStrip
**Learning:** Creating complex audio graphs (like BiquadFilterNode + StereoPannerNode + LFOs) inside a high-frequency trigger path (like `playSamplerVoice`) incurs massive memory allocations and GC thrashing. `setTimeout` teardowns further overload the event loop.
**Action:** Extract reusable Web Audio chains into a `VoiceFXStrip` instantiated once inside the pooled voice class (e.g., `SingingVoice`). In the trigger path, only mutate `AudioParam.setValueAtTime` (e.g. `gain.value`, `frequency.value`). This effectively eliminates per-note Web Audio Node allocations.

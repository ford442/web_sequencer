1. **Identify Performance Bottleneck**: The global application state manager `useAppState.tsx` frequently calls `JSON.parse(JSON.stringify(prev))` to perform deep clones of the entire 256+ step sequence structure on hot-path actions like adding/removing notes, editing parameters, copying/pasting, and clearing sequences. This completely breaks React.memo for sequencer rows because it generates new memory references for untouched tracks and steps, causing widespread UI thrashing.

2. **Implement Shallow Cloning Optimization**:
   - Replaced all instances of `JSON.parse(JSON.stringify(prev))` with efficient ES6 spread operators to shallow clone only the modified tracks, banks, and specific steps in `useAppState.tsx` state update methods.
   - Preserved references for untouched tracks and steps so React.memo can do its job.

3. **Handle Edge Cases Properly**:
   - Fixed handling of array updates to guarantee correct typing.
   - Refactored `handleDrawEnter` to prevent painting neighboring steps improperly by reading the updated pattern layout appropriately without raising a "Cannot read properties of undefined" error.
   - Refactored `handleStepToggle` so it still creates a selection appropriately if `!isActive` but doesn't override the `setSelection` or toggling logic inadvertently.

4. **Verify Correctness**:
   - Run `pnpm test` successfully. Tests confirm that the optimizations maintain expected behavior for sequence drawing, length changes, pattern clearing, clipboard copy/paste, property changes, and TTS apply steps without regressions.
   - Checked that `eslint` also passes.

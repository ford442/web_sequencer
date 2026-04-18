## 2025-04-13 - Add aria-busy to processing buttons
**Learning:** Buttons that represent an asynchronous or intensive background process (such as rendering/mixdown or AI processing) should be explicitly marked with `aria-busy` to let screen reader users know that the system is doing work.
**Action:** When a button handles "Rendering..." or similar delayed states, ensure `aria-busy={isRendering}` or equivalent is added alongside `disabled={isRendering}`.

## 2025-04-13 - Add role="tabpanel" to custom tabbed interfaces
**Learning:** When implementing custom tabbed interfaces using `role="tablist"` and `role="tab"`, the corresponding content container must have `role="tabpanel"`, a unique `id` that matches the `aria-controls` attribute of the active tab, and an `aria-labelledby` attribute pointing to the active tab's `id`. This ensures screen reader users understand the relationship between the tabs and the content.
**Action:** Always verify that every `role="tablist"` has an associated `role="tabpanel"` wrapping the displayed content.

## 2025-04-17 - Add keyboard navigation to custom ARIA radio groups
**Learning:** When implementing custom radio button groups using `role="radiogroup"` and `role="radio"`, it is not enough to just add the ARIA attributes and a click handler. Screen reader users expect standard radio group keyboard behavior: the arrow keys should move focus and instantly select the adjacent radio button in the group. Additionally, the roving `tabIndex` pattern must be used where only the currently selected radio has `tabIndex={0}` and the others have `tabIndex={-1}`.
**Action:** When building or modifying custom radio groups (like the Retrigger selector in NoteSelector or Voice Count in Harmonizer), always add an `onKeyDown` handler to support `ArrowRight`/`ArrowDown` (next) and `ArrowLeft`/`ArrowUp` (previous) navigation, prevent the default scrolling behavior, update the selected state, and programmatically move focus to the new element.

## 2025-04-18 - Fix orphaned aria-describedby references
**Learning:** When using `aria-describedby` on a modal dialog (or any element), the `id` it points to must actually exist in the DOM. If the ID is missing (orphaned), screen readers will silently fail to read the crucial contextual information intended for the user (e.g., loading states, instructions).
**Action:** Always verify that the string provided to `aria-describedby` perfectly matches an `id` attribute on the element containing the descriptive text.

## 2025-04-13 - Add aria-busy to processing buttons
**Learning:** Buttons that represent an asynchronous or intensive background process (such as rendering/mixdown or AI processing) should be explicitly marked with `aria-busy` to let screen reader users know that the system is doing work.
**Action:** When a button handles "Rendering..." or similar delayed states, ensure `aria-busy={isRendering}` or equivalent is added alongside `disabled={isRendering}`.

## 2025-04-13 - Add role="tabpanel" to custom tabbed interfaces
**Learning:** When implementing custom tabbed interfaces using `role="tablist"` and `role="tab"`, the corresponding content container must have `role="tabpanel"`, a unique `id` that matches the `aria-controls` attribute of the active tab, and an `aria-labelledby` attribute pointing to the active tab's `id`. This ensures screen reader users understand the relationship between the tabs and the content.
**Action:** Always verify that every `role="tablist"` has an associated `role="tabpanel"` wrapping the displayed content.

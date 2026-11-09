## 2026-10-12 - Inner wrappers for live regions
**Learning:** When building empty state panels, banners, or toasts, ensure interactive elements like action buttons are placed outside the `role="status"` or `aria-live` region wrapper. If inside, screen readers read the button text redundantly on mount or update.
**Action:** Move `role="status"` to an inner wrapper containing only the text/icon to prevent double-announcements while maintaining valid HTML structure.
## 2025-02-23 - Separating interactive elements from aria-live regions
**Learning:** Found an accessibility issue pattern in the app's components (`CloudStatus` and `RbsImportModal`) where `role="status"` or `aria-live="polite"` wrappers enclosed interactive buttons. This causes screen readers to redundantly announce the button text on component mount or state updates.
**Action:** When building empty state panels, banners, or toasts, always place interactive elements (like action buttons) outside the `role="status"` or `aria-live` region wrapper. Move the live attributes to an inner wrapper (often a visually hidden `sr-only` element) containing only the raw text to prevent double-announcements while maintaining valid HTML structure.
## 2023-10-27 - Inner wrappers for live regions
**Learning:** When building empty state panels, banners, or toasts, ensure interactive elements like action buttons are placed outside the `role="status"` or `aria-live` region wrapper. If inside, screen readers read the button text redundantly on mount or update.
**Action:** Move `role="status"` to an inner wrapper containing only the text/icon to prevent double-announcements while maintaining valid HTML structure.

## 2023-10-27 - Accessible Input Labels
**Learning:** Adding `aria-label` to inputs that are already wrapped in descriptive `<label>` tags causes screen readers to ignore the visible text and only read the `aria-label`. This can lead to a mismatch between what sighted users see and what screen reader users hear, especially if the `aria-label` is less descriptive.
**Action:** Always link inputs to visible text labels using `<label htmlFor="id">` and `<input id="id">` instead of adding redundant `aria-label` attributes when a visible label exists.
## 2026-10-18 - Accessible Labels for Repeating UI Buttons
**Learning:** When a button repeats across multiple rows with the exact same visible text (e.g., 'Automate'), simply adding an `aria-label` isn't enough, as screen readers may redundantly announce the generic visible text alongside it.
**Action:** Differentiate them for screen readers by adding context to the `<button>`'s `aria-label` and `title` (e.g., `Automate ${param.label}`). Then, wrap the visible inner text in `<span aria-hidden="true">` to hide the redundant generic string.
## 2024-09-24 - Accessible Input Labels
**Learning:** Adding an `aria-label` alone is sometimes insufficient. Adding `aria-label` to inputs that are already grouped, or stand-alone controls like `<select>` elements, might be insufficient or redundant. Screen readers handle explicit `<label htmlFor="id">` bindings much better.
**Action:** Always link `<select>` or `<input>` elements to `<label htmlFor="id">` elements instead of adding redundant `aria-label` attributes.
## YYYY-MM-DD - Better tooltips on disabled controls
**Learning:** Native `title` tooltips often fail to render on HTML elements with the `disabled` attribute depending on the browser.
**Action:** When users need to know *why* a button is disabled, prefer `aria-disabled` + a no-op click handler (with manual styling like `opacity-60 cursor-not-allowed`) rather than native `disabled`. This ensures the explanatory `title` (or a custom tooltip) remains accessible on mouse hover.
## 2024-10-29 - Automation Lane Accessibility Fixes
**Learning:** `aria-selected` is invalid on `role="listitem"` and requires the `listbox`/`option` pattern. Also, nested interactive controls in rows can have their keyboard events swallowed by the row unless the row’s `onKeyDown` handler explicitly checks `if (e.target !== e.currentTarget) return;`. Furthermore, toggle buttons need `role="switch"` and `aria-checked` to convey state accurately, rather than just changing the `aria-label` text. Finally, visually hidden text (`sr-only`) is necessary to make icon-only badges accessible since `title` attributes are unreliable for screen readers.
**Action:** Applied these fixes to `src/components/automation/AutomationLaneList.tsx` and created a new unit test to cover the `listbox` pattern, `switch` toggles, and the keyboard event bubbling issue.
## 2026-10-31 - Providing export loading states to file exports
**Learning:** Found an accessibility issue pattern in the app's components (BottomBar) where file exports didn't have visually apparent loading states, and also lacked `aria-busy` feedback for screen readers during potentially lengthy operations.
**Action:** Always wrap potentially long-running file operations with an `isExporting` or `isLoading` state. This state should be hooked up to the component (like `LoadingButton`) to present visual loading indicators, `aria-busy=true` and disabled states. Note: Make sure to wrap the state changes in a `finally` block so that it correctly resets if the operation throws an error.
## 2026-11-03 - Better tooltips on functionally disabled buttons
**Learning:** Found an accessibility issue where buttons using the native `disabled` attribute alongside a `title` describing *why* they were disabled were having their tooltips suppressed by many browsers, effectively hiding this context from mouse users.
**Action:** When a button is functionally disabled and needs to provide explanatory hover context via `title`, prefer using `aria-disabled="true"` along with manual styling (e.g., `opacity-50 cursor-not-allowed`) and an early-return check in the `onClick` handler, rather than the native `disabled` attribute. Applied this fix to the file operations in `BottomBar.tsx` and the shared `LoadingButton`.
## 2026-11-07 - Better tooltips on functionally disabled buttons
**Learning:** Found an accessibility issue where buttons using the native `disabled` attribute alongside a `title` describing *why* they were disabled were having their tooltips suppressed by many browsers, effectively hiding this context from mouse users.
**Action:** When a button is functionally disabled and needs to provide explanatory hover context via `title`, prefer using `aria-disabled="true"` along with manual styling (e.g., `opacity-50 cursor-not-allowed`) and an early-return check in the `onClick` handler, rather than the native `disabled` attribute. Applied this fix to the file operations in `BottomBar.tsx`, `ExportModal.tsx` and `EngineDegradationBanner.tsx`.
## 2026-11-08 - Better tooltips on functionally disabled piano roll buttons
**Learning:** Found an accessibility issue where Piano Roll editing buttons using the native `disabled` attribute lacked tooltips describing *why* they were disabled, or had their tooltips suppressed by browsers.
**Action:** When buttons are functionally disabled and need to provide explanatory hover context via `title`, prefer using `aria-disabled="true"` along with manual styling (e.g., `opacity-40 cursor-not-allowed`) and an early-return check in the `onClick` handler, rather than the native `disabled` attribute. Applied this fix to the Scale Lock and Edit Selection buttons in `PianoRollView.tsx`.
## 2026-11-09 - Custom Tooltips on Disabled Buttons
**Learning:** Native `disabled` attributes often suppress `title` tooltips on buttons, preventing users (and screen readers) from understanding why the action is disabled.
**Action:** Use `aria-disabled="true"`, add manual styling (e.g. `opacity-40 cursor-not-allowed`), and implement an early return inside the `onClick` handler to keep the control focusable so its `title` explaining the reason for being disabled is accessible.

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

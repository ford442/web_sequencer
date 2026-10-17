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

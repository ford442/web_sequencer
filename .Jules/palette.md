## 2026-10-12 - Inner wrappers for live regions
**Learning:** When building empty state panels, banners, or toasts, ensure interactive elements like action buttons are placed outside the `role="status"` or `aria-live` region wrapper. If inside, screen readers read the button text redundantly on mount or update.
**Action:** Move `role="status"` to an inner wrapper containing only the text/icon to prevent double-announcements while maintaining valid HTML structure.

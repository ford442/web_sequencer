## 2024-04-27 - Reliable Loading State Announcements

**Learning:** When implementing accessibility for asynchronous background operations (like DSP harmonization), dynamically changing a button's `aria-label` often fails to reliably trigger screen reader announcements across different browser/AT combinations.

**Action:** Standardize on using explicit visually hidden `aria-live="polite"` regions with `aria-atomic="true"` containing loading text alongside `aria-busy` on the triggering element, as it ensures consistent and complete screen reader announcements for background processing states.

## 2024-04-27 - Flyout and Dialog Toggle Semantics

**Learning:** Buttons that toggle secondary panels (like Voice Editor modals) frequently lack semantic connection to the content they open.

**Action:** Always include `aria-haspopup="dialog"` (or appropriate role) and dynamically bind the `aria-expanded` boolean attribute to the panel's open state to ensure assistive technologies can correctly map the interaction tree.

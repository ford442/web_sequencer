## 2025-05-24 - Syncing Canvas Interaction with DOM Accessibility
**Learning:** When using `<canvas>` for visual controls (like knobs) alongside hidden accessible DOM elements, mouse users who click the canvas do not automatically transfer focus to the accessible element. This prevents them from switching to keyboard navigation (e.g., arrow keys) for fine-tuning after selection.
**Action:** Always programmatically call `.focus()` on the corresponding accessible DOM element (e.g., `role="slider"`) within the canvas `mousedown` or `click` handler. This bridges the gap between the visual interface and the accessible document structure.

## 2025-05-24 - Actionable Empty States in Modals
**Learning:** In modal-based workflows (like the Cloud Library), a passive "No items found" message creates a dead end that forces the user to close the modal or hunt for the right tab.
**Action:** Empty states should always include a direct action button (e.g., "Share Your Creation") that automatically switches context (e.g., changes tabs) to the solution, keeping the flow fluid without closing the modal.

## 2025-05-24 - Accessibility of Single-Panel Tab Interfaces
**Learning:** `role="tablist"` needs `role="tabpanel"` and proper `aria-controls` / `aria-labelledby` relationships to be truly semantic. A single dynamic panel is a valid pattern if attributes update dynamically.
**Action:** Always verify that `tablist` implementations include the corresponding `tabpanel` and linkage attributes, even if the content is just swapping in place.

## 2025-05-25 - Explicit Clear Actions for Text Inputs
**Learning:** Text inputs that control significant UI state (like background images) benefit from an explicit "Clear" button (`✕`) when they have a value. Relying on users to manually select and delete text is high-friction, especially for long URLs.
**Action:** When a state-driving text input has a value, conditionally render a clear button next to it. Ensure it has an `aria-label` (e.g., "Clear Background Image") so screen reader users know exactly what it does.

## 2025-05-25 - Live Regions for Initial Loading States
**Learning:** For full-screen loading overlays (like system checks), using `role="status"` with `aria-live="polite"` on the dynamic content container ensures screen readers announce progress updates (e.g., "Core: Loaded") without user intervention.
**Action:** When creating a startup or splash screen with dynamic status steps, wrap the step list in a live region so users are kept informed during the wait.

## 2025-05-25 - Accessible Icon-Only Buttons
**Learning:** Icon-only buttons (like Save/Load) are invisible to screen reader users without explicit labels, and often confusing to sighted users without tooltips. They also need proper focus indication for keyboard users who might skip over them if they don't look interactive.
**Action:** Always add `aria-label` for screen readers and `title` for mouse users to icon-only buttons. Ensure `focus-visible` styles are present so keyboard users can track their position.

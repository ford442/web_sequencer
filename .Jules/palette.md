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

## 2025-05-25 - Keyboard Navigation in React Tabs
**Learning:** Adding ARIA roles to tabs is not enough; `tabIndex` management and `keydown` handlers are essential for the expected arrow-key navigation behavior defined in the ARIA Authoring Practices.
**Action:** When converting buttons to tabs, always implement a `handleKeyDown` function for ArrowLeft/ArrowRight to switch tabs and manage focus, ensuring a native-like experience.

## 2025-05-25 - Advanced Keyboard Control for Sliders
**Learning:** Adding Shift (coarse) and Alt (fine) modifiers to standard arrow key navigation significantly improves usability for precise parameter controls without cluttering the UI. Standard ARIA sliders benefit greatly from Home/End/Page keys.
**Action:** Implement standard modifier logic (Shift=x10, Alt=x0.1) and full navigation key support (Home, End, PageUp, PageDown) on all custom range inputs or knobs.

## 2025-05-25 - Stabilizing Live Regions for Status Updates
**Learning:** If a component conditionally renders different root elements (e.g., returning `null` or swapping `div`/`button`) based on state, `aria-live` announcements may be unreliable because the live region itself is being destroyed and recreated. Screen readers generally need the live region container to be stable in the DOM to observe content changes.
**Action:** Wrap conditional status content in a stable parent `div` with `role="status"` and `aria-live="polite"` that persists across state changes, even if empty.

## 2025-05-25 - Visible Focus in Dense Grids
**Learning:** In dense grids of interactive elements (like a sequencer), the default `focus:outline-none` style (often used for aesthetics) leaves keyboard users completely lost.
**Action:** Always replace `focus:outline-none` with a high-contrast `focus-visible` ring that contrasts with the background, ideally matching the element's semantic color if applicable.

## 2025-05-26 - Keyboard Support for Mouse-Repeat Buttons
**Learning:** Buttons designed for "press and hold" (repeat) actions using `onMouseDown` are often inaccessible to keyboard users because standard `onClick` is omitted. A keyboard "click" (Enter/Space) needs to trigger a single step action to ensure functionality parity.
**Action:** Always handle `onClick` or `onKeyDown` (Enter/Space) for repeat buttons to perform a single step, ensuring keyboard users can interact with the control. Use `event.detail === 0` to distinguish keyboard activation from mouse clicks if necessary.

## 2025-05-26 - Accessible Modals and Backdrops
**Learning:** Right-click context menus are essentially modal dialogs and require the same accessibility treatments: focus trapping, `Escape` key support, and a click-outside backdrop. Without these, keyboard users can get trapped or lost, and the UI state feels "sticky" to mouse users.
**Action:** When implementing custom context menus, always wrap them in a `fixed` transparent backdrop for easy dismissal and use `useEffect` to capture focus on mount and listen for `Escape`.

## 2025-05-26 - Replacing Alerts with Toasts
**Learning:** Native `alert()` calls are blocking and disruptive, breaking the user's flow and immersion, especially in a specialized creative app like a DAW. They also fail to respect the application's visual theme.
**Action:** Replace all `alert()` usage with a non-blocking `Toast` notification system. Use context or prop drilling (for simple hierarchies) to expose a `showToast` function, and ensure the toast component is accessible (`role="alert"`) and auto-dismissing.

## 2025-05-26 - Keyboard Value Control in Sequencer Grids
**Learning:** Grid-based sequencer inputs often rely on mouse drag for value selection, leaving keyboard users with only binary (toggle) control via Enter/Space. This excludes them from precise musical expression (e.g., selecting specific patterns).
**Action:** Implement `ArrowUp`/`ArrowDown` handlers on grid cells to increment/decrement values, and `Delete`/`Backspace` to clear them, ensuring functional parity with mouse interactions.

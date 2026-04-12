## 2025-03-03 - Range Input Accessibility
**Learning:** Range inputs (sliders) in custom property panels like `NoteSelector` and `PhonemePainter` often lack associated `<label>` tags and instead rely on surrounding text spans for visual context, leaving screen readers without an accessible name.
**Action:** Always ensure `<input type="range">` elements have explicit `aria-label` attributes that match their visual labels to provide proper context for assistive technologies.

## 2025-03-03 - Button Loading State Visibility
**Learning:** The `SongMode` "EXPORT XM" button changes its text to "EXPORTING..." but previously lacked a visual loading spinner. In fast-running asynchronous operations, relying solely on a text change can feel abrupt or be missed, while larger files would show a frozen-looking text state without an active indicator of progress.
**Action:** Always pair asynchronous UI button text changes with an animated visual indicator (e.g., an SVG spinner) and `aria-busy="true"` to ensure users receive clear feedback that a process is actively running.

## 2025-03-10 - Custom Slider Accessibility
**Learning:** Custom UI elements acting as sliders (`role="slider"`) often lack context for screen readers if they only provide `aria-valuenow` with a raw number. When dealing with abstract values (e.g., frequencies, percentages, tempos), screen reader users hear just numbers without knowing what they represent.
**Action:** Always include an `aria-valuetext` attribute on custom sliders that properly formats the numeric value and includes its label (e.g., "1k Tempo" instead of just "1000") to ensure assistive technologies announce contextually meaningful data.

## 2025-03-10 - Custom Slider Focus and Keyboard Support
**Learning:** Custom sliders built from `<div>` tags mapped to mouse drags often lack native keyboard navigation (`ArrowUp`, `ArrowDown`, `PageUp`, `Home`, `End`) and focus states, severely degrading keyboard accessibility. Also, dealing with normalized values (-1 to 1) requires care when mapping ARIA attributes to ensure the announced value matches the visual display.
**Action:** Always add `tabIndex={0}`, `role="slider"`, `onKeyDown` handlers to support common slider keys, and focus-visible styling (`focus:outline-none focus:ring-2`) to custom interactive elements. When internal values are normalized, use `aria-valuetext` to announce the exact formatted string shown to the user rather than the raw 0-1 scale.
## 2026-03-28 - Standardize Modal Accessibility
**Learning:** Found multiple instances where close buttons had either `aria-label` but no visual tooltip (`title`), or were missing `aria-label` completely. Screen readers and users who navigate with a mouse will both benefit from standardizing the "Close" terminology visually and programmatically. Modals shouldn't leave the user guessing what an "✕" does, and acknowledging states with proper labels improves the overall accessible experience.
**Action:** Implemented `aria-label="Close Shortcuts"` alongside `title="Close Shortcuts"` (or similar depending on context) across major overlay components such as `ShortcutsHelp`, `LiveKeyboard`, and `GamepadDebugger`. Included focus trapping and ESC-key dismiss support using `useFocusTrap` correctly hooked into the components.
## 2025-03-31 - Semantic Grouping for Custom Radio Buttons
**Learning:** Custom UI components that act as a list of mutually exclusive options (like `LadderButton` used for selecting a Root Note) often just render as standard buttons. This forces keyboard users to tab through every single option and leaves screen readers without context about the total number of options or which one is currently selected.
**Action:** When creating custom single-selection lists, group them in a container with `role="radiogroup"` and `aria-labelledby`, assign `role="radio"` and `aria-checked` to the individual buttons, and implement roving `tabIndex` with Arrow Up/Down navigation. This allows users to tab into the group once and use arrow keys to navigate, matching native `<input type="radio">` behavior.

## 2024-05-18 - Missing Focus Visible States on Custom Switches
**Learning:** Custom UI controls that mimic native inputs (like pill-shaped switches for Reverse or Melodic Mode) frequently omit `focus-visible` styles, rendering them completely invisible to keyboard users when tabbing through the interface. Furthermore, developers frequently mistakenly use `aria-pressed` with `role="button"` instead of the correct `role="switch"` with `aria-checked` for these pill-shaped components.
**Action:** Always verify that interactive custom switches not only have appropriate ARIA roles (`role="switch"`, `aria-checked`) but explicitly define `focus:outline-none focus-visible:ring-*` classes.

## 2024-04-10 - Standardization of aria-busy on Async Import Buttons
**Learning:** Discovered an inconsistency where some background task buttons (like the AI Song Import button) lacked the `aria-busy` attribute, while others (like RbsImportModal and SamplerPanel) correctly used it to inform screen readers of processing states.
**Action:** Applied `aria-busy={isImporting}` to the AI Song Import button to standardise asynchronous feedback mechanisms for accessibility across all modal interfaces.
## 2026-04-09 - Standardize Modal Accessibility for Cloud Library
**Learning:** The `CloudLibrary` component functioned as a modal visually but lacked standard ARIA modal attributes (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`), causing screen readers to announce it incorrectly or not at all.
**Action:** When implementing custom modals, always include `role="dialog"`, `aria-modal="true"`, an explicit `aria-labelledby` referencing a visually hidden or visible title element, and an `aria-hidden="true"` on the clickable background overlay.
## 2024-11-20 - Standardize Backdrop Overlay Accessibility
**Learning:** Components using `fixed inset-0` with a click handler to close a modal will cause screen readers to announce the entire background as a clickable element. This violates accessibility conventions.
**Action:** When implementing clickable background overlays for custom modals, always separate the clickable backdrop into its own `<div>` sibling of the dialog element, and explicitly mark it with `aria-hidden="true"`.

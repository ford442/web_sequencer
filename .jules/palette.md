## 2024-05-01 - Fix aria-controls for Harmonizer Popover
**Learning:** Found that custom dropdowns/popovers acting as modals or flyouts require a clear structural link using `aria-controls` pointing to the exact `id` of the popover content. The `aria-expanded` and `aria-haspopup` tags alone are insufficient for complete screen reader accessibility if the container it targets cannot be identified via an `id` reference.
**Action:** Always ensure that `aria-controls` matches a specific `id` attribute on the container component whenever implementing custom popup interfaces.
## 2024-06-25 - Advanced Keyboard Interaction Patterns
**Learning:** For a complex app like a DAW, simple gestural controls (like dragging up/down to change pitch) are entirely inaccessible to keyboard-only users. Furthermore, when closing deep nested menus like popovers, relying on the browser's default focus management will drop the user back at the top of the page, ruining the navigation flow.
**Action:** Always provide explicit arrow-key support (`onKeyDown`) for gestural or slider-like UI elements to replicate drag behavior. Always use a `useRef` to track the trigger element that opened a popover, and explicitly call `.focus()` on it when the popover closes.

## 2024-05-09 - Accessibility in Canvas Overlays
**Learning:** Interactive elements within dense, absolute-positioned canvas overlays (like `HarmonizerPopover`) frequently lack focus rings because they aren't part of standard top-to-bottom form flows. Developers often style them as custom widgets but forget keyboard-only navigation needs visible focus states just as much as standard HTML forms do.
**Action:** Always check custom popovers, context menus, and floating widgets for `focus-visible:ring-2` to ensure keyboard accessibility.

## 2024-11-20 - Custom Dialog Focus Management
**Learning:** When implementing custom modals or dialogs using `role="dialog"`, it is critical to include `tabIndex={-1}` on the dialog container itself. Without this, the dialog cannot receive programmatic focus when opened, which can disrupt screen reader announcements and keyboard navigation flow. Additionally, close buttons inside these modals often miss focus rings because they use absolute positioning and custom SVG icons instead of standard button styles.
**Action:** Always verify that custom dialog containers have `tabIndex={-1}` and ensure interactive elements within them (like close buttons) explicitly implement `focus-visible` utility classes for keyboard accessibility.
## 2026-05-13 - [NoteSelector Accessibility Improvements]
**Learning:** Grouping related slider inputs (like Velocity, Duration, Expression) in a complex custom modal component using `<fieldset>` with `sr-only` `<legend>` dramatically improves screen reader navigation and context without affecting the existing visual layout, as long as utility classes like `border-none p-0 m-0` are applied to the fieldset.
**Action:** Always wrap logical groups of parameter controls in `<fieldset>` tags with descriptive `<legend>` elements instead of generic `div` containers, especially in dense UI sections.
## 2026-05-25 - Toast Accessibility Close Button
**Learning:** The Toast component lacked a close button, making it hard to dismiss quickly for keyboard and screen reader users before the 3s timeout. Automated Playwright verification of transient Toasts is also brittle without global state hooks.
**Action:** Added an explicit close button with  and  to Toasts, and set  on the alert. Will rely on unit tests and manual dev check for transient UI components instead of forcing brittle E2E flows.
## 2026-05-25 - Toast Accessibility Close Button
**Learning:** The Toast component lacked a close button, making it hard to dismiss quickly for keyboard and screen reader users before the 3s timeout. Automated Playwright verification of transient Toasts is also brittle without global state hooks.
**Action:** Added an explicit close button with aria-label and title to Toasts, and set aria-live=polite on the alert. Will rely on unit tests and manual dev check for transient UI components instead of forcing brittle E2E flows.
## 2024-06-19 - [Missing interactive element semantics and tooltips on custom buttons]
**Learning:** Found custom buttons acting as toggles without `type="button"`, `role="switch"`, `aria-checked`, or `title` attributes. This could result in ambiguous screen reader announcements and accidental form submissions. It also limits usability for mouse users relying on hover tooltips.
**Action:** When creating icon-only toggles and controls (like enabling/disabling lanes), ensure they are fully semantic with `type="button"`, `role="switch"` (where applicable), `aria-checked`, and a helpful `title` tooltip alongside their `aria-label`.
## 2024-06-20 - [Grouped Parameter Accessibility]
**Learning:** In complex dropdown or parameter groups like those in the ScaleSelector, grouping related standard `<select>` options in a `<fieldset>` with a visually hidden `<legend>` ensures proper context without requiring multiple repetitive aria labels on every input and unifies their screen reading experience. Applying a unified `focus-visible:ring` provides critical context that regular `focus:ring` lacks.
**Action:** When creating groupings of closely related controls (e.g. root, scale, tuning system), default to `<fieldset>` and `<legend>` wrapping and strictly use `focus-visible:` classes over `focus:`.

## 2026-06-25 - DragValue Component Accessibility Refinement
**Learning:** Found that custom draggable input controls with supplementary increment/decrement buttons lack standard `type="button"` attributes, which can cause unexpected form submissions if nested within forms. Additionally, focus ring colors must be aligned with the global app theme (e.g., using cyan instead of yellow) to maintain visual consistency across reusable components.
**Action:** Ensure all `<button>` elements in custom input components include `type="button"` explicitly, and verify that `focus-visible:ring` colors match the app's established design system tokens.
## 2024-06-25 - Focus Visible for Mouse Users
**Learning:** For accessibility in UI components, it is critical to use `focus-visible:` utility classes (e.g., `focus-visible:ring-2`) instead of just `focus:` for focus rings on buttons. Using `focus:` causes the focus ring to appear even when the user clicks the button with a mouse, which can be visually distracting and is generally considered a poor UX pattern for modern applications.
**Action:** Always strictly use `focus-visible:` over `focus:` for any button or interactive element to ensure focus rings are reserved for keyboard navigation.

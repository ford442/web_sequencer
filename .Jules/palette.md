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
## 2026-05-14 - Aria Labeling in Mode-Switching Components
**Learning:** Found that custom toggle switches and mutually exclusive selection buttons (like Voice Type and Harmony Type) frequently lack proper ARIA attributes (`aria-label` and `aria-pressed`). These mode-switching controls are critical for screen reader users to understand the state of complex UI features.
**Action:** Always bind `aria-pressed` or `aria-selected` to the active state of mode-switching components, and ensure descriptive `aria-label`s are applied, especially when visual feedback is purely styling-based.
## 2026-05-15 - Standardizing Loading States
**Learning:** Found that scattered async operations often used disparate loading patterns—some inline SVGs, some custom text, and many lacking `aria-busy` and `aria-hidden="true"` on the loading spinners. This results in inconsistent visual feedback and fragmented screen-reader experiences during operations like mixdowns or file imports.
**Action:** Created and applied a reusable `<LoadingButton>` component that bakes in `aria-busy`, `disabled` state, `cursor-wait`, and an accessible (SVG `aria-hidden="true"`, `focusable="false"`) spinner. Use this pattern for all asynchronous button actions.

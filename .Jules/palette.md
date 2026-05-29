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
## 2024-05-28 - Icon-Only Button ARIA Labels
**Learning:** Initial grep searches for missing `aria-label` attributes on `<button>` elements with `title` attributes were misleading due to JSX formatting (attributes spread across multiple lines). A thorough manual inspection confirmed that core components (PhonemePainter, VoiceEditor, LiveKeyboard, NoteSelector, BottomBar) already have robust `aria-label` implementations for their icon-only buttons.
**Action:** Always verify regex/grep results with manual file inspection when analyzing JSX for accessibility attributes. Avoid redundant work on this specific pattern in these components.

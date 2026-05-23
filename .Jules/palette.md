## 2024-04-28 - App Action Bar Accessibility
**Learning:** Primary interaction buttons in the bottom action bar lacked WCAG 2.4.7 focus visibility indicators, making them difficult for keyboard users.
**Action:** Added `focus-visible:ring-2` with color-matched rings and descriptive `aria-label` attributes to the NOTES, AUTO, SAVE, LOAD, and Import buttons in `App.tsx`.
## 2024-05-02 - Song Mode Button Focus Accessibility
**Learning:** The Song Mode interface buttons (add/remove bar, toggle mode, clear background) lacked explicit focus states, making keyboard navigation difficult.
**Action:** Added `focus-visible:ring-2` and appropriate `focus-visible:ring-{color}-500` classes with `focus:outline-none` to all interactive buttons in `SongMode.tsx`.
## 2024-05-18 - Added ARIA Labels to Missing Icons
**Learning:** Found several generic visual indicators or icons missing context for screen readers. Ensure SVG or generic div controls inside buttons use `aria-label` attributes consistently.
**Action:** Always add descriptive `aria-label` attributes to button elements lacking explicit readable text, particularly in interactive visual elements like canvases or specialized components like `DrawableLFO.tsx` and `Rack.tsx`.
## 2024-05-24 - BottomBar and TransportToolbar Accessibility Polish
**Learning:** Interactive elements in `BottomBar.tsx` and `TransportToolbar.tsx` (buttons, selects, range inputs) had inconsistent hover states and lacked proper `focus-visible` indicators, `title` tooltips, and some `aria-label`s.
**Action:** Enforced a consistent UI/UX 'Palette' standard across all controls in these components: added `focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2`, snappy animations (`transition-all duration-150`, `hover:scale-105 active:scale-95`), and ensured `title` tooltips and `aria-label`s exist.
## 2024-05-12 - Added Focus Visible to LiveKeyboard Close Button
**Learning:** For floating modals and guides with absolute positioned close buttons (like LiveKeyboard), the `focus-visible:ring-2` class is necessary for keyboard navigation since standard hover effects don't apply when tabbing.
**Action:** When adding close buttons (`✕`) to popovers or guides, always include `focus:outline-none focus-visible:ring-2 focus-visible:ring-[color] rounded`.
## 2024-05-25 - AI Song Import Overlay Button Accessibility
**Learning:** Found that the "Cancel Import" button within the `AISongImportOverlay` lacked proper focus and interactive feedback (hover/active scaling) standard for this app, despite being a crucial action point in a modal.
**Action:** Always ensure that buttons within modals or temporary overlays adhere to the app's standard visual feedback and accessibility patterns (`focus-visible:ring-2`, `hover:scale-105 active:scale-95`, and proper descriptive `aria-label`/`title`), regardless of the component's depth or context.
## 2026-05-15 - Decorative Icons Need Explicit Aria Hiding
**Learning:** Even when a button has a descriptive `aria-label`, decorative text elements inside it (like the `⌨` emoji inside a `<span>`) can still be read awkwardly by some screen readers if not explicitly hidden.
**Action:** When adding an `aria-label` to a button containing a decorative text icon, always remember to add `aria-hidden="true"` directly to the decorative element itself to ensure a clean auditory experience.
## 2024-05-26 - Mouse-Click Focus Rings and focus-visible
**Learning:** Found that using standard `focus:ring-2` on buttons like the Transport Play/Stop causes an ugly, lingering focus ring after a standard mouse click.
**Action:** When styling interactive elements for accessibility, always prefer `focus-visible:ring-2` over `focus:ring-2`. This ensures that keyboard navigators get clear focus indicators while mouse users do not see lingering rings after clicking.
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
## 2026-05-20 - Prevent Lingering Mouse-Click Focus Rings
**Learning:** Using standard `focus:ring-2` on custom slider/button components (like DragValue and Knob) causes an ugly, lingering focus ring after a standard mouse click. Keyboard navigation accessibility must be maintained without penalizing mouse users.
**Action:** When styling interactive elements for accessibility, always prefer `focus-visible:ring-2` and `focus-visible:border-[color]` over `focus:ring-2`. This ensures that keyboard navigators get clear focus indicators while mouse users do not see lingering rings after clicking.
## 2026-05-23 - Reveal Complex Gestural Patterns with Aria-Description
**Learning:** Found that complex matrix components like `MainSequencer` use dual-interaction models (left-click vs right-click). These gestural actions are opaque to keyboard and screen reader users without proper hints.
**Action:** Use `aria-description` on complex interactive UI components to explicitly document primary and secondary actions (e.g., "Left-click to select pattern. Right-click to copy/paste/clear.") to improve discoverability without cluttering the visible UI.

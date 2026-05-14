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
## 2026-05-14 - LoadingOverlay Live Announcements
**Learning:** When making expandable loading details panels accessible, do not put aria-live on the conditionally rendered container or add aria-atomic="true" to a list of dynamically updating items. This causes spammy, redundant screen reader announcements and breaks when the panel is closed. Instead, create an independent, visually hidden (sr-only) live region that summarizes the overall progress, and let the toggle button rely on its natural inner text (rather than a static aria-label) while hiding decorative icons with aria-hidden="true".
**Action:** Always test live regions independently of visual toggle states to ensure continuous background announcements.

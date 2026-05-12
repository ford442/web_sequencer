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

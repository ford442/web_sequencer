## 2024-04-28 - App Action Bar Accessibility
**Learning:** Primary interaction buttons in the bottom action bar lacked WCAG 2.4.7 focus visibility indicators, making them difficult for keyboard users.
**Action:** Added `focus-visible:ring-2` with color-matched rings and descriptive `aria-label` attributes to the NOTES, AUTO, SAVE, LOAD, and Import buttons in `App.tsx`.
## 2024-05-02 - Song Mode Button Focus Accessibility
**Learning:** The Song Mode interface buttons (add/remove bar, toggle mode, clear background) lacked explicit focus states, making keyboard navigation difficult.
**Action:** Added `focus-visible:ring-2` and appropriate `focus-visible:ring-{color}-500` classes with `focus:outline-none` to all interactive buttons in `SongMode.tsx`.

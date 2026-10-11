## 2026-10-11 - Icon-Only Button Parity and Focus Rings
**Learning:** Screen readers and keyboard navigation rely heavily on strict parity for icon-only buttons (matching `aria-label` and `title`, with hidden glyphs), and focus rings are easily missed on custom close buttons like the Phoneme Painter.
**Action:** Always verify that `focus-visible` utility classes exist on all interactable elements, and test that icon-only buttons have matching ARIA labels and titles, along with `aria-hidden` on their graphical children.

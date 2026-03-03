## 2025-03-03 - Range Input Accessibility
**Learning:** Range inputs (sliders) in custom property panels like `NoteSelector` and `PhonemePainter` often lack associated `<label>` tags and instead rely on surrounding text spans for visual context, leaving screen readers without an accessible name.
**Action:** Always ensure `<input type="range">` elements have explicit `aria-label` attributes that match their visual labels to provide proper context for assistive technologies.

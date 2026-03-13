## 2025-03-03 - Range Input Accessibility
**Learning:** Range inputs (sliders) in custom property panels like `NoteSelector` and `PhonemePainter` often lack associated `<label>` tags and instead rely on surrounding text spans for visual context, leaving screen readers without an accessible name.
**Action:** Always ensure `<input type="range">` elements have explicit `aria-label` attributes that match their visual labels to provide proper context for assistive technologies.

## 2025-03-03 - Button Loading State Visibility
**Learning:** The `SongMode` "EXPORT XM" button changes its text to "EXPORTING..." but previously lacked a visual loading spinner. In fast-running asynchronous operations, relying solely on a text change can feel abrupt or be missed, while larger files would show a frozen-looking text state without an active indicator of progress.
**Action:** Always pair asynchronous UI button text changes with an animated visual indicator (e.g., an SVG spinner) and `aria-busy="true"` to ensure users receive clear feedback that a process is actively running.

## 2025-03-10 - Custom Slider Accessibility
**Learning:** Custom UI elements acting as sliders (`role="slider"`) often lack context for screen readers if they only provide `aria-valuenow` with a raw number. When dealing with abstract values (e.g., frequencies, percentages, tempos), screen reader users hear just numbers without knowing what they represent.
**Action:** Always include an `aria-valuetext` attribute on custom sliders that properly formats the numeric value and includes its label (e.g., "1k Tempo" instead of just "1000") to ensure assistive technologies announce contextually meaningful data.

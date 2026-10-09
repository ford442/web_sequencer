## 2024-05-24 - Prefer Visible Labels Over ARIA Attributes
**Learning:** When associating text with an input field (like a textarea), it is better for accessibility to link an existing visible label using `htmlFor` and `id` rather than adding a redundant `aria-label`. This ensures that screen readers announce the exact same text that sighted users see, without duplication.
**Action:** Always check for adjacent visible text that can serve as a `<label>` before defaulting to an `aria-label` attribute on form inputs.

## 2024-10-10 - Radiogroup Keyboard Accessibility
**Learning:** Native `role="radiogroup"` patterns require implementing custom "roving tabIndex" and directional arrow-key focus management (up/down/left/right to navigate items) wrapping at the boundaries. Leaving them as standard focusable buttons breaks screen reader and power user expectations.
**Action:** When implementing custom radios, always add a `handleKeyDown` to shift focus via refs and toggle `tabIndex={0 | -1}` for the active item. Ensure `e.preventDefault()` is used on arrow keys to avoid page scrolling.

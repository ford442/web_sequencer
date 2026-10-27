## YYYY-MM-DD - Better tooltips on disabled controls
**Learning:** Native `title` tooltips often fail to render on HTML elements with the `disabled` attribute depending on the browser.
**Action:** When users need to know *why* a button is disabled, prefer `aria-disabled` + a no-op click handler (with manual styling like `opacity-60 cursor-not-allowed`) rather than native `disabled`. This ensures the explanatory `title` (or a custom tooltip) remains accessible on mouse hover.

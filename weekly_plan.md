## Agent Palette Daily UX Improvements

### Semantic Radio Groups

In `CloudLibrary.tsx`, we converted a list of standalone `<label><input type="radio"/></label>` tags into a `<fieldset>` and `<legend>` containing the inputs.
*   **Why**: Previously, assistive technology could not identify the logical grouping or understand the options in context. Grouping mutually exclusive form elements improves navigability for keyboard/screen-reader users.
*   **Result**: "What are you saving?" is now announced as the legend for the entire group, giving options clear context.

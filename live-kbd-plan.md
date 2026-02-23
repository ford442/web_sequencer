## Goal
Update the on-screen UI button grid to physically reflect our upside-down PC keyboard mapping. The UI needs to visually communicate the inverted rows and the whole-tone horizontal stepping to make the custom controller intuitive to use as well as mirror a piano shape with outline or placement of buttons.

## Current State
The UI is a dense, solid block of buttons which makes it difficult to visually identify octaves or the "piano" layout.

## Proposed Changes
1. **Break the Solid Grid:** Separate the octaves into two distinct rows to represent Naturals (white keys) and Accidentals (black keys).
2. **Implement Piano Gaps:** Introduce empty spaces in the Accidentals row (between E/F and B/C) so the grid mimics a standard piano layout.
3. **Invert the Visual Stagger:** * **Top Visual Row (Naturals):** Mapped to the physical number keys (`1, 2, 3...`).
   * **Bottom Visual Row (Accidentals):** Mapped to the physical F-keys (`F1, F2, F3...`). Offset this row horizontally so the accidentals sit "between" the naturals above them.
4. **Whole-Tone Stepping Logic:** Ensure the UI labels clearly reflect that moving horizontally (left/right) shifts the pitch by a whole step, while moving vertically (between rows) shifts by a half-step.

## Reference Diagram
![UI Prototype Alignment](https://github.com/YOUR-USERNAME/YOUR-REPO/blob/main/path/to/prototype-image.png?raw=true)

## Implementation Notes
* CSS Grid (e.g., a 12-column layout) is likely the cleanest way to handle the piano gaps and the half-step physical offset without relying on messy margins.

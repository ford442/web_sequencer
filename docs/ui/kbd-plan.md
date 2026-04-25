# Live Keyboard UI — Layout Plan (Expanded)

## Goal
Update the on-screen UI button grid to physically reflect our upside-down PC keyboard mapping.
The UI needs to visually communicate the inverted rows and the whole-tone horizontal stepping to
make the custom controller intuitive to use, and mirror a piano shape with outline or placement
of buttons.

## Current State
The UI renders four octave rows as a solid, uniform grid (`OCTAVES = [5, 4, 3, 2]`). Every
row has 12 equal-width buttons — one per chromatic note — with no visual distinction between
naturals and accidentals, no piano gaps, and no stagger.

### Current Key Mapping (Chromatic Zig-Zag)
The physical F-row and Digit-row each hold one of the two whole-tone scales:

```
Column:  1     2     3     4     5     6     7     8
F-key:  [C4]  [D4]  [E4]  [F#4] [G#4] [A#4] [C5]  [D5]   ← whole-tone scale I
Digit:  [C#4] [D#4] [F4]  [G4]  [A4]  [B4]  [C#5] [D#5]  ← whole-tone scale II
```

Key insight: **moving horizontally = whole step; moving vertically = half step.**

---

## Five Proposed Layout Arrangements

---

### Concept 1 — True Piano Split (Remapped Keys)

**Philosophy:** Abandon the whole-tone rows and map keys exactly like a standard piano keyboard.
Seven consecutive F-keys cover the seven naturals; consecutive Digit keys cover the five
accidentals with gaps at E/F and B/C.

**Visual layout (one octave span, ~ 920 px wide):**

```
TOP ROW — Accidentals (Digit keys, offset right by ½ key width, shorter buttons)

        [1 C#] [2 D#]        [3 F#] [4 G#] [5 A#]
        ───────────────────────────────────────────
BOTTOM ROW — Naturals (F-keys, full width buttons)

[F1 C] [F2 D] [F3 E] [F4 F] [F5 G] [F6 A] [F7 B] [F8 C]
```

**Proposed remapping:**

| Physical key | Note  | Row      |
|-------------|-------|----------|
| F1          | C4    | Natural  |
| F2          | D4    | Natural  |
| F3          | E4    | Natural  |
| F4          | F4    | Natural  |
| F5          | G4    | Natural  |
| F6          | A4    | Natural  |
| F7          | B4    | Natural  |
| F8          | C5    | Natural  |
| Digit1      | C#4   | Accidental |
| Digit2      | D#4   | Accidental |
| Digit3      | F#4   | Accidental |
| Digit4      | G#4   | Accidental |
| Digit5      | A#4   | Accidental |

**Expanded Implementation Details:**

1. **CSS Grid Structure:** Use a 14-column grid where naturals occupy 2 columns each and gaps occupy 1 column
2. **Key Sizing:** Naturals are full-height (100px), accidentals are 60% height (60px) and vertically offset
3. **Visual Hierarchy:** Accidentals appear to "float" above the naturals with a subtle drop shadow
4. **Gap Indicators:** Empty columns at E/F and B/C boundaries show subtle vertical divider lines
5. **Row Styling:**
   - Bottom row (F-keys): Off-white/cream buttons (#f5f5f0) with dark text
   - Top row (Digits): Dark charcoal (#2a2a2a) with white text, 70% width of naturals

**Animation Suggestions:**
- Keys press down (translateY 3px) when activated
- Accidental keys have a subtle glow effect on hover
- Piano gaps pulse gently when the boundary notes (E/F, B/C) are played

**Implementation (CSS Grid, 14 columns):**
```css
/* 14-column grid: each natural = 2 cols, each gap = 1 col */
grid-template-columns: repeat(14, 1fr);
/* Naturals occupy bottom row; Accidentals the top row with column offsets */
/* E/F gap: column 7 empty; B/C gap: column 14 empty */
```

**Text-to-Image Prompt:**
> "Modern software synthesizer UI, isometric view of piano keyboard layout on computer screen, two rows of rectangular buttons, bottom row has 8 wide cream-colored keys labeled F1-F8 with notes C-D-E-F-G-A-B-C, top row has 5 narrower dark charcoal keys labeled 1-5 with sharps C#-D#-F#-G#-A#, empty gaps visible between E-F and B-C, glowing neon accent lighting, dark mode interface, professional music production software aesthetic, clean vector graphics, 4K UI design mockup"

**Pros:** Exactly mirrors a real piano; muscle memory transfers naturally.  
**Cons:** Breaks the whole-tone stepping; horizontal movement is no longer uniform.

---

### Concept 2 — Whole-Tone Stagger (Keep Mapping, Add Offset) ✅ IMPLEMENTED

**Philosophy:** Keep the current key-to-note mapping unchanged but visually stagger the Digit
row right by half a key width so it appears to sit *between* the F-key notes — just like black
keys sit between white keys on a piano.

**Visual layout:**

```
TOP ROW — Digit keys (offset right by ½ key, darker colour)

     [1 C#] [2 D#] [3 F ] [4 G ] [5 A ] [6 B ] [7 C#] [8 D#]
─────────────────────────────────────────────────────────────────
BOTTOM ROW — F-keys (full left-edge position, lighter colour)

[F1 C] [F2 D] [F3 E] [F4 F#][F5 G#][F6 A#][F7 C] [F8 D]
```

No gap in the Digit row (because F↔G and B↔C *are* filled by F4 and Digit6 respectively in
the whole-tone scheme). Each key is individually coloured by its chromatic identity, not by row.

**Implementation Details:**

1. **Stagger Offset:** Digit row translated by `columnWidth / 2` (half key width)
2. **Chromatic Coloring:** 
   - C = Red (#dc2626)
   - C# = Orange-600 (#ea580c)
   - D = Orange-500 (#f97316)
   - D# = Amber-500 (#f59e0b)
   - E = Yellow (#eab308)
   - F = Green (#22c55e)
   - F# = Emerald-500 (#10b981)
   - G = Cyan (#06b6d4)
   - G# = Sky-500 (#0ea5e9)
   - A = Blue (#3b82f6)
   - A# = Indigo-500 (#6366f1)
   - B = Purple (#a855f7)
3. **Vertical Connector Lines:** Dashed lines between rows show half-step relationships
4. **Key Styling:** 
   - Digit row: Dark background (#1e293b) with 40% note color tint
   - F-key row: Light background (#f8fafc) with 20% note color tint

**Files Modified:**
- `src/components/LiveKeyboard.tsx` - Complete rewrite with staggered layout

**Key Mapping:**
```typescript
const PC_KEY_MAPPING: Record<string, string> = {
    // F-key row (bottom) - F8 to F1
    'F8': 'C5',   'F7': 'D5',   'F6': 'E5',   'F5': 'F#5',
    'F4': 'G#5',  'F3': 'A#5',  'F2': 'C6',   'F1': 'D6',
    // Digit row (top, staggered) - 1 to 8
    'Digit1': 'C#5',  'Digit2': 'D#5',  'Digit3': 'F5',   'Digit4': 'G5',
    'Digit5': 'A5',   'Digit6': 'B5',   'Digit7': 'C#6',  'Digit8': 'D#6',
};
```

**Animation Features:**
- 3D press effect with shadow (3-4px offset when active)
- LED rim glow using note color with drop-shadow filter
- Press animation with CSS transition (0.03s ease-out)
- Chromatic color tint visible on inactive keys

**Text-to-Image Prompt:**
> "Music software interface showing isomorphic keyboard layout, two horizontal rows of square buttons offset by half-width, top row shifted right creating staggered brick pattern, each button colored by musical note (rainbow chromatic spectrum), bottom row labeled F1-F8, top row labeled 1-8, thin glowing lines connecting vertically adjacent keys, dark background with subtle grid, modern electronic music production UI, minimalist design, high contrast, professional DAW aesthetic"

**Pros:** Zero mapping changes; immediately shows the half-step vertical relationship.  
**Cons:** Not a true piano shape — some "accidental-looking" positions hold natural notes (F, G).

---

### Concept 3 — Column-Pair Tombstone Layout

**Philosophy:** Group each column as a vertical pair (F-key + Digit key). Render each pair
inside a rounded "tombstone" container. Columns 3 and 7 (where the whole-tone gap aligns with
the piano E/F and B/C boundaries) receive a subtle highlight border to signal the octave seam.

**Visual layout (8 columns):**

```
╔══════╗ ╔══════╗ ╔══════╗ ╔══════╗ ╔══════╗ ╔══════╗ ╔══════╗ ╔══════╗
║ [1 ] ║ ║ [2 ] ║ ║ [3 ] ║ ║ [4 ] ║ ║ [5 ] ║ ║ [6 ] ║ ║ [7 ] ║ ║ [8 ] ║
║ C#4  ║ ║ D#4  ║ ║  F4  ║ ║  G4  ║ ║  A4  ║ ║  B4  ║ ║ C#5  ║ ║ D#5  ║
╠══════╣ ╠══════╣ ╠══╤═══╣ ╠══════╣ ╠══════╣ ╠══════╣ ╠══╤═══╣ ╠══════╣
║ [F1] ║ ║ [F2] ║ ║[F3]  ║ ║ [F4] ║ ║ [F5] ║ ║ [F6] ║ ║[F7]  ║ ║ [F8] ║
║  C4  ║ ║  D4  ║ ║  E4  ║ ║ F#4  ║ ║ G#4  ║ ║ A#4  ║ ║  C5  ║ ║  D5  ║
╚══════╝ ╚══════╝ ╚══════╝ ╚══════╝ ╚══════╝ ╚══════╝ ╚══════╝ ╚══════╝
         ◄──── whole step ────►
```

Columns 3 and 7 get a dashed amber border to mark the octave seam. Arrow labels along the
bottom show horizontal = whole step.

**Expanded Implementation Details:**

1. **Tombstone Container:** Rounded rectangle (`border-radius: 12px`) with gradient background
2. **Column Grouping:** Each pair shares a subtle background tint (alternating per column)
3. **Seam Highlighting:** Columns 3 and 7 have:
   - Dashed amber/gold border (`border: 2px dashed #ffb800`)
   - Subtle background pulse animation
   - Small "seam" label at bottom
4. **Vertical Layout:** Top button (Digit) smaller (40% height), bottom button (F-key) larger (60% height)
5. **Connection Lines:** Bézier curves between column pairs showing the whole-tone relationship

**Animation Suggestions:**
- Tombstone containers gently "breathe" (scale 1.0 → 1.02) when notes in that column are active
- Seam columns flash briefly when crossing octave boundaries during playback
- Column pairs slide together slightly when both notes are pressed

**Implementation (CSS Grid, flex column per pair):**
```tsx
// 8 pair containers in a row
<div className="grid grid-cols-8 gap-2">
  {pairs.map(({ fKey, digit }) => (
    <div className="flex flex-col gap-1" key={fKey.note}>
      <KeyButton note={digit} label="digit" />
      <KeyButton note={fKey}  label="fkey"  />
    </div>
  ))}
</div>
```

**Text-to-Image Prompt:**
> "Digital music controller interface, eight vertical tombstone-shaped containers arranged horizontally, each container holds two stacked square buttons, rounded corners with gradient fills from dark blue to purple, columns 3 and 7 highlighted with golden dashed borders, small labels F1-F8 and 1-8 on buttons, glowing amber seam indicators, musical note names C-D-E-F# etc, dark glassmorphism UI, subtle ambient lighting, professional synthesizer plugin design, futuristic music technology aesthetic"

**Pros:** Keeps whole-tone logic; the column grouping makes ±½-step immediately obvious.  
**Cons:** Doesn't resemble a traditional piano; vertical scanning is needed to read accidentals.

---

### Concept 4 — Dual-Row with Octave Colour Bands

**Philosophy:** Maintain two horizontal rows (F-keys on bottom, Digit keys on top with offset)
but wrap each complete octave (7 white keys + 5 black keys) in a translucent colour band. This
makes octave boundaries obvious while preserving the stagger shape. Each octave band gets a
unique hue from the existing `getNoteColor` palette.

**Visual layout:**

```
┌──── Octave 4 (cyan band) ─────────────────────────────┐  ┌──── Octave 5 ──┐
│    [C#] [D#] [F ] [G ] [A ] [B ]                      │  │ [C#] [D#] ...  │
│ [C ] [D ] [E ] [F#] [G#] [A#]                         │  │ [C ] [D ] ...  │
└───────────────────────────────────────────────────────┘  └────────────────┘

  ↕ half step    ◄──── whole step ────►
```

Each band is a semi-transparent rounded rectangle behind the keys. The stagger offset (½ key
width) on the top row is the same as Concept 2.

**Expanded Implementation Details:**

1. **Octave Band Colors:**
   - Octave 2: Deep Purple (rgba(88, 28, 135, 0.15))
   - Octave 3: Indigo (rgba(63, 81, 181, 0.15))
   - Octave 4: Cyan (rgba(0, 188, 212, 0.15))
   - Octave 5: Lime (rgba(205, 220, 57, 0.15))
2. **Band Geometry:** Each band spans 6 column-pairs (representing the 6 whole-tone steps per octave)
3. **Visual Depth:** Bands sit on a lower z-index with `backdrop-filter: blur(4px)`
4. **Octave Labels:** Small text in top-left corner of each band ("Oct 4", "Oct 5")
5. **Intersection Highlights:** Where bands meet, a subtle gradient blend occurs

**Animation Suggestions:**
- Bands brighten (increase opacity) when any note within that octave is played
- Playing a note causes a "ripple" effect within its octave band
- Octave boundaries pulse when notes on either side are played in succession

**Implementation:**
```tsx
// Draw an SVG <rect> band behind each set of 6 columns (one octave)
<rect
  x={octaveStart * (keyWidth + gap) - padding}
  y={-padding}
  width={6 * (keyWidth + gap) + 2 * padding}
  height={keyHeight * 2 + rowGap + 2 * padding}
  rx={8} fill={octaveColor} fillOpacity={0.08}
/>
```

**Text-to-Image Prompt:**
> "Electronic music production software UI, isomorphic keyboard with two staggered rows of buttons, semi-transparent colored bands behind keys marking octaves, cyan band for octave 4, lime green band for octave 5, overlapping regions with gradient blends, top row offset half-key right, individual keys colored by note, subtle glowing borders, dark mode interface, frosted glass effect, octave labels in corners, modern synthesizer plugin design, clean vector aesthetic, ambient electronic music vibe"

**Pros:** Octave landmarks at a glance; no mapping change; colour coding aids recognition.  
**Cons:** Adding per-octave bands adds visual noise; bands need to account for the half-key stagger offset.

---

### Concept 5 — Perspective Piano (SVG Trapezoid Keys)

**Philosophy:** Render keys as SVG trapezoids to simulate the player's angle of view at a real
piano. White keys taper slightly toward the top; black keys are shorter and centred between
their natural neighbours. Piano gaps at E/F and B/C are empty space (no button rendered).

**Visual layout (one octave, angled view):**

```
        ▄▄▄▄  ▄▄▄▄        ▄▄▄▄  ▄▄▄▄  ▄▄▄▄
        [C#]  [D#]        [F#]  [G#]  [A#]     ← black keys (shorter, darker)
    ████   ████   ████████   ████   ████   ████ ← white keys (taller, lighter)
    [C ]  [D ]  [E ]  [F ]  [G ]  [A ]  [B ]
```

White keys: tall parallelogram (full height, slight perspective taper).  
Black keys: 60 % height, narrower, overlaid on top of white key group.

**Expanded Implementation Details:**

1. **Trapezoid Geometry:**
   - White keys: Bottom width 60px, top width 50px, height 100px, slight inward angle
   - Black keys: Bottom width 36px, top width 30px, height 60px, positioned at y=0
2. **Perspective Effect:**
   - Keys taper toward top (simulating depth)
   - Subtle gradient from bottom (lighter) to top (darker)
   - Drop shadows on white keys where black keys overlap
3. **Gap Visualization:**
   - Empty space between E-F and B-C with subtle background texture
   - Gap width equals approximately ½ of a white key
4. **Labels:**
   - White keys: Large note name at bottom, small F-key label at top
   - Black keys: Sharp name centered, Digit key label at very top

**Animation Suggestions:**
- Keys have 3D press effect (rotateX 5° when pressed)
- Black keys have more pronounced shadow animation
- Perspective shift slightly based on mouse position (parallax effect)

**SVG trapezoid key shape:**
```tsx
const whiteKeyPath = (x: number, w: number, h: number) =>
  `M${x},${h} L${x + 2},0 L${x + w - 2},0 L${x + w},${h} Z`;
const blackKeyPath = (x: number, w: number, h: number) =>
  `M${x},${h * 0.6} L${x + 2},0 L${x + w - 2},0 L${x + w},${h * 0.6} Z`;
```

**Text-to-Image Prompt:**
> "3D perspective piano keyboard rendered in software synthesizer UI, trapezoid shaped keys tapering toward top, seven cream-colored white keys with F1-F8 labels, five shorter dark charcoal black keys with 1-5 labels, realistic depth and drop shadows, piano gaps visible between E-F and B-C, angled viewpoint from player's perspective, glossy key surfaces with reflection, dark background, professional music production software, photorealistic 3D render, ambient studio lighting, ultra detailed"

**Pros:** Most visually piano-like; beautiful, immersive UI; clear separation of tiers.  
**Cons:** Requires key remapping; perspective math increases SVG complexity; piano gaps mean
some Digit key slots are unused.

---

## Bonus Concepts

### Concept 6 — Hexagonal Isomorphic Grid
Transform the keyboard into a hexagonal grid where each hexagon represents a note. This is the ultimate isomorphic layout:
- **Horizontal:** Whole steps
- **Diagonal down-right:** Half steps
- **Visual:** Honeycomb pattern with note colors

**Text-to-Image Prompt:**
> "Futuristic hexagonal isomorphic keyboard interface, honeycomb grid of hexagonal buttons, each hex colored by musical note in rainbow spectrum, whole-tone horizontal stepping, half-tone diagonal, dark mode UI with glowing hex edges, electronic music software, sci-fi music controller design, neon accents, high tech aesthetic"

### Concept 7 — Circular Note Wheel
Arrange notes in concentric circles or a spiral:
- Inner ring: Naturals (C-D-E-F-G-A-B)
- Outer ring: Accidentals (sharps/flats between naturals)
- **Visual:** Radial piano layout similar to a Tonnetz diagram

**Text-to-Image Prompt:**
> "Circular piano keyboard layout on screen, concentric rings of buttons, inner ring with seven large cream keys labeled C-D-E-F-G-A-B, outer ring with five smaller dark keys for sharps, radial arrangement like note wheel, glowing connections between related notes, dark background, mystical music theory visualization, modern music production UI, ambient lighting"

### Concept 8 — Waveform Keys
Each key displays the actual waveform of the sound it represents:
- Keys are rectangles with animated waveform lines
- **Visual:** Sonic representation as the key shape itself

**Text-to-Image Prompt:**
> "Audio waveform keyboard interface, each key displays animated sound wave visualization, oscilloscope-style lines within button boundaries, different wave shapes for each note, dark cyberpunk aesthetic, glowing cyan waveform traces, electronic music synthesizer UI, high tech music production environment"

---

## Comparison Matrix

| # | Name                     | Mapping change? | Piano gaps? | Stagger? | Octave landmarks | Complexity |
|---|--------------------------|:--------------:|:-----------:|:--------:|:----------------:|:----------:|
| 1 | True Piano Split         | Yes            | Yes         | Yes      | Via gaps         | Medium     |
| 2 | Whole-Tone Stagger       | **No**         | No          | Yes      | None             | Low        |
| 3 | Column-Pair Tombstone    | **No**         | Suggested   | No       | Seam border      | Low-Medium |
| 4 | Dual-Row Colour Bands    | **No**         | No          | Yes      | Colour bands     | Medium     |
| 5 | Perspective Piano        | Yes            | Yes         | Yes (3D) | Via gaps         | High       |
| 6 | Hexagonal Isomorphic     | **No**         | No          | N/A      | Ring bands       | High       |
| 7 | Circular Note Wheel      | Yes            | N/A         | N/A      | Rings            | High       |
| 8 | Waveform Keys            | **No**         | No          | No       | None             | Medium     |

---

## Recommendation

**Concept 2 (Whole-Tone Stagger)** is now ✅ **IMPLEMENTED**. This quick, zero-risk improvement 
adds the `translate(keyWidth / 2, 0)` offset to the Digit row and colors each key by its chromatic
identity. This immediately communicates the half-step relationship without touching the mapping.

**Next Steps:**
- Layer in **Concept 4 (Colour Bands)** on top of Concept 2 to add octave landmarks
- For a deeper redesign targeting piano intuitiveness, implement **Concept 1 or 5** with remapped key assignments

**Progressive Enhancement Path:**
1. ✅ **Week 1:** Concept 2 (stagger + chromatic coloring) - DONE
2. **Week 2:** Add Concept 4 (octave bands) on top of Concept 2
3. **Week 3:** A/B test Concept 1 (true piano split) with power users
4. **Month 2:** If positive feedback, implement Concept 5 (perspective 3D)

---

## Implementation Notes

* **SVG approach (current):** Add a `transform` translate to the top row; draw background
  `<rect>` bands for octaves. Minimal changes to `LiveKeyboard.tsx`.
* **CSS Grid approach:** Replace the SVG with a `div` grid. Use
  `grid-template-columns: repeat(12, 1fr)` with named grid lines for gaps. More flexible
  for responsive sizing but requires reworking the existing SVG-based `LiveKey` component.
* **Piano gap columns:** In a 12-column grid, columns 4 (E/F boundary) and 11 (B/C boundary)
  per octave should be left empty for Concepts 1 and 5.
* **Performance:** For Concepts 4 and 5 with complex SVG, consider:
  - Using `will-change: transform` on animated keys
  - Debouncing hover effects
  - Using CSS containment (`contain: layout paint`) on keyboard container

---

## Accessibility Considerations

1. **Color Blindness:** Ensure note identity is conveyed through more than just color:
   - Shape (naturals = wide, accidentals = narrow)
   - Labels (always show note names)
   - Position (stagger creates visual grouping)

2. **Screen Readers:** Add ARIA labels:
   ```tsx
   <button aria-label="F1 - C4 Natural" data-note="C4" ... />
   <button aria-label="1 - C#4 Sharp" data-note="C#4" ... />
   ```

3. **High Contrast Mode:** Support `prefers-contrast: high`:
   - Increase border widths
   - Ensure minimum 4.5:1 contrast ratio
   - Remove transparency effects

4. **Reduced Motion:** Support `prefers-reduced-motion`:
   - Disable press animations
   - Remove continuous pulse effects
   - Keep only essential state changes

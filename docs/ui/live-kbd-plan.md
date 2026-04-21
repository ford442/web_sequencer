# Live Keyboard UI — Layout Plan

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

**Implementation (CSS Grid, 14 columns):**
```css
/* 14-column grid: each natural = 2 cols, each gap = 1 col */
grid-template-columns: repeat(14, 1fr);
/* Naturals occupy bottom row; Accidentals the top row with column offsets */
/* E/F gap: column 7 empty; B/C gap: column 14 empty */
```

**Pros:** Exactly mirrors a real piano; muscle memory transfers naturally.  
**Cons:** Breaks the whole-tone stepping; horizontal movement is no longer uniform.

---

### Concept 2 — Whole-Tone Stagger (Keep Mapping, Add Offset)

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

**Implementation (SVG transform):**
```tsx
// Digit row: translate X by keyWidth / 2
<g transform={`translate(${keyWidth / 2}, 0)`}>
  {digitNotes.map(...)}
</g>
// F-key row: translate X by 0 (flush left)
<g transform="translate(0, 0)">
  {fkeyNotes.map(...)}
</g>
```

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

**SVG trapezoid key shape:**
```tsx
const whiteKeyPath = (x: number, w: number, h: number) =>
  `M${x},${h} L${x + 2},0 L${x + w - 2},0 L${x + w},${h} Z`;
const blackKeyPath = (x: number, w: number, h: number) =>
  `M${x},${h * 0.6} L${x + 2},0 L${x + w - 2},0 L${x + w},${h * 0.6} Z`;
```

Key label (F1, 1-8) appears at the bottom of each key, small monospace text.  
Requires a **remapping** identical to Concept 1 (F-keys = naturals, Digit keys = accidentals
with piano gaps).

**Pros:** Most visually piano-like; beautiful, immersive UI; clear separation of tiers.  
**Cons:** Requires key remapping; perspective math increases SVG complexity; piano gaps mean
some Digit key slots are unused.

---

## Comparison Matrix

| # | Name                     | Mapping change? | Piano gaps? | Stagger? | Octave landmarks | Complexity |
|---|--------------------------|:--------------:|:-----------:|:--------:|:----------------:|:----------:|
| 1 | True Piano Split         | Yes            | Yes         | Yes      | Via gaps         | Medium     |
| 2 | Whole-Tone Stagger       | **No**         | No          | Yes      | None             | Low        |
| 3 | Column-Pair Tombstone    | **No**         | Suggested   | No       | Seam border      | Low-Medium |
| 4 | Dual-Row Colour Bands    | **No**         | No          | Yes      | Colour bands     | Medium     |
| 5 | Perspective Piano        | Yes            | Yes         | Yes (3D) | Via gaps         | High       |

## Recommendation

**Start with Concept 2 (Whole-Tone Stagger)** as a quick, zero-risk improvement — just add
the `translate(keyWidth / 2, 0)` offset to the Digit row and colour each key by its chromatic
identity. This immediately communicates the half-step relationship without touching the mapping.

Layer in **Concept 4 (Colour Bands)** on top of Concept 2 to add octave landmarks.

For a deeper redesign targeting piano intuitiveness, implement **Concept 1 or 5** with the
remapped key assignments.

## Implementation Notes

* **SVG approach (current):** Add a `transform` translate to the top row; draw background
  `<rect>` bands for octaves. Minimal changes to `LiveKeyboard.tsx`.
* **CSS Grid approach:** Replace the SVG with a `div` grid. Use
  `grid-template-columns: repeat(12, 1fr)` with named grid lines for gaps. More flexible
  for responsive sizing but requires reworking the existing SVG-based `LiveKey` component.
* **Piano gap columns:** In a 12-column grid, columns 4 (E/F boundary) and 11 (B/C boundary)
  per octave should be left empty for Concepts 1 and 5.


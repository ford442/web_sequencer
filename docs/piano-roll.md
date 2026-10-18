# Piano roll

Design note for #1345 Phase 1. A pitch-over-time editor for the melodic
tracks (SYNTH A / SYNTH B / BASS 2 and each sampler bank), opened from the
**piano-roll chip** in the sequencer row header (the glyph above the M/S
pads). It is a lazy chunk (`src/components/piano-roll/`); closed, nothing of
it mounts.

## A view, not a store

The roll is a projection of `PartSequence.steps`. It never keeps notes of
its own:

| Note field | In the roll |
|------------|-------------|
| step index (+ `microtiming`, −0.5…0.5) | x |
| `length` (default 1) | width |
| `note` | y — the root voice |
| `chord[i]` | stacked notes on the same step |
| `slide` | a tie from the previous note |
| `velocity` / `probability` / `timbre` | the lane under the grid |

Every edit is a pure function in `model/rollEdits.ts` (`drawNote`,
`moveNotes`, `resizeNotes`, `duplicateNotes`, `quantizeNotes`,
`lockNotesToScale`, `setLaneValue`, …) from steps to steps. The result is
committed through `usePatternHandlers.handleReplaceTrackSteps` — one
`undoRedo.push` per gesture, the same track-storage update every grid edit
makes. Paste goes through `handlePasteTrackSteps`, which is the grid's own
`pasteSteps`, and Copy writes the app clipboard in the grid's format, so
copy in the roll / paste in the grid (and back) just works.

The step model has one note-start per step, so the voices of a step share
start, length and lane values: moving any voice in time moves the step;
changing its pitch changes only that voice. Notes the roll creates have the
exact shape the grid writes, and a length edit clears the steps it now
covers like the grid's length edit does — `gridParity.test.tsx` pins that
the same edit in either view gives the same pattern.

## Rendering

`render/rollScene.ts` turns the visible window into a flat list of coloured
quads (CSS px, clipped to the keys / grid / lane regions). Two renderers
draw that same list:

- **WebGPU** — one instanced-quad pipeline on the shared device
  (`rollRenderers.ts`), started through `startGpuCanvasSession`, so a lost
  device is rebuilt on the restored one without a remount.
- **Canvas2D** — on a second canvas when the probe fails, `fillRect` per
  quad. The panel's `data-backend` attribute and the Engine HUD say which.

`RollPainter` (`useRollPainter.ts`) owns what is drawn outside React. Edits,
scrolling and drag previews mark it dirty; one `requestAnimationFrame` loop
rebuilds the scene only when dirty and otherwise redraws just the playhead
quad, so an idle roll submits nothing and playback re-renders no component.

The playhead comes from `src/sequencer/transportPlayhead.ts`, published by
the step handler at each step's audio time with **each track's** step, so a
track with its own loop length (polyrhythm) or a clip in the arrangement
shows the step of its own pattern. It interpolates across the step.

## Editing

| Pointer | Action |
|---------|--------|
| Click / drag on empty grid (Draw tool) | add a note; drag right sets its length |
| Drag a note | move (time snaps by the grid unit, offsets are kept) and transpose |
| Drag a note's right edge | resize |
| Shift+click | add / remove from the selection |
| Drag on empty grid (Select tool, or Shift) | marquee |
| Right-click a note | delete |
| Drag in the lane | paint velocity / probability / timbre |

Grid unit: 1/16 (a step), 1/32 or 1/64 — finer positions become
`microtiming`. **Scale lock** (needs a scale from the transport bar) snaps
drawn and moved pitches to it and makes ↑/↓ walk scale degrees. **Ghosts**
draws the other melodic tracks dimmed behind this one.

## Keyboard and screen readers

The grid is a focusable `role="application"` with a cursor cell; every
pointer edit has a key (`model/rollKeyboard.ts`). Cursor moves and edits are
spoken through `a11yAnnouncerStore` ("C4, step 5, length 2, velocity 80%",
"Moved 3 notes"). `?` reads the key map.

| Key | Action |
|-----|--------|
| Arrows (Shift: a beat / an octave), PageUp/Down, Home/End | move the cursor |
| Ctrl+←/→ | jump to the previous / next note |
| Enter / Shift+Enter | add or remove a note / toggle it in the selection |
| Alt+arrows | move / transpose the selection (Alt+Shift+↑/↓ an octave) |
| Alt+Shift+←/→, `[` `]` | shorter / longer |
| Delete, Ctrl+D, Q, L, S, `+`/`-` | delete, duplicate, quantize, lock to scale, slide, velocity |
| Ctrl+A, Ctrl+C, Ctrl+V | select all, copy, paste at the cursor |
| Escape | clear the selection, then close (focus returns to the chip) |

While the grid has focus it keeps its keys from the window-level shortcuts
(Escape would tape-stop, Delete would clear the grid selection, letters
would play PC-keyboard notes). Space (transport), Tab and Ctrl/Cmd+Z / Y
(the shared undo history the roll's edits are in) pass through.

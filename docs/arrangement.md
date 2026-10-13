# Arrangement timeline (#1342)

The arrangement is the song's **linear record**: clips on a timeline, played by
the one worklet clock. It is a third document on the song next to the pattern
slots (`trackStorage`) and the session grid. It is not a second transport.

| Surface | What it is |
| --- | --- |
| **Arrangement** (`ARR`) | Clips with a start, a length and a loop flag, per track. The stored song and the linear player. |
| **Song Mode** (`SONG`) | One cell per measure and track. A **projection** of the arrangement, kept for the old grid UI and for exports that have not switched yet (XM, `.rbs`). |
| **Session** (`CLIP`) | Non-linear launcher. **CAPTURE** writes arrangement clips. |

## Model

```ts
interface ArrangementClip {
  id: string;            // clip-N, stable within the song
  track: TrackKey;
  patternSlot: number;   // trackStorage[track][patternSlot] — clips never copy notes
  startStep: number;     // song timeline, 16th steps
  lengthSteps: number;   // shorter than the pattern = trim, longer = loop
  loop: boolean;         // false = play the pattern once, then rest
  offsetSteps?: number;  // pattern step at the left edge (head trim), default 0
}
interface Arrangement { clips: ArrangementClip[]; lengthSteps: number /* loop point */ }
```

- Pure functions live in `src/arrangement/model.ts`. Arrangements are immutable
  values, so undo history holds them by reference and the playback index caches
  on identity.
- **Overlap rule:** a clip placed on a track wins. Clips under it are trimmed,
  split or removed (`placeClip`). There are never two clips sounding on one track.
- **Loop point:** `arrangementEnd()` is `max(lengthSteps, last clip end)`. The
  linear player wraps there. Exports stop at the last clip's end.

## Playback

`useStepHandler` keeps a song position that advances one step per worklet step.
For each track, `resolveArrangementFrame()` (`src/arrangement/playback.ts`)
returns the slot and the **clip-local step**:

```
local = offsetSteps + (songStep − startStep)
loop:      local % trackLoopLength(meter, track)
one-shot:  local < trackLoopLength ? local : rest
```

Loop lengths come from the song meter (`stepCount` / `trackLengths`, #1340).
Nothing on this path assumes 32 steps. Per-track loops re-anchor at each clip's
start. A migrated song has one clip per measure, so it re-anchors per measure,
exactly like Song Mode did.

- `songMeasureRef` is `floor(songStep / stepCount)`. It drives the Song Mode
  highlight, RBS TRAK scheduling and `scope: 'pattern'` automation, as before.
- Automation lanes stay **song-global** in v1. Clip-local automation is a follow-up.
- The playhead is published through `arrangementPlayhead`
  (`src/arrangement/playhead.ts`). The ARR view moves it imperatively, never
  through React state.

### Session vs arrangement

The same rules as Song Mode vs Session (see [session-launcher.md](session-launcher.md)).
The arrangement *is* the linear player behind the `LOOP SONG` toggle. Arming
it stops session clips. A live clip, scene, MIDI or gamepad launch preempts it
at the quantized boundary.

## Song Mode compatibility

- `useSongModeState` stores only the arrangement. `songStructure` is
  `projectArrangement(arrangement, stepCount)`: per measure and track, the slot
  of the clip covering most of that measure.
- Song Mode grid edits go through `setSongStructure`, which **lifts** them
  (`liftStructureEdit`). Only cells that changed are touched: that measure is cut
  out of the track and refilled with one measure-long clip. Trimmed or
  off-grid clips elsewhere are kept.
- Undo/redo (`useSongStructureEditor`) holds whole arrangements, so Song Mode
  edits and ARR edits share one stack.
- Changing the pattern length does not move clips. Positions are absolute
  steps, and the projection re-cuts the same clips into the new measures.

## Persistence (`SavedSongData` v5)

- Saves `arrangement` plus `songStructure` (the projection) for older readers.
- Loading: a valid `arrangement` is used as-is (`normalizeArrangement` drops
  malformed clips and resolves overlaps). v1–v4 songs, and v5 files without
  one (RBS, SMF and AI imports), are migrated: one clip per occupied cell,
  `lengthSteps = stepCount`, loop on.

## Export

`resolveSongTimeline(..., arrangement)` walks clips
(`resolveArrangementTimeline`). Gaps and the tail of a one-shot clip are rests,
the same as live playback. Callers that only pass a `songStructure` get it
migrated first. Stem export and SMF export pass the arrangement. XM and `.rbs`
still read the projection.

## Capture

`captureEventsToArrangement()` turns each applied launch into a clip that runs
until the next launch or stop on its track, or until CAPTURE is released
(rounded up to a measure). The timeline starts at the bar of the first launch.
Finishing a capture replaces the arrangement (one undo step) and opens ARR.

## UI (`src/components/ArrangementView.tsx`, lazy)

- `ARR` in the transport toolbar. Nothing mounts while it is closed.
- Lanes per track. Clips show `P<slot>`, loop restarts (ticks) and a hatched,
  silent tail for one-shot clips.
- **Add:** the lane's `+` (after the last clip) or double-click a lane. A new
  clip references the track's currently selected slot.
- **Pointer:** drag to move; drag the right edge to trim or extend; drag the
  left edge to trim the head (the notes stay in place). Bar zoom snaps to beats,
  4-bar zoom to bars, and Shift snaps to steps. A drag commits once on release,
  as one undo step.
- **Keyboard (focused clip):** ←/→ move, Shift+←/→ resize, Alt for step snap,
  `L` loop, Del delete.

## Tests

- Model / playback: `src/arrangement/__tests__/`
- Linear player: `src/hooks/__tests__/useStepHandler.arrangement.test.ts`
- Save/load: `src/hooks/__tests__/useSongStorage.arrangement.test.ts`
- Capture: `src/session/__tests__/captureArrangement.test.ts`
- Export: `src/__tests__/songTimeline.test.ts`
- View: `src/components/__tests__/ArrangementView.test.tsx`. Render budget:
  `src/__tests__/appRenderBudget.test.tsx`
- E2E: `tests/arrangement.spec.ts`. The `?e2e=1` probe logs drum triggers with
  their song step in `window.__HYPHON_E2E_DRUM_HITS__`.

## Not in v1

Clip-local automation, XM/RBS export from clips, per-clip meter changes, clip
colours and names, an ARR button in the mobile dock, Ableton Link, and
multi-user editing.

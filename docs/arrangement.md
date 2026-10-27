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
  lanes?: UnifiedAutomationLane[]; // clip-local automation (#1494), steps 0..lengthSteps
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
- Automation: see [Clip-local automation](#clip-local-automation-1494).
- The playhead is published through `arrangementPlayhead`
  (`src/arrangement/playhead.ts`). The ARR view moves it imperatively, never
  through React state.

### Session vs arrangement

The same rules as Song Mode vs Session (see [session-launcher.md](session-launcher.md)).
The arrangement *is* the linear player behind the `LOOP SONG` toggle. Arming
it stops session clips. A live clip, scene, MIDI or gamepad launch preempts it
at the quantized boundary.

## Clip-local automation (#1494)

A clip can carry its own lanes (`ArrangementClip.lanes`): the same
`UnifiedAutomationLane` shape as the song lanes, but a point's `step` is
**clip-local** — `0` is the clip's left edge, `lengthSteps` its right edge.

- **Layering.** `layerClipLanes(songLanes, arrangement, songStep)`
  (`src/arrangement/playback.ts`) puts the lanes of every clip sounding at
  `songStep` ahead of the song lanes. The resolver's "first lane per
  `target:parameter` with a value wins" rule then gives the clip value on the
  steps the clip covers and leaves the song lane alone everywhere else. A clip
  lane with no points, or disabled, falls through to the song lane.
- **One resolver.** `useStepHandler` (per-note overrides, the scheduler, the
  knob live values) and `resolveLaneTimeline` (stems, song preview, anything on
  `offlineLaneAutomation`) both call it with the same song step, so a bounce
  plays the value the live clock played. Lanes the offline master cannot render
  (PCF) are still reported, not bypassed.
- **Editing.** The focused clip's lanes are edited under the ARR inspector
  (`ClipLanePanel`, using the existing `CurveEditor`), in clip-local steps.
  Moving a clip moves its lanes. A head trim shifts `offsetSteps` and the lane
  origin together (`updateClip`); a split shifts the right half's lanes, and the
  overlap rule trims a clip without touching its lanes. Each lane edit is one
  arrangement value, so one undo step on the stack Song Mode shares.
- **Persistence.** Optional field, still `SavedSongData` v5.
  `normalizeArrangement` keeps valid lanes (bad points dropped, points sorted);
  a v5 file without clip lanes loads unchanged.

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
migrated first. Every export walks the timeline (#1494):

- **Stems, SMF, song preview** pass the arrangement; stems and the preview also
  layer clip lanes onto their automation.
- **XM** (`buildXmSongPatterns({ arrangement })`): one XM pattern per measure
  of the timeline; the last pattern is as long as what is left of the song.
- **`.rbs`** (`bakeArrangementForRbs`): each measure of the timeline becomes one
  pattern per ReBirth device (TB-303 #1, TB-303 #2, drums); identical measures
  share a slot. A measure with nothing playing on a device selects an empty
  pattern, so gaps stay rests. More than 32 distinct bars on one device is
  reported and the song is cut there. Imported
  TRAK pattern selects are replaced by the baked ones; knob moves are kept.

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

- Model / playback / clip lanes: `src/arrangement/__tests__/`
- Clip lanes on export: `src/__tests__/arrangementExport.test.ts` (XM, `.rbs`),
  `src/utils/__tests__/stemExport.automation.test.ts`,
  `src/utils/__tests__/clipLanes.preview.test.ts`
- Linear player: `src/hooks/__tests__/useStepHandler.arrangement.test.ts`
- Save/load: `src/hooks/__tests__/useSongStorage.arrangement.test.ts`
- Capture: `src/session/__tests__/captureArrangement.test.ts`
- Export: `src/__tests__/songTimeline.test.ts`
- View: `src/components/__tests__/ArrangementView.test.tsx`. Render budget:
  `src/__tests__/appRenderBudget.test.tsx`
- E2E: `tests/arrangement.spec.ts`, `tests/arrangement-clip-lanes.spec.ts`
  (draw a clip lane, play, the automated CUTOFF control moves). The `?e2e=1` probe logs drum triggers with
  their song step in `window.__HYPHON_E2E_DRUM_HITS__`.

## Not in v1

Per-clip meter changes, clip
colours and names, an ARR button in the mobile dock, Ableton Link, and
multi-user editing.

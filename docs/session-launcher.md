# Session / Clip Launcher

Hyphon’s session view is a **non-linear clip launcher**. It does not start a second transport. Clip and scene launches compile into timestamped events consumed by the existing AudioWorklet clock (`TransportClockController` → `useStepHandler`).

## Model (separated concerns)

| Layer | Responsibility | Code |
| --- | --- | --- |
| Clip content | Pattern data stays in `trackStorage` slots; clips only *reference* `slotIndex` | `src/session/types.ts` |
| Launch state machine | Queue, quantize, apply start/replace/stop | `src/session/SessionLaunchEngine.ts` |
| UI focus | Grid keyboard / gamepad navigation | `src/session/gridKeyboard.ts`, `SessionLauncher.tsx` |
| Arrangement capture | Live events → Song Mode measures | `src/session/capture.ts` |

Stable clip ids: `c:{track}:{slot}` (migration). Scene ids: `s:{row}`.

Persisted as `SavedSongData.session` (song schema **v3**). v1/v2 songs load unchanged; a default session is adapted from occupied pattern slots.

## Quantization

`immediate | step | beat | bar | 2bars | 4bars`

Boundaries are computed from the **last worklet step timestamp**, never from React render time. 1 step = 16th note; 1 beat = 4 steps; 1 bar = 16 steps.

## Launch modes

- **trigger** — loop until another clip or stop
- **toggle** — start if stopped, stop if this clip is playing
- **gate** — play while MIDI/gamepad is held
- **one-shot** — one pattern loop, then stop

Follow actions (at loop end): `next`, `previous`, `random`, `stop`, `repeat` (N loops then stop).

## Conflict rules

1. **Song Mode vs Session** — Enabling Song Mode playback stops session clips. A live clip/scene/MIDI/gamepad launch preempts Song Mode at the quantized boundary.
2. **Scene vs manual** — Later `requestSeq` wins. Equal seq: manual/MIDI/gamepad beats scene. Stop beats start.
3. **Tracks are independent** — Scene atomicity is a shared boundary, not a lock.

Clip transitions call `audioEngine.stopTrackNotes(track)` so hanging synth/sampler notes are flushed (no stuck or doubled notes).

## MIDI Learn & gamepad

Right-click a clip or scene cell (with MIDI Learn) to bind:

| Control id | Action |
| --- | --- |
| `session:clip:{track}:{row}` | Launch clip (gate uses note velocity / CC > 0) |
| `session:scene:{index}` | Launch scene |
| `session:stop:{track}` | Stop one track |
| `session:stopAll` | Stop all clips |

Gamepad (when Session is focused): D-pad moves the grid (same as arrows). Attack (`ControlLeft`) launches the focused clip; Jump (`AltLeft`) launches the scene. See `useGamepad.ts` mappings.

## Capture → Song Mode

**CAPTURE** records applied launches. Stopping capture compiles them into the linear arrangement (`captureEventsToSongStructure`) and opens Song Mode. Replay uses the existing song-mode scheduler.

Undo/redo: session document edits use a dedicated history; capture writes go through song-structure undo.

## Starter packs

Acid Live Set, Vocal Chop Performance, Dual-303 Jam, Minimal Drum Lab (`src/session/packs`).

## Tests

- Unit / property: `src/session/__tests__/sessionLauncher.test.ts`
- Packs: `src/session/__tests__/sessionPacks.test.ts`
- A11y: `src/components/__tests__/SessionLauncherA11y.test.tsx`
- E2E: `tests/session-launcher.spec.ts`

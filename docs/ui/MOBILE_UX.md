# Mobile UX Guide

Hyphon’s compact layout targets **phone portrait** use (iPhone / Android Chrome) without breaking desktop workflows.

## Compact layout

| Control | Behavior |
|---------|----------|
| **FIT / CMP** (transport header) | Toggles compact touch layout. Preference stored in `localStorage` (`hyphon:compact-layout`). |
| **Auto** | Compact activates when viewport &lt; 768px or `(pointer: coarse)`. |

Compact mode:

- Stacks sequencer + rack with viewport-relative heights
- Boosts sequencer zoom to **2.2×** once (if still at default 1.0)
- Shrinks knob labels and widens rack knob hit zones
- Shows **mobile transport dock** (play, rec, BPM, song, panic) above the bottom bar

## Touch targets (44px goal)

- **Sequencer steps**: transparent `step-hit-target` rects expand SVG hit area; pinch/double-tap zoom on timeline.
- **Pattern slots**: `track-slot-hit` padding rects.
- **Rack knobs**: `findHitKnobIndex()` — closest knob wins, 44px min radius, label zone included.
- **Song mode cells**: 48×44px in compact mode; `pointerdown` handlers (no 300ms mouse delay).
- **Transport dock**: 44px minimum tap targets (`mobile-tap-target`).

## Touch-action map

| Surface | `touch-action` |
|---------|----------------|
| Main scroll (`hyphon-main-scroll`) | `pan-y` |
| Sequencer (`hyphon-sequencer-scroll`) | `pan-x pinch-zoom` |
| Rack (`hyphon-rack-surface`) | `none` (prevents scroll during knob drag) |
| Song mode panel | `pan-x pan-y` |

## Manual test checklist (device or DevTools)

1. **Init** — Open app, tap **INITIALIZE SYSTEM**, confirm audio starts.
2. **Sequencer** — Tap kick steps on rows 1–4; drag horizontally to paint; pinch or Ctrl+scroll to zoom if steps feel small.
3. **Knobs** — Open SYNTH A rack; drag filter/volume knobs; verify no page scroll while dragging rack.
4. **Transport** — Use bottom dock: play/stop, REC, BPM ±, SONG toggle.
5. **Song mode** — Open SONG; tap cells to toggle patterns; scroll grid horizontally on narrow width.
6. **Portrait** — Rotate phone; confirm sequencer + one synth panel usable without label overlap (toggle CMP if needed).

## Emulator tips

- Chrome DevTools → device toolbar → iPhone 14 / Pixel 7
- Enable **Touch** in Sensors panel
- Throttle CPU slightly to catch jank during knob drag + playback

## Related

- `src/hooks/useCompactLayout.ts` — layout preference
- `src/utils/touchHitTesting.ts` — rack knob hit testing
- `src/components/sequencer/stepHitGeometry.ts` — step/slot hit rects
- `src/accessibility.css` — global touch-target rules

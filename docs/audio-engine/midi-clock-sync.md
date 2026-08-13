# MIDI Clock Master/Slave Transport Sync

Hyphon supports three transport sync modes:

| Mode | Label | Behavior |
|------|-------|----------|
| **Internal** | INT | Default. AudioWorklet `clock-processor` (unchanged). |
| **Master** | MSTR | Sends MIDI Start/Stop and 24 PPQN Clock to a selected output while playing. |
| **Slave** | SLV | Follows Start/Stop/Continue/Clock and Song Position Pointer on a selected input. |

Preferences persist in `localStorage` under `hyphon.transportSync` (`mode`, `inputDeviceId`, `outputDeviceId`). Live port objects are never persisted.

## Architecture

```
MidiPortManager (single requestMIDIAccess, sysex disabled)
  ├─ channel messages → useMidi / MIDI Learn
  └─ system realtime  → TransportClockController
        ├─ InternalClockAdapter → clock-processor worklet
        ├─ MasterClockAdapter   → internal + MIDI output
        └─ SlaveClockAdapter    → PLL + onStep(step, audioTime)
```

All note and automation scheduling uses `audioTime` from the active clock adapter, never raw message receipt time ([PLAYBACK_STABILITY.md](./PLAYBACK_STABILITY.md)).

## PPQN mapping

Hyphon’s grid is 16th notes:

| Unit | MIDI ticks |
|------|------------|
| Quarter note | 24 |
| 16th step | 6 |
| 32-step pattern | 192 |

## Drift bounds (v1 targets)

Under simulated test fixtures:

- **Steady clock, ±2 ms jitter @ 120 BPM:** phase error ≤ ±5 ms
- **Single dropped clock:** recovery ≤ ±15 ms; no audible step doubling
- **Clock loss:** bounded holdover (~2 beats), then stopped/degraded — **no runaway catch-up burst**

Telemetry: Engine HUD (`Ctrl+Shift+E` or `?hud=1`) → **Transport sync** section (mode, state, measured BPM, phase error, jitter, dropouts, Resync).

## Slave mode UX

- Play toggles **ARM** / **UNARM** (listening for external transport).
- Tempo controls are read-only; BPM display shows **measured** tempo from the PLL.
- Swing is ignored in slave mode (straight 16ths from MIDI clock).

## Failure handling

| Event | Response |
|-------|----------|
| Device disconnect | Degraded state; re-select or reconnect without reload |
| Permission denied | Falls back to Internal |
| Tab background / suspend | Resync on visibility resume; no step burst |
| Missing saved device ID | “device not found” in HUD; pick from dropdown |

## Loopback verification (manual)

### Linux (ALSA)

```bash
# Terminal 1: virtual raw MIDI ports
sudo modprobe snd-virmidi
aconnect -l   # note client numbers

# Connect Hyphon output → clock monitor, or Hyphon master out → Hyphon slave in
aconnect <master_out> <slave_in>
```

### macOS

Use **Audio MIDI Setup → IAC Driver** (enable bus). Route Hyphon master output to slave input in the same bus.

### Proof checklist

1. **Master:** Set SYNC → MSTR, pick output, press Play. Monitor shows `FA` (Start) then 24 × `F8` per quarter note; `FC` on Stop.
2. **Slave:** Set SYNC → SLV, pick input, press ARM. Send Start + Clock from external source (or loopback from master). Sequencer playhead advances; measured BPM in HUD tracks source.
3. **SPP:** While running, send Song Position Pointer mid-song; playhead jumps forward without replaying stale steps.
4. **Disconnect:** Unplug virtual port; HUD shows degraded; reconnect and re-select device — no reload required.

## Tests

```bash
CI=true pnpm exec vitest run src/midi/clock/__tests__ --pool forks
CI=true pnpm exec vitest run src/hooks/__tests__/useScheduler.test.ts --pool forks
```

## Out of scope (v1)

- Ableton Link
- MIDI Time Code (MTC)
- Sysex
- Per-song sync settings
- Swing over external clock

# Playback Stability & Jitter Thresholds

> Guidance for song-mode + automation stress under load. Instrumentation lives in
> `src/audio/playback/PlaybackHealthMonitor.ts`.

## Acceptable thresholds

| Metric | Warn | Action |
|--------|------|--------|
| Automation scheduler lag | > **8 ms** behind `AudioContext.currentTime` | Log + degradation banner |
| Automation scheduler lag | > **32 ms** | Force immediate apply (drop scheduled delay) |
| Pending automation callbacks | > **256** | Coalesce per `target:parameter`, drop oldest |
| Voice steals | > **10 / second** | Warn (sampler or synth polyphony saturated) |
| Duplicate step callback | < **4 ms** since last same step | Suppress duplicate (clock echo) |

These values target **inaudible** glitching on a mid-tier laptop at 120 BPM, 32-step patterns, 4+ automated tracks, and song-mode pattern switches every bar.

## What “clean for minutes” means

- No audible crackle from worklet message floods
- No stuck notes from voice steal without `noteOff`
- No zipper noise from automation applied at `currentTime` instead of step `audioTime`
- UI playhead may lag ≤1 frame; audio clock is authoritative

## Architecture

```
clock-processor (audio thread)
    → onStep(step, audioTime)
        → useStepHandler (notes + lanes)
        → AutomationScheduler.scheduleFromLanes(audioTime)
            → Open303Manager.scheduleParamAtTime(audioTime)
            → ProphecyManager.scheduleParamAtTime(audioTime)
```

**Rule:** All parameter updates use `audioTime` from the clock worklet, never `requestAnimationFrame` time.

## Instrumentation

- `playbackHealthMonitor.recordSchedulerLag(ms)` — automation applied late
- `playbackHealthMonitor.recordVoiceSteal(engine)` — polyphony steal
- `playbackHealthMonitor.recordBackpressure(source)` — pending queue saturated
- `playbackHealthMonitor.getSnapshot()` — devtools / engine report

## Stress test

```bash
CI=true pnpm exec vitest run src/__tests__/playbackStress.test.ts --pool forks
```

Simulates 32 steps × 8 automation lanes + TRAK burst + voice steals without exceeding pending caps.

## Tuning tips

1. Reduce active automation lanes in song mode (disable unused TB-303 sweeps).
2. Prefer step-indexed lanes over ultra-dense TRAK when importing RBS.
3. Lower sampler choir width under heavy polyphony.
4. Use `pnpm exec vitest run src/__tests__/AutomationScheduler.test.ts` after scheduler changes.

## AudioContext latency mode & sample-rate policy (#1033 / #1136)

Live playback creates its `AudioContext` with an explicit `latencyHint`
(`interactive` | `balanced` | `playback`) and an optional `sampleRate`.
Both are user-selectable in the Engine HUD (`Ctrl+Shift+E`, or `?hud=1`)
and persisted in `localStorage`:

- `hyphon.audioLatencyMode` via `src/utils/audioLatencyMode.ts`
- `hyphon.audioSampleRate` (`native` | `44100` | `48000`) via
  `src/utils/audioContextPolicy.ts`

Construction is centralized in `src/hooks/audioEngine/audioContextFactory.ts`.
**Device native is the default** (`sampleRate` omitted from
`AudioContextOptions`). A 44.1 / 48 kHz request that throws or is ignored
by the browser **falls back to native** without crashing init; Engine HUD
shows requested vs actual rate and the fallback reason.

A latency or sample-rate change only takes effect on the next context
construction. Use **Apply & restart audio** in the HUD (page reload). It is
not hot-swapped into a running graph.

**Convert once on load:** sampler banks, TTS/ONNX PCM, and WAV oscillators
must match `context.sampleRate` after load (`ensureBufferMatchesContext` in
`src/utils/resampleAudioBuffer.ts`). Never resample inside worklet
`process()`. `AudioWorkletGlobalScope.sampleRate` is the live rate;
`?? 44100` / `resolveWorkletSampleRate` only runs when that value is
missing (tests / non-worklet hosts).

**Output device:** Chromium `AudioContext.setSinkId` is optional and
feature-detected (`src/utils/audioOutputDevice.ts`). Firefox/Safari hide
the HUD picker and stay on the default device. Prefs store `groupId` +
`label` (`hyphon.audioOutputDevice`), not a session-only `deviceId`.

Offline export paths are unaffected — they keep constructing
`OfflineAudioContext` at a user-chosen 44100/48000 regardless of the live
playback policy. The export modal still prefers the **actual** live
`context.sampleRate` when it is 44.1 or 48 kHz.

The negotiated `sampleRate`, requested rate, sink label, `baseLatency`,
and `outputLatency` are logged to `engineTelemetry`
(`recordAudioContextInfo` / `recordAudioOutputSink` / `recordOutputLatency`)
and surfaced in the Engine HUD's "Audio thread" section.

## Related

- [automation.md](../automation.md) — lane model
- [jc303-prophecy.md](jc303-prophecy.md) — engine routing

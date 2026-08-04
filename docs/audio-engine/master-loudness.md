# Master True-Peak Limiter & BS.1770 Loudness Metering

Broadcast-style loudness for the master bus: momentary / short-term / gated
integrated LUFS, true-peak (dBTP) metering, and a real-time true-peak brick-wall
limiter. Everything is first-party — no runtime DSP dependency, no network use.

## Where it sits

```
… → masterCompressor → masterGain → masterPanner → masterLimiter → destination
```

`masterLimiter` is the last insert before `destination` (`defaultElectribeGraph.ts`),
so it protects and measures *everything* — including the choir buses that bypass the
master FX chain by entering at `masterGain`.

The node is an AudioWorklet, so it is created **before** the graph is compiled
(`createMasterLoudnessStage` → `buildClassicElectribeGraph({ masterLimiterNode })`).
If the worklet cannot be registered, `compileAudioGraph` bridges
`masterPanner → destination` and playback continues without metering.

## Modules

| File | Role |
|------|------|
| `src/audio/loudness/kWeighting.ts` | BS.1770-5 K-weighting biquads, derived per sample rate |
| `src/audio/loudness/truePeak.ts` | Polyphase FIR oversampler + true-peak detection |
| `src/audio/loudness/loudnessMeter.ts` | Momentary / short-term / gated integrated LUFS |
| `src/audio/loudness/limiter.ts` | Lookahead true-peak brick-wall limiter |
| `src/audio/loudness/offline.ts` | Export-side analysis and normalisation |
| `src/audio/loudness/masterLoudnessStage.ts` | Main-thread node handle, stats stream, debounced params |
| `src/audio-worklets/master-loudness-processor.ts` | The worklet: limiter → meter, scalar stats out |
| `src/components/MasterLoudnessMeter.tsx` | Master strip UI |

## Accuracy and how it is validated

- **K-weighting** is computed from the analog prototypes at the live sample rate. The
  tests assert the 48 kHz result equals the coefficient table printed in BS.1770-5,
  which is the only rate the recommendation tabulates — so nothing is vendored and
  44.1 / 48 / 96 kHz are all correct.
- **Gating** follows BS.1770-4/5: 400 ms blocks at 100 ms hop, absolute gate at
  −70 LUFS, relative gate 10 LU below the ungated mean. Blocks are accumulated into a
  fixed-size histogram (0.1 LU bins), so a long session cannot grow worklet memory.
- **True peak** uses a 128-tap windowed-sinc polyphase interpolator, 4× at ≤ 48 kHz
  and 2× at 96 kHz (≥ 192 kHz effective, per ITU). Tests assert the canonical case:
  a 0 dBFS fs/4 sine at 45° reads +3.01 dBTP where a sample-peak meter reads 0 dBFS.
- Tolerances held in tests: **±0.1 LU** and **±0.1 dBTP**.

Test signals need faded edges when a measurement must be accurate to 0.1 dB: a buffer
that starts or ends mid-cycle is a step, and the band-limited reconstruction of a step
genuinely overshoots by ~1 dB. That is a property of the signal, not a meter bug.

## Limiter

- Default ceiling **−1.0 dBTP**, lookahead 1.5 ms, attack 1 ms, release 60 ms.
- Detection runs at **8×** (twice the metering factor): 4× estimation underestimates
  near-Nyquist transients enough to break the brick wall.
- The gain target sits `0.4 dB` under the requested ceiling. This absorbs the residual
  ISP estimation error *and* the inter-sample energy that applying a time-varying gain
  creates, so an 8× measurement of the output stays at or below the ceiling. Under
  heavy limiting the output therefore measures a few tenths below the number on the
  knob — deliberately, and in the safe direction.
- **Bypass** (`enabled: false`) is a bit-exact pass-through with zero latency; the
  meters stop too.
- **Monitor-only** is a zero-latency sample-domain hard clip for live performance.
- Latency (`lookahead + detector group delay`) is reported to the main thread for
  monitor-latency accounting and shown in the UI.

## Export

`exportStemsToZip` measures the master stem with the same DSP (8× true peak offline)
and writes the report into `metadata.json`. Passing `options.loudness.normalizeTo`
(a number or `'streaming' | 'club' | 'broadcast'`) additionally gain-matches the stem
and re-limits it; the result reports what was *actually* achieved, which can fall
short of an aggressive target once the ceiling binds.

## UI and persistence

The worklet posts scalar stats only (never audio buffers) at ≤ 30 Hz. State flows one
way: UI → `MasterLoudnessStage.update()` → debounced `postMessage` → worklet. Settings
persist to `localStorage` as primitives and are re-validated on load, so a corrupted
entry falls back to defaults rather than feeding NaN to the audio thread.

Integrated loudness survives transport start/stop and resets only on the explicit
**Reset** button.

## Performance

~0.35 ms per 128-frame stereo quantum (~13 % of the 2.67 ms budget at 48 kHz). See
[PERFORMANCE_BUDGET.md](../PERFORMANCE_BUDGET.md) for the measurement and for the two
options if that budget is ever needed elsewhere.

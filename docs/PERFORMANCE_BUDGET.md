# Performance Budget & Auto-Degrade Order

Hyphon monitors per-worklet `process()` wall time on the audio rendering thread and
aggregates a **master budget** (% of each 128-sample quantum consumed across all
instrumented worklets). When the budget exceeds **80%**, features are disabled in a
fixed order until headroom recovers below **60%** (hysteresis).

## Instrumented worklets

| Worklet ID   | Processor              | Telemetry key |
|--------------|------------------------|---------------|
| Sequencer clock | `clock-processor`   | `clock`       |
| TB-303       | `open303-processor`    | `open303`     |
| Rubber Band  | `RubberBandProcessor`  | `rubberband`  |
| Vocoder STFT | `vocoder-processor`    | `vocoder`     |

Metrics are throttled to the main thread at ~10 Hz via `MessagePort` (`worklet-perf`
messages). Underruns are counted when `process()` wall time exceeds the quantum
duration for a block.

## Master budget

```
masterBudgetPercent = min(100, Σ workletCpuPercent)
```

All worklets share the same audio rendering thread; their CPU costs add within each
quantum.

## Glitch detection

The HUD / session report also tracks:

1. **AudioContext state** — non-`running` transitions (interruptions)
2. **Output latency spikes** — jumps ≥ 20 ms between polls
3. **Artifact detector** — `artifact-detected` and elevated `artifactRate` from
   `artifact-detector-processor` (when wired)

## Auto-degrade order

Applied **one step at a time** when `masterBudgetPercent ≥ 80`. Recovered **one step
at a time** (reverse order) when `masterBudgetPercent ≤ 60`.

| Step | ID                  | Action                                      | Rationale                          |
|------|---------------------|---------------------------------------------|------------------------------------|
| 1    | `spectral-pan`      | `spectralPanDepth × 0` (global multiplier)  | Main-thread-adjacent, high STFT cost |
| 2    | `granular-quality`  | Rubber Band `setStretchProfile: fast`         | Largest sustained worklet savings  |
| 3    | `vocoder-stft`      | Vocoder bypass (`setPerfBypass`)            | STFT overlap-add is expensive      |
| 4    | `webgpu-knobs`      | Dispatch `hyphon-perf-degrade` → CSS knobs  | GPU scope still runs on rAF thread |

Implementation: `src/utils/performanceBudget.ts` (`DEGRADE_ORDER`).

## HUD & export

- Toggle HUD: **Ctrl+Shift+E** or `?hud=1`
- **Download Report** / **Copy JSON** include `runtime` block (budget, underruns,
  glitches, per-worklet CPU, offline 303 oversample/threads/latency)
- Dev console: `window.__devtools.exportEngineReport()` when `?devtools` or dev build

## Offline 303 rendering (does not affect audio-thread budget)

Heavy offline jobs (freeze, export, multisample, 4× oversampled 303) run on a
**worker pool** (`src/audio/OfflineRenderer.ts`). Telemetry fields:

| Field | Meaning |
|-------|---------|
| `offlineRenderOversample` | Last render factor (`1` / `2` / `4`) |
| `offlineRenderThreadCount` | Worker / OpenMP thread hint used |
| `offlineRenderLatencyMs` | Wall-clock latency of last offline render |

These are shown in Engine HUD under **Offline 303**. They never feed
`masterBudgetPercent` — only AudioWorklet `process()` cost does.

See `docs/audio-engine/OFFLINE_303_OVERSAMPLE.md`.

## Synthetic stress test

`src/__tests__/workletPerf.test.ts` drives `WorkletPerfReporter` with an artificial
slow `process()` loop and asserts the underrun counter increments.

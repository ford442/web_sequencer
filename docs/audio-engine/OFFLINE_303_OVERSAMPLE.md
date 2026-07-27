# Offline 303 Oversampling & Worker Pool (Phase-1 / #974)

## Goal

Raise **internal quality** of existing Open303-family engines for offline jobs
(freeze, export, multisample) via oversampling and parallel multi-voice
rendering — **without touching** the real-time AudioWorklet path.

## OVERSAMPLE_FACTOR

| Factor | Behaviour | Default |
|--------|-----------|---------|
| `1` | Base-rate DSP (bit-identical to pre-Phase-1) | **Yes** (real-time + offline default) |
| `2` | Process at 2× SR, box-downsample | Offline opt-in |
| `4` | Process at 4× SR, box-downsample | Offline opt-in |

### C++ (`emscripten/open303_wrapper.cpp`)

- Per-instance `oversampleFactor` + `open303_set_oversample` / `open303_get_oversample`
- Envelope / slide coefficients use `effectiveSampleRate()` so wall-clock timings
  stay constant across factors
- Filter memory + envelope stay **on the instance** (thread-local). Never call
  `open303_process` on the same handle from two threads concurrently.
- Independent instances (lead / bass1 / bass2) **are** safe to process in parallel.

### OpenMP helpers (`emscripten/audio_dsp.cpp`)

| Function | Role |
|----------|------|
| `mixVoiceBuffers` | Parallel mix of independently rendered mono voices |
| `downsampleBox` | OpenMP box-filter downsample |
| `getOversampleFactor` / `setOversampleFactor` | Global HUD preference |
| `getNumThreads` / `setNumThreads` | Existing OpenMP thread control |

Real-time worklets continue to use factor `1`.

## TypeScript offline path

| Module | Role |
|--------|------|
| `src/audio/offline/OfflineOpen303Engine.ts` | Pure-TS port of Open303 DSP + oversample |
| `src/workers/Offline303Renderer.worker.ts` | Worker protocol (`render` / `render-multi`) |
| `src/audio/OfflineRenderer.ts` | `render303Offline()` + worker pool |

```ts
import { render303Offline, makeCanonical64StepPattern } from '@/audio/OfflineRenderer';

const buf = await render303Offline('stock-open303', makeCanonical64StepPattern(), {
  oversample: 4,
  threadCount: 4,
});
```

For unit tests / environments without Worker support, pass `{ sync: true }`.

### Multi-voice

`render303OfflineMulti([{ modelId, pattern }, ...])` renders each voice on a
fresh engine instance (independent filter/envelope state), then mixes. This is
the race-condition / NaN safety surface for lead + bass1 + bass2.

## Telemetry & HUD

`engineTelemetry.recordOfflineRender({ threadCount, oversample, latencyMs })`
updates:

- `runtime.offlineRenderThreadCount`
- `runtime.offlineRenderOversample`
- `runtime.offlineRenderLatencyMs`

Engine HUD (**Ctrl+Shift+E**) shows an **Offline 303** section. These metrics
do **not** contribute to `masterBudgetPercent` (see `docs/PERFORMANCE_BUDGET.md`).

## Performance target

A 64-step pattern at 4× oversample should complete in roughly **200–400 ms** on
a typical multi-core laptop (sync path). Worker overhead is small relative to DSP.

## Thread safety checklist

1. One `Open303Instance` / `OfflineOpen303Engine` per concurrent voice
2. Mix only after each voice finishes writing its buffer
3. Real-time AudioWorklet keeps `oversampleFactor = 1`

## Related

- [OPENMP_IMPLEMENTATION.md](./OPENMP_IMPLEMENTATION.md)
- [303-voices.md](./303-voices.md)
- [303-authenticity-gaps.md](./303-authenticity-gaps.md) (Phase-0)
- Epic #972 / Phase-1 #974

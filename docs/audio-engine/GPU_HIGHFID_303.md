# GPU High-Fidelity 303 Voice (Phase-3 / #976)

## Goal

Provide an **offline WGSL authenticity tier** (`gpu-highfid`) that evaluates the
same diode-ladder nonlinear model as [`highfid-cpu`](./HIGHFID_CPU_303.md) on
the GPU for multisamples, freeze-bounces, and WAV export — without blocking the
AudioWorklet.

Real-time AudioWorklet latency is **unchanged** — this path is offline-only.

## Topology

Matches Phase-2 `highfid-cpu` so spectrograms can A/B within Phase-0/2 gates:

| Piece | Implementation |
|-------|----------------|
| Filter | mystran / kunn TB_303 diode-ladder + feedback HP @ 150 Hz |
| Nonlinearity | Cubic soft clip `x − x³/6` on the feedback loop |
| Oscillator | PolyBLEP saw / soft-driven square |
| Accent | Coupled envelope (~3 ms attack then decay) |
| Oversample | `1 \| 2 \| 4` (optional internal factor in uniforms) |

Sources:

- `src/webgpu/shaders/303Voice.wgsl.ts` — WGSL compute kernel (`render303`)
- `src/engines/WebGpu303Engine.ts` — host wrapper, pooling, read-back, fallback
- `src/audio/offline/OfflineHighFid303Engine.ts` — CPU oracle / fallback

## Why sequential compute?

The diode-ladder is recursive (each sample depends on prior filter state). The
kernel therefore uses `@compute @workgroup_size(1)` and walks the buffer in
one invocation. Parallelism is across **independent notes / multisample slots**,
not inside the IIR.

## API

```ts
import { WebGpu303Engine, renderGpuHighFid303, float32ToAudioBuffer } from '@/engines/WebGpu303Engine';

const eng = new WebGpu303Engine();
await eng.init(); // false → no WebGPU; render still works via highfid-cpu

const samples = await eng.render303(
  { cutoff: 0.35, resonance: 0.7, envMod: 0.55, decay: 0.5, accent: 0.7, volume: 0.8 },
  44100, // 1 s @ 44.1 kHz
  { oversample: 4, midiNote: 36 },
);

// Or full pattern:
const meta = await renderGpuHighFid303(pattern, { oversample: 4 });
const audioBuf = float32ToAudioBuffer(audioContext, meta.buffer);
```

Offline renderer entry:

```ts
await render303Offline('gpu-highfid', pattern, { oversample: 4 });
```

MultisampleGenerator:

```ts
await multisampleGenerator.generate303HighFidMultisamples({
  durationSec: 1,
  midiNotes: [36, 38, 40, 41, 43],
  params: { cutoff: 0.35, resonance: 0.7 },
  render: { oversample: 4 },
});
```

## Model registry

| Field | Value |
|-------|-------|
| `id` | `gpu-highfid` |
| `family` | `highfid` |
| `available` | `true` |
| `offlineOnly` | `true` |

`getAvailableTB303Models()` hides it from the real-time selector.
`normalizeTB303Model('gpu-highfid')` → `stock-open303` so song load never
routes it onto AudioWorklet.

## Fallback chain

```
GPU high-fid (this module)  →  highfid-cpu  →  stock Open303 / JC-303  →  JS
```

Surfaced via `meta.fallbackReason` / telemetry `gpuFallbackReason` when WebGPU
is missing, shader compile fails, allocation fails, or read-back errors.
No crash on browsers without WebGPU.

## Telemetry

| Field | Meaning |
|-------|---------|
| `gpuRenderLatencyMs` | Wall time of last GPU/fallback render |
| `gpuReadbackBytes` | Bytes copied from GPU (0 on CPU fallback) |
| `gpuFallbackReason` | Human-readable fallback cause (null if GPU used) |
| `gpuUsedGpu` | Whether WGSL path ran |

Target latency: **≤ 150–300 ms** for multi-second patterns depending on length
and hardware (CPU fallback in headless CI is slower and still acceptable).

## Host harness

```bash
# Writes 1 s mono WAV via CPU-equivalent path (WebGPU optional in browser)
pnpm exec vite-node scripts/render_gpu_highfid_wav.mjs
# → /tmp/gpu-highfid_1s.wav
```

## Tests

```bash
CI=true pnpm exec vitest run --pool forks src/__tests__/WebGpu303Engine.test.ts
```

Covers: registry offline-only, WGSL source shape, deterministic CPU fallback,
OfflineRenderer wiring, telemetry fields.

## Related

- [HIGHFID_CPU_303.md](./HIGHFID_CPU_303.md) (Phase-2)
- [303-authenticity-gaps.md](./303-authenticity-gaps.md) (Phase-0 thresholds)
- [OFFLINE_303_OVERSAMPLE.md](./OFFLINE_303_OVERSAMPLE.md) (Phase-1)
- [303-voices.md](./303-voices.md)
- Epic #972 / Phase-3 #976

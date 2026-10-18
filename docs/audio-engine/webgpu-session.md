# WebGPU session probe

One session probe owns **one** `GPUAdapter` and **one** `GPUDevice` for every subsystem that wants WebGPU: oscillator voices, compute (`WebGpuBackend`), HUD viz (scope, knobs, curve editor), offline gpu-highfid 303, and future gpu-chores ([#1105](https://github.com/ford442/web_sequencer/issues/1105)).

API: `probeWebGPU()` / `getLastWebGpuProbe()` in [`src/engines/backends/webgpuProbe.ts`](../../src/engines/backends/webgpuProbe.ts).

## Voices vs GPU surfaces

- **Voices** still degrade through `BackendRegistry`: WebGPU → AS WASM → Rust WASM → WAV PCM → JS. A failed probe sets the WebGPU oscillator to unsupported; audio keeps running.
- **GPU HUD / viz / chores** **hard-fail**. The Engine HUD WebGPU session panel shows **WebGPU unavailable** plus `reason` / browser / adapter. Copy JSON / Download Report includes `runtime.webgpuProbe` (browser, reason, adapter — no live `GPUDevice`, no raw user-agent string).
- After a failed probe, callers **must not** call `requestAdapter` / `requestDevice` themselves. #1105 meters/viz must import the probe and skip GPU work when `!ok`; a later device (recovery, power-preference swap) reaches them as a `restored` event.

## Device lifecycle (#1345 Phase 0)

| Concern | Where | Rule |
|---------|-------|------|
| Adapter | `src/webgpu/powerPreference.ts` | `requestAdapter({ powerPreference })`, default `high-performance`; Engine HUD → *GPU power* persists the choice and *Apply* swaps the device. A `null` adapter for the hint retries once with no options. |
| Device | `src/webgpu/deviceRequirements.ts` | `requestDevice()` gets a label, `timestamp-query` only when the adapter has it, and `requiredLimits` for what the compute paths bind, clamped to the adapter. Consumers size work from `device.limits` (`maxComputeElements`), never from the constants alone. |
| Errors | `webgpuProbe.ts` | `uncapturederror` on the shared device → `engineTelemetry.recordWebGpuError` (HUD *Uncaptured errors*, engine report `runtime.webgpuDevice`). |
| Loss | `onWebGpuDeviceChange(cb)` | Listeners hear `lost`, then — unless the reason was a plain `destroy()` — the probe runs **once** more and they hear `restored` (rebuild on `probe.device`) or `unavailable` (fall back). More than 3 automatic recoveries in 60 s disables WebGPU for the session. |
| Swap on purpose | `restartWebGpuDevice(reason)` | Destroys the device and drives the same `lost` → `restored` path (power-preference change; `window.__HYPHON_E2E__.loseWebGpuDevice()` under `?e2e=1`). |
| Canvases | `src/webgpu/configureCanvas.ts` | `configureCanvas(canvas, { device, alphaMode, colorSpace })` — CSS box × DPR backing store, `premultiplied` + `srgb` by default; `syncCanvasSize` resizes *and* reconfigures. |
| Canvas lifecycle | `src/webgpu/gpuCanvasSession.ts` | `startGpuCanvasSession(canvas, { create })`: probe, configure, tear down on loss, call `create` again on the restored device. Scope, curve editor and piano roll use it; knobs keep their scheduler but listen to the same events. |

Every consumer that holds GPU objects subscribes: knobs, scope, curve editor,
piano roll, `WebGpuBackend`, `WebGpuOscillator`, `WebGpu303Engine`. None of
them may call `device.destroy()` on the shared device — releasing a consumer
drops its references only.

## WebGL viz is deferred

Do **not** add a WebGL scope, meter, or knob path “because WebGPU died.” That would hide Chrome vs Edge `requestAdapter` failures. CSS knob fallback (not GL) may remain. Oscilloscope stays an empty WebGPU canvas; the loud signal is the HUD.

WebGL scopes/meters are explicitly out of scope for this phase and for #1105.

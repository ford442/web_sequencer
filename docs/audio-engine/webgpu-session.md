# WebGPU session probe

One session probe owns **one** `GPUAdapter` and **one** `GPUDevice` for every subsystem that wants WebGPU: oscillator voices, compute (`WebGpuBackend`), HUD viz (scope, knobs, curve editor), offline gpu-highfid 303, and future gpu-chores ([#1105](https://github.com/ford442/web_sequencer/issues/1105)).

API: `probeWebGPU()` / `getLastWebGpuProbe()` in [`src/engines/backends/webgpuProbe.ts`](../../src/engines/backends/webgpuProbe.ts).

## Voices vs GPU surfaces

- **Voices** still degrade through `BackendRegistry`: WebGPU → AS WASM → Rust WASM → WAV PCM → JS. A failed probe sets the WebGPU oscillator to unsupported; audio keeps running.
- **GPU HUD / viz / chores** **hard-fail**. The Engine HUD WebGPU session panel shows **WebGPU unavailable** plus `reason` / browser / adapter. Copy JSON / Download Report includes `runtime.webgpuProbe` (browser, reason, adapter — no live `GPUDevice`, no raw user-agent string).
- After a failed probe, callers **must not** call `requestAdapter` / `requestDevice` again. #1105 meters/viz must import the probe and skip GPU work when `!ok`.

## WebGL viz is deferred

Do **not** add a WebGL scope, meter, or knob path “because WebGPU died.” That would hide Chrome vs Edge `requestAdapter` failures. CSS knob fallback (not GL) may remain. Oscilloscope stays an empty WebGPU canvas; the loud signal is the HUD.

WebGL scopes/meters are explicitly out of scope for this phase and for #1105.

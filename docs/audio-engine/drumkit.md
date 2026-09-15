# Analog 808/909 drum kit (WASM)

Live kick / snare / hats render inside `drumkit-processor` via C handles in
`hyphon_native.wasm`. This replaces per-hit main-thread `OscillatorNode` /
`AudioBufferSourceNode` allocation in `DrumKitEngine` (closed #648 mapped RBS
kit params; this is the DSP).

## API

`emscripten/drumkit_wrapper.cpp` exports:

| Function | Role |
|----------|------|
| `drumkit_create` / `drumkit_destroy` | One handle for the whole kit |
| `drumkit_init(handle, sampleRate, bufferSize)` | Allocate the process buffer |
| `drumkit_set_kit(handle, 0\|1)` | 808 or 909 character |
| `drumkit_trigger(handle, voice, velocity, a, b, c, d)` | Hit at the audio clock |
| `drumkit_choke_open_hat(handle)` | Closed-hat choke (also applied automatically on CH trigger) |
| `drumkit_process(handle, numFrames)` | Pointer to internal float buffer |

Voice IDs: `0` kick, `1` snare, `2` closed hat, `3` open hat.

Kit multipliers stay aligned with `src/engines/DrumKitCharacter.ts`.

## Heap

Drums compile into **the same** `hyphon_native` module as Open303 / Prophecy
(not a sixth WASM world). The live path constructs **one** `AudioWorkletNode`
for kick+snare+hats. That is still a separate instantiate from the 303/Prophecy
worklets until those voices share a single imported `WebAssembly.Memory`.

## Fallback

If WASM/worklet init fails (missing AudioWorklet, WebKit threaded module,
export map, timeout), `DrumKitEngine` keeps the Web Audio oscillator kit and
`logEngineFallback('drumkit', …)` drives the Engine HUD.

## Worklet URL

Loaded with Vite `?worker&url` from `src/hooks/useAudioEngine.ts` so `/hyphon/`
deploy bases and `scripts/check-release-dist.mjs` stay valid.

## Tests

- Host: `emscripten/tests/drumkit_offline_test.cpp` (`pnpm run test:native`)
- Unit: `src/__tests__/DrumKitEngine.test.ts`, `src/audio-worklets/__tests__/drumkitTriggerQueue.test.ts`

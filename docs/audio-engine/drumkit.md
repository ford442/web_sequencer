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
| `drumkit_init(handle, sampleRate, maxFrames)` | Allocate the planar stereo buffer (`maxFrames` is the channel stride) |
| `drumkit_push_event(handle, frame, type, target, value, a, b, c, d)` | Queue an event on its own frame (what the worklet uses) |
| `drumkit_render(handle, blockStartFrame, numFrames)` | Render a block, sample-accurate; planar stereo, right channel `maxFrames` floats after left |
| `drumkit_set_kit(handle, 0\|1)` | 808 or 909 character (immediate) |
| `drumkit_trigger(handle, voice, velocity, a, b, c, d)` | Hit at the next block (immediate; tests and the parity tool) |
| `drumkit_choke_open_hat(handle)` | Closed-hat choke (also applied automatically on CH trigger) |
| `drumkit_process(handle, numFrames)` | Immediate-API render into the same planar buffer |

Events: `kTrigger` (target = voice, value = velocity, args = a..d),
`kDrumkitChokeOpenHat`, `kDrumkitSetKit` (target = kit), `kDrumkitSetPan`
(target = voice, value = pan −1..1).

Voice IDs: `0` kick, `1` snare, `2` closed hat, `3` open hat.

## Timing inside the render quantum

A hit starts on the sample its `audioTime` names, not on the next block
boundary (#1344 P4). `playDrum` passes the step's scheduled time
(`useStepHandler` → `DrumKitEngine.play`), and the worklet turns it into an
absolute frame (`round(audioTime × sampleRate)`) and pushes it into the
voice's native event ring. A time that is missing or already past lands on the
first frame of the next block. `drumkit-processor` makes **one**
`drumkit_render(handle, blockStartFrame, frames)` call per block, whether the
block holds no hits or several. Inside it, `renderSplit`
(`emscripten/core/voice.h`) renders up to each event's frame, applies the
event and carries on, so a flam two hits 1.5 ms apart in one 128-frame block
plays both hits at their own offsets. A block with no events is a single
engine render. Events on the same frame keep the order they were pushed in:
the pan goes in before its trigger, and the closed hat chokes the open hat
inside the trigger. Nothing on this path allocates. The event ring is
fixed-size, and the export names `NativeVoiceProcessor` looks up are built
once at load. Coverage: `voiceProcessors.events.test.ts` (one render call per
block) and `voiceTiming.realWasm.test.ts` (the flam at 44.1 / 48 / 96 kHz on the
real wasm).

## Per-hit pan

A drum step's **Pan** (note editor) travels with the hit:
`useStepHandler` → `playDrum` → `DrumKitEngine.play(…, pan)`; the step's pan
overrides the sound's own `params.pan`. The worklet pushes `kDrumkitSetPan`
just before the trigger on the same frame, and the trigger latches it. A hit
that is still ringing keeps the pan it started with.

The law is constant power with unity at the centre (`√2·cos` / `√2·sin` of the
pan angle): a centred hit renders bit-for-bit the old mono kit on both
channels, and a hard-panned one is +3 dB on its side. It lives in
`panGains()` (C++) and `drumPanGains()` (`DrumKitEngine.ts`, used by the Web
Audio fallback too).

Kit multipliers stay aligned with `src/engines/DrumKitCharacter.ts`.

## Heap

Drums compile into **the same** `hyphon_native` module as Open303 / Prophecy
(not a sixth WASM world). The live path constructs **one** `AudioWorkletNode`
for kick+snare+hats, and its voice joins the audio session's shared
`hyphon_native` instance (`hyphonNativeSession.ts`).

## Fallback

If WASM/worklet init fails (missing AudioWorklet, WebKit threaded module,
export map, timeout), `DrumKitEngine` keeps the Web Audio oscillator kit and
`logEngineFallback('drumkit', …)` drives the Engine HUD.

## Worklet URL

Loaded with Vite `?worker&url` from `src/hooks/useAudioEngine.ts` so `/hyphon/`
deploy bases and `scripts/check-release-dist.mjs` stay valid.

## Tests

- Host: `emscripten/tests/drumkit_offline_test.cpp` (`pnpm run test:native`)
- Unit: `src/__tests__/DrumKitEngine.test.ts`, `src/audio-worklets/__tests__/voiceProcessors.events.test.ts`
- Real wasm (integration tier): `src/audio-worklets/__tests__/voiceTiming.realWasm.test.ts`

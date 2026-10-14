# Native voice core (`emscripten/core/voice.h`)

Issue #1344. One header-only C++17 contract for the engines in `hyphon_native`
(open303, jc303, highfid303, prophecy, drumkit), replacing the handle maps,
output buffers and event timing each wrapper wrote by hand.

**Status:** P2 — the header and its host tests. No wrapper uses it yet; P3 ports
drumkit → prophecy → open303 / jc303 / highfid303 onto it.

## Pieces

| Piece | What it replaces |
|-------|------------------|
| `Event` (32 bytes: `int64` frame, type, target, value, 4 float args) | per-engine `note_on` / `set_param` / `trigger` calls with no time |
| `EventRing<N>` — SPSC, preallocated, refuses when full | the worklet calling engine exports the moment a message lands |
| `EventSchedule<N>` — frame-sorted, stable | `ParameterQueue` / `DrumTriggerQueue` in TS |
| `renderSplit` | rendering the whole block, then applying events at the next block |
| `BlockBuffer` — one 16-byte-aligned buffer, sized at init | four `malloc`'d `outBuf`s that grow inside `*_process` |
| `VoiceSlots<T, N>` — handle = slot index + generation | `std::unordered_map<uintptr_t, std::unique_ptr<T>>::find` per call |
| `NativeVoice<Engine>` | everything one handle owns: engine + ring + schedule + buffer + stats |
| `Smoothed` | nothing — no native parameter smoothing existed |
| `flushDenormal` | nothing — no denormal policy existed |

## Timing model

- The worklet converts `audioTime` to an absolute frame on the AudioContext
  clock: `Math.round(audioTime * sampleRate)` (`hyphon::frameAt` on the C++
  side). Each `process` call gets the block's first frame,
  `currentTime * sampleRate`, which is exact.
- `renderSplit` renders up to each due event's frame, applies it, and carries
  on, so an event lands on **its own sample**. Events at or after the block end
  stay scheduled.
- An event whose frame already passed lands on frame 0 of the next block and is
  counted in `VoiceStats::late`.
- Events on the same frame apply in push order: a param pushed before a noteOn
  is in effect for that note.
- **Why a schedule behind the ring:** producers do not post in time order.
  `playSynth` posts a note's noteOff (`noteTime + duration`) together with its
  noteOn, before the next step's noteOn. A FIFO alone would hold the earlier
  event behind the later one.

Sample accuracy here is about when an event lands *once it has arrived*. The
step clock (`clock-processor`) posts each step in the block it falls in, so
on-step notes still reach the worklets after their frame and land late. Live
onset alignment (P5) also needs the clock to post ahead.

## Engine concept

```cpp
struct MyEngine {
    bool init(float sampleRate, int maxFrames);  // the only place that may allocate
    void render(float* out, int frames);         // mono, any frames >= 1
    void apply(const hyphon::Event& e);          // must not allocate
};
static hyphon::VoiceSlots<hyphon::NativeVoice<MyEngine>, 8> g_voices;
```

`render` is called with arbitrary split sizes, so an engine that updates
coefficients per block must do it per call, or use `Smoothed::advance(frames)`.

## Real-time rules

- No allocation after `init`. `NativeVoice::process` returns `nullptr` (counted
  in `stats.overruns`) for a block larger than `init` reserved. The caller
  outputs silence and should re-init with a larger `maxFrames`; the voice never
  grows its buffer on the audio thread.
- No exceptions, no RTTI needed (the host test builds with `-fno-exceptions
  -fno-rtti`; `build.sh` keeps `-frtti` for embind).
- Recursive state (IIR, feedback) goes through `flushDenormal`. WebAssembly has
  no flush-to-zero mode, and `-ffast-math` is not the fix — see
  [BUILD_NOTES.md#fast-math](BUILD_NOTES.md#fast-math).
- Stop / mute: `NativeVoice::cancelPendingNotes()` drops pending noteOn,
  noteOff and trigger events. Scheduled params still land, matching the
  `allNotesOff` the 303 worklet gains in #1344 P1 (PR #1423).

## Handles

The low 8 bits hold slot index + 1, so 0 stays invalid. The remaining bits hold
the slot generation (24 bits on wasm32). Destroy bumps the generation, so a
stale handle stops resolving even after its slot is reused. Capacity is a
template argument (≤ 255) and the instances live inline: size it to the real
number of voices.

## Porting checklist (P3)

1. Move the engine's state into a type that satisfies the concept above. Its
   `apply` handles the event types the old exports took.
2. Replace the `g_instances` map with a `VoiceSlots<NativeVoice<Engine>, N>`.
3. Replace `outBuf` + grow logic with `NativeVoice::buffer`.
4. `*_process(handle, blockStartFrame /* double */, frames)` → `process`. Add a
   `*_push_event` export and keep the immediate exports for setup-time config.
5. Reproduce the engine's offline baseline (`pnpm run test:native`,
   `scripts/generate_303_baselines.sh`) before switching the worklet over.

## Tests

`emscripten/tests/voice_core_test.cpp` runs in `pnpm run test:native` (host
g++, no emsdk). It covers onsets at exact frames across block sizes 96, 128 and
256; same-frame ordering; late events; a drum hit and a 303 note on one frame
starting on the same sample; the ring under two real threads; stale handles;
zero heap allocations over 10k `process` calls (glibc allocator interposed);
`Smoothed` convergence; and denormal clamping. To run it under sanitizers:

```bash
g++ -std=c++17 -O1 -g -fno-exceptions -fno-rtti -pthread \
    -fsanitize=address,undefined emscripten/tests/voice_core_test.cpp -o /tmp/vct && /tmp/vct
g++ -std=c++17 -O1 -g -fno-exceptions -fno-rtti -pthread \
    -fsanitize=thread emscripten/tests/voice_core_test.cpp -o /tmp/vct_tsan && /tmp/vct_tsan
```

The allocation counter is skipped under a sanitizer, because the sanitizer owns
the allocator.

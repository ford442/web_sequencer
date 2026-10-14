# Native voice core (`emscripten/core/voice.h`)

Issue #1344. One header-only C++17 contract for the engines in `hyphon_native`
(open303, jc303, highfid303, prophecy, drumkit), replacing the handle maps,
output buffers and event timing each wrapper wrote by hand.

**Status:** all five engines are on it, and since P4 every worklet drives them
through the event API: notes, triggers and params land on their own sample, and
drums and 303s share one timing grid. The immediate API (`*_note_on`,
`*_trigger`, `*_process`, …) stays exported for tooling and the host tests,
and still renders bit-identical to the pre-port wrappers.

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
| `MonoNoteEngine<Engine>` | the TS rate limiter / stuck-note / portamento-fix logic in open303-processor |
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
#include "core/voice.h"
#include "core/voice_exports.h"

struct MyEngine {
    bool init(float sampleRate, int maxFrames);  // the only place that may allocate
    void render(float* out, int frames);         // mono, any frames >= 1
    void apply(const hyphon::Event& e);          // must not allocate
};
using MyNativeVoice = hyphon::NativeVoice<MyEngine, 256>;
HYPHON_EXPORT_VOICE(myengine, MyNativeVoice, 8)   // slots
```

`HYPHON_EXPORT_VOICE` (`emscripten/core/voice_exports.h`) defines the slot table,
a `myengine_voice(handle)` accessor for the engine's own exports, and the
generic C API:

| Export | |
|---|---|
| `myengine_create()` → handle | 0 when every slot is taken |
| `myengine_destroy(h)` | |
| `myengine_init(h, sampleRate, maxFrames)` → 1 / 0 | reserves the buffer, calls `Engine::init` |
| `myengine_push_event(h, frame, type, target, value, a0..a3)` → 1 / 0 | frame as a double (no BigInt) |
| `myengine_render(h, blockStartFrame, frames)` → `float*` / 0 | sample-accurate |
| `myengine_cancel_notes(h)` | stop / mute |
| `myengine_flush(h)` | apply everything pending now (a voice that stops rendering) |

List those seven names in `emscripten/wasm_export_manifest.json` — `build.sh`
exports exactly what the manifest declares, and
`src/__tests__/wasmExportManifest.voices.test.ts` fails if one is missing.

An engine that is too big to live inline in a slot (rosic's `Open303` carries
its wavetables) holds it by pointer and allocates it in `init`, as
`Jc303Engine` does.

`render` is called with arbitrary split sizes, so an engine that updates
coefficients per block must do it per call, or use `Smoothed::advance(frames)`.

## Mono note discipline (`MonoNoteEngine`)

The three 303 engines are wrapped in `hyphon::MonoNoteEngine`, which applies
on the event's frame the rules open303-processor used to run in TypeScript:

- a noteOn while a note is held releases it first — retrigger, not slide (the
  old "portamento fix")
- a noteOff for any note but the held one is dropped: the note a later noteOn
  replaced still has its own noteOff in flight, and open303 / high-fid ignore
  note numbers
- `kAllNotesOff` releases the held note (MIDI All Notes Off), it does not reset
- a note held for 8 s is released on that frame (stuck-note guard)

The TS rate limiter (50 notes/s, 5 ms minimum spacing) is gone: the native ring
bounds the input, and fast retriggers now play instead of being dropped.

Immediate exports call the wrapped engine (`v->engine.inner`) and bypass these
rules; an immediate all-notes-off calls `forget()` so the wrapper does not
release a note the engine already dropped.

## Worklet side

`src/audio-worklets/nativeVoiceProcessor.ts` is the base of
`open303-processor`, `prophecy-processor` and `drumkit-processor`:

- joins the audio session's one `hyphon_native` instance (the drum kit used to
  instantiate its own; it now resolves the same pthread / ST profile as the
  303s, so it also runs on WebKit)
- `frameAt(audioTime)` → `Math.round(audioTime * sampleRate)`; missing / past →
  frame 0, i.e. the next block
- `beginBlock(frames)` takes the block's first frame from `currentFrame`
- `pushEvent` / `cancelNotes` / `flushEvents` / `renderVoice` call the voice's
  generic exports by prefix

Engine switches in the 303 worklet quiesce the voices that stop rendering:
`*_cancel_notes`, then `*_flush` (pending params land now instead of replaying
stale when the engine comes back), then the immediate `*_all_notes_off`.

`src/audio-worklets/hyphonNativeExports.ts` is **generated**
(`pnpm run gen:native-types`, `tools/gen_hyphon_native_types.mjs`) from the
manifest, the `EMSCRIPTEN_KEEPALIVE` prototypes, the macro and the event enums;
`wasmExportManifest.voices.test.ts` fails when it is stale.

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

## Porting an engine

1. Move the engine's state into a type that satisfies the concept above. Its
   `apply` maps event types onto what the old exports did.
2. Replace the `g_instances` map, `outBuf` and the hand-written
   create / destroy / init with `HYPHON_EXPORT_VOICE`.
3. Keep the old immediate exports as thin calls into `prefix_voice(h)->engine`
   so the worklet keeps working unchanged. A legacy whole-block `*_process`
   that returns the voice's buffer grows it for an oversize block (counted in
   `stats.overruns`), as the old `outBuf` code did; `*_render` refuses instead.
4. Prove the port is a refactor: add `emscripten/tests/port_baseline/<engine>_dump.cpp`
   (a fixed pattern through the immediate API) and run
   `bash emscripten/tests/check_port_baseline.sh <engine>` — it builds the dump
   against `origin/main`'s wrapper and the working tree and requires
   byte-identical renders.
5. Add the event-API checks (`emscripten/tests/event_api_checks.h`, or the
   engine's own test): block-aligned events must equal the immediate API, and
   mid-block events must equal the immediate API with the block split by hand
   at those frames.

All five ports were verified this way: drumkit (783k samples), prophecy
(1.29M), open303 (5.85M, every model at 1×/2×/4× oversample), jc303 (556k),
highfid303 (1.69M, canonical and moved L3 coefficients) — bit-identical.

Two behaviour changes came with the ports, both outside the bit-exact path:
`prophecy_process` and `jc303_process_handle` used to render only the frames
`init` reserved and leave the worklet reading the rest past the end of the
buffer; they now grow it. And the debug-only single-instance `jc303_*` API is
gone (`jc303_init` is now the generic handle init) — see
[BUILD_NOTES.md](BUILD_NOTES.md).

## Tests

`pnpm run test:native` (host g++, no emsdk) runs the core test plus each
engine's event-API checks: `drumkit_offline_test`, `prophecy_offline_test`,
`tb303_voices_offline_test` (open303), `tb303_highfid_offline_test` and
`tb303_jc303_event_test` (needs the `jc303_wasm` submodule).

`emscripten/tests/voice_core_test.cpp` covers onsets at exact frames across block sizes 96, 128 and
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

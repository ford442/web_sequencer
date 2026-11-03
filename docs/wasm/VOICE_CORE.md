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
| `EventRing<N>` — SPSC, preallocated, refuses when full; the layout JS writes in place (#1497) | the worklet calling engine exports the moment a message lands |
| `EventSchedule<N>` — frame-sorted, stable | `ParameterQueue` / `DrumTriggerQueue` in TS |
| `renderSplit` | rendering the whole block, then applying events at the next block |
| `BlockBuffer` — one 16-byte-aligned buffer, sized at init | four `malloc`'d `outBuf`s that grow inside `*_process` |
| `VoiceSlots<T, N>` — handle = slot index + generation | `std::unordered_map<uintptr_t, std::unique_ptr<T>>::find` per call |
| `NativeVoice<Engine>` | everything one handle owns: engine + its ring + the main thread's inbox ring + schedule + buffer + stats |
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

An event lands on its sample only if it arrives before that frame renders.
The step clock therefore posts each step `STEP_LOOKAHEAD_MS` (40 ms,
`src/midi/clock/types.ts`) before it falls, stamped with its exact
`audioTime` (#1344 P5): the main thread schedules the step's notes ahead of
their frame instead of after it. `useStepHandler` defers what the user sees —
playhead, the step edits record into — to the step's time
(`scheduleAtAudioTime`), and transport stop cancels the notes and hits already
queued in the voices. A step the main thread still handles late (jank longer
than the lookahead) plays at the start of the next block, as before.

`src/audio-worklets/__tests__/voiceTiming.realWasm.test.ts` checks the whole
chain on the real wasm: the clock worklet posts the steps, a kick, a jc303 note
and a Prophecy note go out for step 4 with a ~2.7 ms main-thread round trip, and
all three start on the step's sample (frame 24616, mid-block). Without the
lookahead the same step lands on 24832 — 216 frames late.

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
| `myengine_event_inbox(h)` → `uintptr_t` / 0 | the voice's inbox ring, for the main thread to write in place ([control plane](#control-plane)) |

List those eight names in `emscripten/wasm_export_manifest.json` — `build.sh`
exports exactly what the manifest declares, and
`src/__tests__/wasmExportManifest.voices.test.ts` fails if one is missing.

An engine that is too big to live inline in a slot (rosic's `Open303` carries
its wavetables) holds it by pointer and allocates it in `init`, as
`Jc303Engine` does.

`render` is called with arbitrary split sizes, so an engine that updates
coefficients per block must do it per call, or use `Smoothed::advance(frames)`.

### Stereo engines (`Channels = 2`)

`NativeVoice<Engine, EventCapacity, Channels>` takes a third parameter for an
engine that renders more than one channel. The buffer is then **planar**: one
`maxFrames`-long lane per channel: channel `c` of frame `i` is at
`out[c * maxFrames + i]`, and `*_render` returns the left lane's pointer. A
render longer than `maxFrames` is refused (returns 0) rather than growing the
buffer, because the stride would move under the caller.

`renderSplit` still hands the engine `out + pos` for each split, so the engine
keeps the stride it was given in `init` and writes the right lane at
`out + stride`:

```cpp
struct MyStereoEngine {
    bool init(float sampleRate, int maxFrames);  // keep maxFrames as the stride
    void render(float* out, int frames);         // left out[i], right out[stride + i]
    void apply(const hyphon::Event& e);
};
using MyStereoVoice = hyphon::NativeVoice<MyStereoEngine, 256, 2>;
```

The engine exports its own `*_stride(h)` so the worklet knows where the right
lane starts; `NativeVoiceProcessor.renderVoiceStereo(voice, frames, stride,
left, right)` copies both lanes to the outputs. The macro voice
(`emscripten/macro_wrapper.cpp`, [macro-voices.md](../audio-engine/macro-voices.md))
is the first stereo engine.

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
`open303-processor`, `prophecy-processor`, `drumkit-processor` and
`macro-processor`:

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

`src/shared/rt/hyphonNativeExports.ts` is **generated**
(`pnpm run gen:native-types`, `tools/gen_hyphon_native_types.mjs`) from the
manifest, the `EMSCRIPTEN_KEEPALIVE` prototypes, the macro and the event enums;
`wasmExportManifest.voices.test.ts` fails when it is stale.

## Control plane

Issue #1497. The main thread drives the voices with frame-stamped records
instead of a port message per note, param or trigger. Every producer writes the
same 32-byte `hyphon::Event`, the layout the C++ ring already consumes.

**Status (P2).** The schema, the generator, the transport and the bus are in
(P1). Since P2 the ring layout is shared with C++ too, so on the pthread build
the main thread writes a voice's own native ring in place. Drum hits, Prophecy
notes and params, and 303 notes and params go over the bus, and each one's
transport stop is a record. Automation, mutes, MIDI input and telemetry move
over in P3–P5.

### One schema, two languages

`emscripten/core/event_schema.json` defines the record fields (laid out at
natural alignment, 32 bytes), the type ids, the named arg slots, the special
targets, the `NOTE_EXPRESSION` dimensions and the event ring's header.
`tools/gen_hyphon_native_types.mjs` (`pnpm run gen:native-types`) generates:

| File | What it holds |
|---|---|
| `emscripten/core/event_layout.h` | `hyphon::Event`, `EventType`, `ExpressionDimension`, `kTargetAll`, `k<Type>Arg<Name>`, `isNoteEventType`, `EventRingHeader`, `kEventRingHeaderBytes`, `kEventRingMagic`, and `static_assert`s on the size and every offset of the record and of the ring header. `voice.h` includes it. |
| `src/shared/rt/eventLayout.ts` | `EVENT_BYTES`, `EventOffset`, `EventType`, `EventArg`, `EventTargetId`, `ExpressionDimension`, `isNoteEventType`, `EVENT_RING_HEADER_BYTES`, `EVENT_RING_MAGIC`, `EventRingWord` (the header's int32 indices), `EventWriter` / `EventReader` (typed-array stores), and `EventField` / `createEventFields()`, the Float64Array form of a record (`writeFrom` / `readInto`). |
| `src/shared/rt/hyphonNativeExports.ts` | still the export surface. `VoiceEvent` is now `EventType` re-exported. |

`pnpm run check:native-types` (part of `pnpm lint`) and `pnpm run check:exports`
fail when a generated file is stale. `check:exports` runs that check before it
looks for WASM artifacts, so it runs on source-only jobs too. Type ids are wire
format: add new ones, never renumber.

| Type | Id | target | value | args |
|---|---|---|---|---|
| `NOTE_ON` | 1 | MIDI note | velocity | engine-defined |
| `NOTE_OFF` | 2 | MIDI note | | |
| `ALL_NOTES_OFF` | 3 | | | |
| `PARAM_SET` (`kParam`) | 4 | param id | value | |
| `TRIGGER` | 5 | pad / voice | velocity | engine-defined |
| `PARAM_RAMP` | 6 | param id | end value | `frames` |
| `MUTE` | 7 | pad / voice, or `kTargetAll` | 1 mute, 0 unmute | |
| `NOTE_EXPRESSION` | 8 | note id (the NOTE_ON's MIDI note) | dimension's value | `dimension` |
| `CANCEL_NOTES` | 9 | | | |

Types 6–8 are defined but no engine handles them yet (P3, P4); an engine's
`apply` ignores a type it does not know. Engine-private types start at
`kEngine` (0x100), as before.

`CANCEL_NOTES` is a transport stop. It is not scheduled and has no frame:
`EventSchedule::absorb` acts on it when it takes the record from a ring. There
it drops every `NOTE_ON`, `NOTE_OFF` and `TRIGGER` taken before it, whether
already scheduled or earlier in the same ring. Records after it are kept, and
params still land. A stop is therefore ordered with the notes around it,
whatever transport carried them. A stop and a restart in one task keep the
restart's notes, which a stop sent as a port message could not guarantee: on
a ring, the restart's notes can be visible before the message is handled.

### Transport

```
producer ─► EventBus route ─► EngineEventSink
                                ├─ RingEventSink    a voice's ring in hyphon_native memory ─────► the C++ voice (absorb)
                                ├─ RingEventSink    SAB event ring of its own ─────────────────► EventInbox.pop
                                └─ MessageEventSink one batch per tick ─► receive ─► local ring ─► pop
```

- **`src/shared/rt/eventRing.ts`**: an SPSC ring of records (a 128-byte
  header, then power-of-two slots) at any 8-aligned `byteOffset` of a buffer:
  a SharedArrayBuffer of its own (`createEventRing`), or `hyphon::EventRing`
  inside wasm memory. `formatEventRing` lays one out the way the C++
  constructor does; `isEventRing(buffer, byteOffset)` checks the magic, the
  schema version and that the ring fits. A full ring refuses the newest record
  and counts it in `dropped`. It never overwrites an unread one, which is
  `hyphon::EventRing`'s policy too. It also tracks a high-water mark.
- **`src/shared/rt/eventTransport.ts`**: `EngineEventSink` (`push`, `flush`,
  `transport`), its two implementations, and the worklet's `EventInbox`.
  - `RingEventSink(capacity)` makes a ring of its own, used where the pthread
    profile is on (`artifact.sharedMemory`: crossOriginIsolated, not WebKit).
  - `RingEventSink(ringTransport)` writes an existing ring in place: a
    `{ kind: 'ring', buffer, byteOffset }` that `parseRingTransport` accepted.
  - `MessageEventSink` stages records and posts one transferred buffer per
    `flush()`. A full stage flushes early instead of dropping.
  - The inbox drains both kinds the same way. Batches land in a local ring with
    the same order and overflow policy.
- **`src/audio/controlPlane/EventBus.ts`**: the main-thread hub. It owns each
  route's one writer. Message routes flush in a microtask after the first push
  of a task. A producer whose next port message must arrive after its records
  calls `flush(route)` first. `rebind(route, sink)` moves a route onto another
  sink and flushes the old one first. A hot producer fills `bus.stage` (a
  Float64Array at `EventField` indices) and calls `commit(route)` instead of
  `push(…)`.
- **`src/audio/controlPlane/VoiceEventRoute.ts`**: one voice worklet's route
  and the records an engine façade sends: `noteOn`, `noteOff`, `param` (each on
  the frame of an optional audioTime), `stop(release)` (`CANCEL_NOTES`, then
  `ALL_NOTES_OFF` on the next block), and `stage` / `commit` for a record of the
  façade's own. `open(port, { voiceRing })` returns the transport for the init
  message; `adopt(offer)` takes the voice's ring from the ready message.
- **`src/shared/rt/audioClock.ts`**: `frameAtTime(audioTime, sampleRate)`, the
  one conversion. It is `Math.round(t * rate)`, with missing or past times
  mapped to frame 0 (the next block). It matches `hyphon::frameAt` and
  `NativeVoiceProcessor.frameAt`.

`NativeVoiceProcessor` has `attachEventInbox(transport)` (called at init,
before the first await), `receiveEvents(data)` (first in `onmessage`),
`drainEvents(voice)`, `nextEvent(out)` and `voiceRingTransport(voice)`.
`drainEvents` moves the inbox into the voice's native ring, at block start and
before a cancel. It decodes with `popInto` and passes the fields straight to
`*_push_event`. `nextEvent` pops one record for a processor that routes records
itself.

### A voice's ring, written in place (P2)

`hyphon::EventRing` is laid out as `EventRingHeader`, then the records: the
bytes `eventRing.ts` reads and writes. `NativeVoice` holds two rings, each with
one producer:

- `ring`, fed by `push()` / `prefix_push_event`: the thread that renders.
- `inbox`, fed in place from another thread: the main thread's route.

`process`, `cancelPendingNotes` and `flush` take both through
`absorbPending()`, the inbox first: of the events taken in one pass, an inbox
event on a frame applies before one from the voice's own ring. `prefix_event_inbox(h)` returns the
inbox's address. Slots live in static storage, so the address holds for the
handle's life.

The handshake, for a voice with one native voice per worklet (drums,
Prophecy):

1. The façade opens its route on batched messages (`voiceRing: true`) and
   sends that transport in `init-wasm`, so a record sent before the voice
   exists still arrives. The worklet drains it with `drainEvents`.
2. Once the voice exists, the worklet puts `voiceRingTransport(voice)` in its
   `ready` message as `events`: the session memory's SharedArrayBuffer and the
   inbox's address. It does this only where the memory is shared (the
   pthread build) and the C++ header checks out with `isEventRing`. A plain
   ArrayBuffer is never posted: the port would copy the whole heap.
3. The façade calls `adopt(events)`. The route rebinds to a `RingEventSink` on
   that ring, flushing what was still batched. From then on every record is
   written into the C++ ring. The voice takes it at block start, and nothing
   copies or posts it.

The main thread then keeps a view of the shared memory. Growth does not move
the static ring, and a SharedArrayBuffer is never detached. Close the route
(`VoiceEventRoute.close`) before posting `dispose`, so no writer outlives the
ring: the slot is reused by the next voice. Both façades do this.

The single-threaded build offers nothing, and its routes stay on batched
messages. A pthread build that predates `prefix_event_inbox` offers nothing
either.

Memory: one more `EventRing` per voice slot. That is 72 slots of 4.2 KB
(drum kit) or 8.3 KB, about 0.57 MB of zero-initialised static data inside the
initial memory of either profile (`wasm_memory_budget.json`).

### Allocation

The transport allocates nothing per record. The JavaScript at either end can,
because of how V8 handles doubles:

- A double passed as a function argument is boxed (a 16-byte heap number)
  wherever V8 does not inline the call.
- A double stored into an object field is boxed as well.

So `push(route, frame, type, target, 0.37)` and `pop(record)` can allocate per
record. `stage` + `commit(route)` and `popInto(Float64Array)` keep every value
in typed arrays and never box one. Use them on hot paths: `DrumKitEngine`,
`VoiceEventRoute` and `NativeVoiceProcessor` do. `push` and `pop` are fine for
integer records, tools and tests.

`src/audio/controlPlane/__tests__/eventBus.perf.test.ts` measures this in a
child `node --expose-gc` on a Vite build of its probe, because vitest's module
transform keeps V8 from optimising the loop. Over 100k drum and automation
records with computed doubles, the heap grew by:

| Path | Heap growth |
|---|---|
| staged, through the ring and `popInto` | 3.3 KB (budget 64 KB) |
| integer records through `push` | 0.3–20 KB |
| the same double records through positional `push` | 0.2–0.7 MB (reported, not budgeted) |

The postMessage fallback allocates one transferred buffer per flush (per tick)
by design.

### Voices on the bus

- **Drums** (`DrumKitEngine`, `voiceRing: true`). Each hit is two records on
  the hit's frame: a `kDrumkitSetPan`, then a `kTrigger` (the trigger latches
  the pan). `cancelPending` is `stop(false)`: a `CANCEL_NOTES` record, so
  ringing hits decay.
- **Prophecy** (`ProphecyOscillator`, `voiceRing: true`). `noteOn` / `noteOff`
  carry their audioTime's frame. `setParam` is a `PARAM_SET` on frame 0.
  `allNotesOff` is `stop(true)`: the part's hard reset (`kAllNotesOff` runs
  the same `allNotesOff()` as `prophecy_all_notes_off`) on the next block.
  `prophecy-processor` now drains its inbox at block start.
- **303** (`Open303Oscillator`, `voiceRing: false`). A record's voice depends on
  the engine selection, A/B and the CPU gate, which `open303-processor` owns,
  so the route has a ring of its own (pthread) or batches (ST). The processor
  routes it at block start (`routeEvents`) the way its message would have gone.
  Notes and a stop's two records go to the voices being rendered, in order, so
  the voice core drops exactly the notes before the stop. A `PARAM_SET`
  (target = the `Open303Param` id, `OPEN303_PARAM_IDS`) goes to every 303 voice
  the processor owns: rendered ones on its frame, idle ones at once. Engine,
  model and A/B switches are still port messages, and nothing orders them
  with the records. Before P2 a param reached only the active engine, and the
  façade re-sent every param after a switch. A block that took those re-sent
  records before the switch message landed would have left the new engine
  stale. A note in that quantum still goes to the outgoing engine, whose
  queued notes a switch drops anyway.

The `trigger`, `noteOn`, `noteOff`, `param`, `set-param` and `allNotesOff`
messages still work for tools and tests. They go in P5.

Tests: `src/shared/rt/__tests__/` (layout bytes, int64 frames, FIFO,
wrap-around of slots and of the uint32 counts, overflow, a real `MessagePort`;
rings at an offset, `formatEventRing`, `parseRingTransport`, a sink writing a
ring in place), `src/audio/controlPlane/__tests__/` (`EventBus` including
`rebind`, `VoiceEventRoute`, and the perf-tier allocation test), the drum and
Prophecy cases in `voiceProcessors.events.test.ts` (both transports, the ready
message's ring offer and when there is none), the bus cases in
`open303Processor.noteTiming.test.ts` (routing, a param that beats an engine
switch, records before ready), the façade tests (`DrumKitEngine`,
`ProphecyOscillator`, `Open303Config` and the init handshake), the ring header
checks in `wasmExportManifest.voices.test.ts`, and in `voice_core_test.cpp` a
JS-style writer filling `EventRing`, the inbox, and `kCancelNotes`. On the real
wasm (`voiceTiming.realWasm.test.ts`): a kick through each transport is
sample-identical to the `trigger` message; records written into a voice's
ring in wasm memory are sample-identical to `push_event`, and the C++ header
passes `isEventRing`; `CANCEL_NOTES` drops a queued kick and keeps the one
after it; and a jc303 note and a Prophecy note sent as records are
sample-identical to their `noteOn` messages.

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

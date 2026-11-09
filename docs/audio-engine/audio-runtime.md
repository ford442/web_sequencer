# Audio runtime (#1596 P1)

`src/audio/runtime/` is the one owner of the live `AudioContext` and the one
registry for AudioWorklet modules. Every engine, effect and panel asks it for
"a running context" and "this worklet module loaded".

## What the runtime owns

| Piece | API | Notes |
|-------|-----|-------|
| Live context | `audioRuntime.createLiveContext(latencyHint?, sampleRatePref?, extras?)` | Calls `createAudioContext` (`src/hooks/audioEngine/audioContextFactory.ts`). **Synchronous** — callers construct inside a user gesture and must not await before resuming. Returns the `AudioContextCreation` record. |
| Factory record | `audioRuntime.contextCreation` | sampleRate / latency / renderSizeHint / sink fallbacks (what the glitch monitor and HUD read). |
| Current context | `audioRuntime.context` | `null` before the engine exists or once closed. |
| Adopting a record | `audioRuntime.adopt(created)` | Idempotent; `initializeAudioContextAndEngines` adopts a pre-created (HUD re-init) record. |
| Running state | `ensureRunning(gesture, context?)` | The only `resume()` in `src/`. |
| Banner state | `audioRuntime.subscribe` / `getSnapshot` | `{ state, gestureSeen, lastResumeError }`, for `useSyncExternalStore`. |
| Worklet modules | `loadWorkletModule(context, url, processorName)` | `src/audio/runtime/workletRegistry.ts`. |

The knob detent tick (`src/components/knobDetentFeedback.ts`) plays on
`audioRuntime.context`; before the engine exists, or while it is not running,
the tick is silent and only the haptic fires. There is no second context.

## The gesture rule

`ensureRunning(gesture)` with `gesture` one of `'click' | 'key' | 'touch' | 'programmatic'`:

- issues `resume()` **synchronously** (before its first await), so calling it
  from a click / key handler keeps the browser's transient activation;
- records `gestureSeen` for any gesture other than `'programmatic'`;
- shares one promise between concurrent calls on the same context;
- **never rejects**: a failed `resume()` is logged, stored as
  `lastResumeError` and reported once per context to
  `engineDegradationStore` (`id: 'audio-context-resume'`, category `audio`).
  Callers that must react to a failure read the snapshot (`useScheduler`
  stops the transport when `lastResumeError` is set and the context is still
  suspended).

The optional `context` argument is for callers that hold a context the runtime
did not create (a test double, a capture tap); it still goes through the same
de-duplication.

## Registry semantics

`loadWorkletModule(context, url, processorName)` keeps
`WeakMap<BaseAudioContext, Map<url, Promise<void>>>`:

- same (context, url) → same promise; `addModule` runs once (a second engine
  instance, a patch-bay node placed twice, a Firefox double
  `registerProcessor` all stop happening);
- a different context (engine re-init, an `OfflineAudioContext` render) loads
  again;
- a rejected load is removed from the map, so the next call re-fetches;
- a `close()`d context drops its map (`statechange` → `closed`, or `state` on
  entry);
- failure rejects with `WorkletLoadError { url, processorName, cause }` (its
  `message` is the cause's message) and is reported **once per (context, url)**
  to `engineDegradationStore` (`id: worklet-<processorName>`, category
  `worklet`). Callers keep their own fallbacks and do not word their own
  reports.

## The offline exception

`src/audio/offline/vocal/offlineVocalHost.ts` keeps a `suspend(t)` / `resume()`
pair on an `OfflineAudioContext` render. That is render scheduling, not a
gesture and not the live context, so it stays outside the runtime and is the
one listed exception in the guard test.

## Adding a worklet

1. Write the processor under `src/audio-worklets/` and import its URL with
   `?worker&url` (see AGENTS.md).
2. `await loadWorkletModule(context, url, 'my-processor')` — never
   `context.audioWorklet.addModule(url)`.
3. Construct `new AudioWorkletNode(context, 'my-processor', …)`; on a
   `WorkletLoadError`, fall back (bypass, main-thread path) without
   reporting it yourself.

## Guards

`src/audio/runtime/__tests__/audioRuntimeGuards.test.ts` fails on, in `src/**`
outside tests:

- `new AudioContext(` / `window.AudioContext` / `webkitAudioContext` outside
  the factory, the runtime and the `StartOverlay.tsx` E2E patch;
- `.addModule(` outside the runtime;
- `.resume()` outside the runtime, except `offlineVocalHost.ts`.

`workletRegistry.test.ts` and `AudioRuntime.test.ts` cover dedupe, retry,
close-reload, the typed error, one-shot reports and `ensureRunning`
de-duplication.

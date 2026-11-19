# Audio recording (#1498)

Recording an input into a lossless file, with the context frame of its first
sample, so a take can be placed on the clock the notes use.

**Status: P1.** An input picker, a raw input stream, the `recorder-processor`
worklet, a take writer worker that writes WAV / RF64 into OPFS, recovery of a
take a killed tab left behind, and the sampler's REC on this path. Placing
takes on the timeline, punch-in / punch-out on the clock, loopback
calibration, take lanes and comps (P3), and peaks and mixer strips for takes
(P4) come next. Audio clips, their player and their stems already exist
([audio-tracks.md](audio-tracks.md), #1629).

## Path

```
getUserMedia (raw constraints) ─▶ MediaStreamAudioSourceNode ─▶ recorder-processor ─▶ muted gain ─▶ destination
                                                                  │ take ring (SAB)     or chunks on a port
                                                                  ▼                      handed to the worker
                                                        take writer worker (FileSystemSyncAccessHandle)
                                                                  ▼
                                                   OPFS takes/<id>.wav  +  takes/<id>.json
```

- **The page holds none of the audio.** It allocates the ring and wires the
  nodes. The worklet writes into the ring; the worker drains it every 20 ms.
  Without cross-origin isolation (no SharedArrayBuffer), the worklet posts
  8192-frame chunks on a `MessagePort` whose other end was transferred to the
  worker, so the frames still never reach the main thread. Measured in
  Chromium: a 40 s stereo take (15.4 MB on disk) moved the main-thread heap by
  at most 46 KB.
- **Its own worker and heap.** The recorder is TypeScript in its own worker,
  not part of `hyphon_native.wasm`, the same split as Rubber Band and
  `mix_bus.wasm`. Nothing in the voice module's `AudioWorkletGlobalScope`
  changes.
- **No MediaRecorder.** A browser without what this needs (a secure context,
  `getUserMedia`, AudioWorklet, Workers, OPFS, and in the worker
  `createSyncAccessHandle`) gets `RecordingUnsupportedError` with the reason,
  and the sampler shows `Rec unsupported: <reason>`. Firefox throws when an
  input at another rate than the context is connected; that is reported the
  same way.

## Input (`src/utils/audioInputDevice.ts`)

- **Constraints**: `echoCancellation`, `noiseSuppression` and
  `autoGainControl` false, `channelCount: { ideal: 2 }`, and `deviceId:
  { exact }` for a chosen device. A take records 1 channel when the track
  reports 1, else 2.
- **What the browser kept**: `openRecordingInput` returns
  `track.getSettings()` and `keptProcessing`, the processing the browser left
  on although it was asked off. The picker shows the settings line; the
  sampler's status names what was kept.
- **Picker**: the Engine HUD (Ctrl/Cmd+Shift+E, or `?hud=1`) has **Audio
  input** beside **Audio output**. **List inputs** opens the input with the
  recording constraints (which also grants device labels), reads its settings
  and closes it. The choice is stored under `hyphon.audioInputDevice` by group
  id and label, with the last device id as a hint. A stored device that is
  gone opens the default input and says so (`fellBackToDefault`).
- `requestAudioOutputPermission` (audioOutputDevice.ts) still opens an
  unconstrained stream only to unlock output labels. A take never records
  through it.

## The take ring (`src/shared/rt/takeRing.ts`)

One SharedArrayBuffer, single producer (worklet), single consumer (worker):
a 64-byte header (`written`, `read`, `dropped`, `state`, `channels`,
`capacity`, and float64 `startFrame` / `endFrame`), then interleaved float32
frames. Four seconds at the context rate, rounded up to a power of two.

- **Tag**: `startFrame` is the context frame of the first captured sample,
  written before the first `written` store.
- **Full ring**: a block that does not fit is dropped whole and counted, and
  so is every block after it until the worker frees space. The worker reads
  `dropped` before `written`, so every frame a drain returns is older than
  every drop it reports. It writes the frames, then the drops as silence, so
  the take keeps its length and its timing. `droppedFrames` is in the take's
  metadata.
- Counters wrap as int32 and are compared with wrapping arithmetic.

## The worklet (`src/audio-worklets/recorder-processor.ts`)

`start { atFrame? }` and `stop { atFrame? }` are context frames; without one,
the next block. Capture is sample-exact inside a block. A stop that arrives
after its frame still ends the take on that frame: the worklet reports
`endFrame`, and the writer trims the frames captured past it. A stop before the
start is an empty take. The worklet posts `started { frame }` and `stopped
{ startFrame, endFrame, frames, dropped }` on its port, allocates nothing per
block on the ring path, and returns `false` once the take is done.

## The file (`src/audio/recording/wavTakeFile.ts`, `takeFileWriter.ts`)

```
0   RIFF|RF64  riffSize  WAVE
12  JUNK|ds64  28 bytes: riffSize64 · dataSize64 · sampleCount64 · tableLength
48  fmt        IEEE float 32-bit, channels, rate
74  fact       frames
86  data       dataSize
94  interleaved float32 LE
```

- **Always valid**: the writer patches the header and flushes the sync handle
  once per second of audio and on finish, so a killed tab leaves a valid WAV
  up to the last flush.
- **RF64**: the JUNK chunk reserves the ds64 chunk (EBU Tech 3306). Past
  4 GiB the header is rewritten as RF64 in place, and its 32-bit sizes read
  `0xFFFFFFFF`. `decodeWav` (`src/audio/media/wav.ts`) reads both.
- **Metadata** `takes/<id>.json` (`TakeMeta`): `state` (`recording` →
  `complete`, or `recovered`), `purpose` (`take` / `sampler`), rate, channels,
  `startFrame`, `frames`, `droppedFrames`, `inputLabel`, `createdAt`. The
  start frame is written as soon as the first frames arrive.

## Recovery

After boot, `RecoveredTakesGate` checks for an OPFS `takes/` folder. Only when
one exists does it load the notice and the recorder. The worker's `scan` lists
takes whose metadata still says `recording`. A take whose file another tab's
recorder holds open is locked and skipped. The notice offers each one: **SAVE
WAV** recovers it (trims a torn last frame, patches the header for what is on
disk), downloads it and frees the storage a minute later. **DISCARD** deletes
it. A recovered take is not offered again. Measured in Chromium: a tab closed
3.3 s into a take left 3.24 s of audio, recovered to a valid WAV.

## Sampler

REC in the sampler panel opens the stored input with the recording
constraints, records a `purpose: 'sampler'` take, decodes the finished WAV
losslessly (`decodeWav`, at the take's own rate), loads it into the active bank
and deletes the file. The bank no longer stores a decoded webm. The recorder and
the input code load on the first REC.

## API (`src/audio/recording/takeRecorder.ts`)

| Call | Does |
|------|------|
| `recordingSupport()` | `{ ok }` or `{ ok: false, reason }`, without opening anything (`recordingSupport.ts`, entry chunk) |
| `startTake({ context, input, purpose?, atFrame? })` | resolves once the worker holds the file; `started` → first frame; `stop(atFrame?)` → `TakeMeta`; `abort()` deletes |
| `listRecoverableTakes()` / `recoverTake(id)` / `discardTake(id)` | recovery |
| `readTakeFile(id)` / `decodeTake(id)` / `toAudioBuffer(decoded)` | read a take (decode only short ones; the timeline will stream) |

## Tests

- Ring: wrap, mono, drops and their order, int32 counter wrap: `src/shared/rt/__tests__/takeRing.test.ts`.
- File: round trip through `decodeWav`, silence for drops, RF64 promotion, the per-second commit, recovery of a torn file, truncation: `src/audio/recording/__tests__/takeFile.test.ts`.
- Worklet: the real processor class block by block, through the ring and the writer into a decoded file, sample-exact start and stop, late stop, drops, the port path: `src/audio-worklets/__tests__/recorderProcessor.test.ts`.
- Input: constraints, kept processing, stored device, fallback: `src/utils/__tests__/audioInputDevice.test.ts`.
- Sampler REC, the unsupported state, no MediaRecorder: `src/components/sampler-panel/__tests__/useSamplerRecording.test.ts`.

The worker and OPFS run only in a browser. P1 was checked in Chromium with
`--use-fake-device-for-media-stream` and a click-train capture file: SAB and
port paths, exact start and stop frames, the heap figure, and kill and
recover. There is no committed Playwright spec for it yet, because the app's
e2e suite needs the native build. P3's acceptance spec (onsets within ±1 ms
after calibration) is the place for one.

## Not built yet

- Takes on the timeline: a finished take becomes media and an audio clip.
  Today the media store is `.f32` (`audio-tracks.md`), and a take would be
  imported into it. Streaming clips straight from the take file is P2 of
  #1498.
- Arm, punch and loop recording on clock-worklet frames, using the lookahead
  from #1650. `atFrame` on `start` / `stop` is the hook for this.
- Loopback calibration with `fft.wasm`, an offset per input + output pair,
  take lanes and comps (P3).
- Peaks written with the take, audio tracks as mixer strips and patch-bay
  nodes with sends and inserts, and RBS / XM export warnings (P4).
- Monitoring the input through the mix.

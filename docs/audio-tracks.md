# Audio tracks (#1629)

Audio clips on the arrangement timeline: an imported or recorded file on an
audio track, played by the same clock as the patterns.

**Status: P2.** P1 built schema v6, the codec, the media store, drag-and-drop
import, static playback (`warp: 'off'`) and audio-track stems. P2 adds
waveform peaks, GPU waveforms on the timeline, and fade / gain / slip / split
editing with undo. Recording (P3), warp (P4), and freeze / bundles /
co-producer tools (P5) come next.

## Model (song schema v6)

`ArrangementClip` is a union discriminated on `kind`
(`src/types/song.ts`):

```ts
interface PatternClip { kind?: 'pattern'; id; track: TrackKey; patternSlot; startStep; lengthSteps; loop; offsetSteps?; lanes? }
interface AudioClip {
  kind: 'audio'; id; track: AudioTrackKey;      // 'audio-1' … 'audio-8'
  mediaId: string;                              // SHA-256 of the media file
  startStep; lengthSteps; offsetSteps?;         // same meaning as a pattern clip's
  offsetFrames: number;                         // slip: source frame at the anchor
  gainDb: number; fadeInFrames?; fadeOutFrames?;
  warp: 'off' | 'repitch' | 'stretch'; sourceBpm?;
}
```

- **Anchor.** An audio clip is anchored `offsetSteps` before its left edge,
  where source frame `offsetFrames` sounds; with `warp: 'off'` the source then
  runs in real time. A head trim or a split moves `offsetSteps` only, so the
  model never needs the tempo, and the two halves of a split line up at any
  tempo.
- **One rule for both kinds.** `placeClip` / `updateClip` / `splitClip`
  (`src/arrangement/model.ts`) handle both kinds: one clip sounds per track,
  and a cut continues the source. A cut edge drops the fade that was on the far
  side. Pattern tracks and audio tracks are disjoint keys, so the kinds never
  cut each other. The Song Mode projection, the step timeline, XM and `.rbs`
  read pattern clips only.
- **`SavedSongData.audioTracks`** — `{ id, name, gainDb, pan }[]`, in lane
  order. Mute and solo are runtime state in `trackMuteSoloStore`, like the
  pattern tracks', and share one solo mask with them.
- **`SavedSongData.media`** — media id → `{ name, sampleRate, channels,
  frames }`, so a song can name and size its audio without the file. The audio
  itself never goes in the song.
- **v5 → v6** is the identity: a v5 song has no audio tracks, and its pattern
  clips gain no `kind`. `normalizeArrangement` keeps a v5 arrangement as it is,
  validates audio clips (media id, track key, gain clamped to −96…+24 dB), and
  drops clips of a `kind` it does not know. On load every audio clip's track
  exists (`audioTrackStateOf`). An older build reading a v6 file drops the
  audio clips and plays the rest.

## Collab (#1597)

| Field | Subsystem | Shape |
|-------|-----------|-------|
| `arrangement.clips` (audio clips too) | `arrangement` | list, matched by id |
| `audioTracks` | `mixer` | list, matched by id |
| `media` | `assets` | map, one key per media id |

`audioTrackStore` (`src/stores/audioTrackStore.ts`) is bound like the other
stores (`appBindings.ts`), so an import is one undo step ("import vox.wav"),
and two tabs importing different files both keep theirs. Strip and clip edits
are named steps too: "Audio 1: Fader 0 dB → -6 dB", "Clip gain 0 dB → -3 dB",
"split clip" (`collab/editLabels.ts`). The media table holds
references by hash, not blobs. Peers on one origin share the media store.

## Media store

`src/audio/media/`: content-addressed audio, shared by every project of the
origin.

```
media/<sha256>.f32    "HYMF" · u32le header length · JSON header · planar float32 LE
```

- **The header is deterministic** (format, version, layout, rate, channels,
  frames; no names or timestamps). Equal audio is therefore equal bytes, with
  one hash, and is stored once.
- **Backends.** The same OPFS / IndexedDB / memory backends as ProjectStore
  (`projectFileBackends.ts`), which gained `readRange`. A page of one channel
  is one contiguous byte range: playback reads a page, never the whole file.
  IndexedDB stores each file as one record, so its range reads load the record.
- **Import** (`importAudioFile.ts`). WAV and RF64 decode in `wav.ts`
  losslessly, at the file's own rate (PCM 8/16/24/32, float 32/64,
  WAVE_FORMAT_EXTENSIBLE, truncated data chunks). Every other format the
  browser reads goes through `decodeAudioData` at the live context's rate.
  More than two channels are mixed down to stereo.

## Waveform peaks (P2)

```
media/<sha256>.peaks   "HYMP" · u32le header length · JSON header · int16 LE min/max
```

- **Pyramid** (`src/audio/media/peaks.ts`). Level 0 holds the min and max of
  every channel over each 256-frame bucket (the last one may be shorter).
  Each next level merges pairs of buckets, up to a single bucket. Values are
  int16 at ±32767 = ±1.0: a min rounds down and a max up, so a drawn peak is
  never quieter than the audio, and louder samples clamp at full scale. A
  3-minute stereo file at 48 kHz takes about 540 KB.
- **Reads.** `peakRange(pyramid, from, to)` reads the coarsest level whose
  buckets are no longer than the range, so a pixel column costs at most a
  few buckets at any zoom. A range can widen by up to one bucket (under a
  pixel at ARR's zooms), and is never narrower than the audio.
- **The file** is derived from the media and deterministic, like the media
  file. One whose version, layout or sizes this build does not expect reads
  as missing and is rebuilt. `MediaStore.remove` deletes it with the media.
- **Builds.** The import builds peaks from the audio it has just decoded and
  stores them (`importAudioFile`). Media without current peaks is built in
  `src/workers/mediaPeaks.worker.ts`, which opens the same OPFS / IndexedDB
  store, pages the audio through `PeakBuilder` and writes the file, so the
  page never holds the audio. On IndexedDB, which keeps a file as one record,
  the file is read once instead of a page at a time. The result does not
  depend on how the audio was chunked.
- **Cache** (`src/audio/media/peakCache.ts`). `request(ids)` loads the stored
  file, or else asks the worker. It falls back to a build on the main thread
  when there is no Worker API, the store is on the in-memory backend (a
  worker would not see it), or the worker cannot see the media or dies. It
  remembers media the store does not hold until `prime` or `retry`, holds at
  most 64 pyramids (least recently used first out), and bumps `version` on
  every change.

## Playback

```
useStepHandler (linear player) ─ audioClips.onSongStep(pos, frame) ──▶ AudioClipPlayer
                                                                         │ prepare / arm / end (port)
media store ── pager (page reads, 50 ms timer) ─▶ SAB ring per voice ──▶ audio-clip-processor
                                                  (or posted pages)        │ one stereo output per track
                                                                           ▼
                                               patch: audioTrackVoice socket (audio-N) → masterGain
```

- **Lazy.** `audioClips` (`src/audio/audioTracks/audioClips.ts`) is all the
  entry chunk holds. The player, worklet and media store load the first time
  the song has an audio clip.
- **Voices** (`AudioClipPlayer.ts`). A clip starting within one second gets a
  voice prepared ahead of time: its feed fills from the frame it will start on,
  across the loop point too. On the clip's step, or on any step inside it after
  a seek, the voice is armed with that step's exact frame (the clock stamps
  every step on a whole frame). Its right edge is predicted and re-predicted
  when the tempo changes. An edited or removed clip, a seek, the transport
  stopping, or the transport leaving the linear player ends its voice, with a
  declick.
- **Voice DSP** (`src/shared/rt/audioClipVoice.ts`, shared with the offline
  render). Clip gain, linear fades, a 64-frame declick on any edge that cuts the
  source mid-way, and linear-interpolation resampling when the media rate is
  not the context's. A page that arrives late plays silence for the missing
  frames and then skips them, so the clip stays on the grid. The worklet's
  block loop allocates nothing; its one message out is an underrun report, at
  most once a second. On a page that is not crossOriginIsolated, pages are
  posted to the worklet instead of written to a ring (receiving one allocates
  the message).
- **Strips.** The fader, pan (balance), mute and solo are the worklet's
  per-output strip gains. A muted track keeps playing silently and comes back
  in sync.
- **Patch bay.** The stock patch has eight `audioTrackVoice` sockets
  (`audioTrack1` … `audioTrack8`), cabled dry into `masterGain`. Adding a track
  never rebuilds the graph. Anything cabled between a socket and the master is
  that track's insert chain. `withEngineVoices` adds the sockets to a patch
  saved before v6.

## Offline render and stems

`renderAudioTracksOffline` (`src/audio/audioTracks/renderOffline.ts`) renders
every audio track with the same voice code, on the frames the clock puts each
step on. Live and offline match sample for sample:
`audioClipPlayer.test.ts` runs the real worklet class against the player block
by block and null-tests the result against the offline render.

The stem export writes one dry `stems/audio-N.wav` per audio track that has
clips, and sums them into the master stem (`stemExportAudioTracks.ts`). Mute
and solo apply as they do to the other stems. Stems are rendered straight, like
the pattern stems. Media missing from this browser renders silent and is listed
as `missingMedia` in `metadata.json`.

## UI

ARR (`ArrangementView` + `src/components/arrangement/`):

- **Audio lanes** sit under the pattern lanes: name, M / S, and clips labelled
  with their file. A clip whose media is missing is hatched red.
- **Import.** Drop audio files on an audio lane (the clip lands at the snapped
  step under the pointer), on any other lane or on the drop row (each file gets
  a new track), or use **IMPORT** / **+ AUDIO**. A clip is as long as its file
  at the current tempo.
- **Waveforms** (P2, `AudioWaveformCanvas.tsx`, `waveformScene.ts`). One
  canvas sits behind the clip blocks, as tall as the audio lanes and as wide as
  the lanes in view. It is `position: sticky`, and the scene is drawn for the
  scroll offset: a canvas as wide as the song would not fit a GPU texture. It
  uses the piano roll's quad renderers through `useQuadCanvas` (WebGPU on the
  shared device, Canvas2D fallback, transparent clear). Each CSS pixel column
  of a clip is one bar: the min / max of the source frames that column plays
  (`clipSourceFrameAt`, the same mapping the voice uses, swing included),
  scaled by clip gain and fades. A column past full scale after clip gain is
  red. A fade shades the clip above its ramp and draws the ramp. While peaks
  load, a clip shows its zero line. `WaveformPainter` draws only when the
  input, the view or the peak cache changed, so an idle timeline submits
  nothing.
- **Editing** (`clipDrag.ts`: pure previews, patches, split points). Every
  drag previews locally and commits once, on release: one undo step.

  | Gesture | Edit | Snap |
  |---------|------|------|
  | drag the body / an edge | move / trim (a head trim keeps the audio in place) | grid; Shift = step |
  | drag the top-left / top-right handle | fade-in / fade-out (`fadeInFrames` / `fadeOutFrames`), never past the other fade | free |
  | drag the top-middle handle up / down | clip gain, 0.5 dB per px (Shift 0.1), −96…+24 dB | free |
  | Alt + drag the body | slip: the audio moves under the clip (`offsetFrames`, 0 … media length) | grid; Shift = pixel |
  | Alt + click (any clip) | split at the click | grid, else step |
  | S or Ctrl/Cmd+E on a focused clip | split at the playhead when it is inside the clip, else in the middle | grid, else step |
  | ↑ / ↓ on a focused audio clip | clip gain ±1 dB (Alt ±0.1) | — |

  The handles show when a clip is hovered or selected, on clips at least
  40 px wide. The inspector edits clip gain, length, fade-in, fade-out and
  slip (in ms at the media's rate), the track's fader and pan, and has
  **SPLIT** for both clip kinds. The history names each step: "fade in clip",
  "fade out clip", "slip clip", "split clip", "Clip gain 0 dB → -3 dB",
  "resize clip". `updateClip` keeps an edited audio clip valid: whole frames,
  `offsetFrames` ≥ 0, gain clamped to the clip range, and a zero fade left
  out.

## Tests

- Model, migration, audio tracks, doc merge: `src/arrangement/__tests__/audioClips.test.ts`.
  The codec's every-field fixture now carries audio clips, tracks and media
  (`src/collab/__tests__/songFixtures.ts`).
- Media format, WAV decoder, store, import: `src/audio/media/__tests__/mediaStore.test.ts`.
- Live path end to end and the null test: `src/audio/audioTracks/__tests__/audioClipPlayer.test.ts`.
- Stems: `src/utils/__tests__/stemExport.audioTracks.test.ts`.
- ARR: `src/components/__tests__/ArrangementView.audio.test.tsx` (import,
  handles, slip, split, keys, inspector, the waveform layer).
- Peaks: `src/audio/media/__tests__/peaks.test.ts` (pyramid against brute
  force, chunking, file, store builds, import) and `peakCache.test.ts`
  (stored file, worker, fallbacks, missing media, LRU).
- Step ↔ seconds and source frames: `src/audio/audioTracks/__tests__/clipTiming.test.ts`.
- Scene, painter and editing math: `src/components/arrangement/__tests__/`
  (`waveformScene`, `waveformPainter`, `clipDrag`).
- Undo: `src/collab/__tests__/appBindings.test.ts` (trim, split, fades, gain
  and slip as named steps, undone back to the import).

## Not built yet

- **Decode.** WebCodecs `AudioDecoder` (it needs a demuxer per container) and
  decoding in a worker. Today non-WAV files decode with `decodeAudioData` on the
  main thread, and the import holds the decoded file in memory once.
- **Pager in a worker.** The pager reads the media store from the main thread.
  A feed holds about 0.68 s, so a main-thread stall up to that long is
  absorbed.
- **Later slices.** Recording (P3); `repitch` / `stretch` and BPM detection
  (P4); freeze to audio, project bundles with media, garbage collection of
  unused media (and their peaks), the AI-song format and co-producer tools
  (P5).
- **Waveforms, not in P2.** The canvas is drawn on the main thread: the
  OffscreenCanvas work of the control-plane issue does not exist yet. Lanes
  draw stereo as one merged min / max (the pyramid keeps both channels). Fades
  are linear, like the voice's. Pattern clips can be split but not slipped.
- **XM and `.rbs` exports** leave audio clips out. The AI-song export reports
  them as not exportable.

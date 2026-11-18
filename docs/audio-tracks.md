# Audio tracks (#1629)

Audio clips on the arrangement timeline: an imported or recorded file on an
audio track, played by the same clock as the patterns.

**Status: P1.** Schema v6, the codec, the media store, drag-and-drop import,
static playback (`warp: 'off'`), and audio-track stems. Waveforms and editing
handles (P2), recording (P3), warp (P4), and freeze / bundles / co-producer
tools (P5) come next.

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
and two tabs importing different files both keep theirs. The media table holds
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
- **Editing.** Move, trim either edge and delete with the pattern-clip pointer
  and keyboard handlers. The inspector edits clip gain, length, the track's
  fader and pan.

## Tests

- Model, migration, audio tracks, doc merge: `src/arrangement/__tests__/audioClips.test.ts`.
  The codec's every-field fixture now carries audio clips, tracks and media
  (`src/collab/__tests__/songFixtures.ts`).
- Media format, WAV decoder, store, import: `src/audio/media/__tests__/mediaStore.test.ts`.
- Live path end to end and the null test: `src/audio/audioTracks/__tests__/audioClipPlayer.test.ts`.
- Stems: `src/utils/__tests__/stemExport.audioTracks.test.ts`.
- ARR: `src/components/__tests__/ArrangementView.audio.test.tsx`.

## Not in P1

- **Decode.** WebCodecs `AudioDecoder` (it needs a demuxer per container) and
  decoding in a worker. Today non-WAV files decode with `decodeAudioData` on the
  main thread, and the import holds the decoded file in memory once.
- **Pager in a worker.** The pager reads the media store from the main thread.
  A feed holds about 0.68 s, so a main-thread stall up to that long is
  absorbed.
- **Not yet built.** Waveforms and fade / gain handles (P2); recording (P3);
  `repitch` / `stretch` and BPM detection (P4); freeze to audio, project bundles
  with media, garbage collection of unused media, the AI-song format and
  co-producer tools (P5).
- **XM and `.rbs` exports** leave audio clips out. The AI-song export reports
  them as not exportable.

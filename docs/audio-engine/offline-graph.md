# Offline Graph — one compiler for freeze, stems and preview

Design note for #1233. The live patch bay (#1038) already compiles a declarative
`AudioGraphConfig` into Web Audio nodes. This is the **offline half**: the same
compiler, the same patch and the same master loudness stage, rendered into an
`OfflineAudioContext`.

Before this, every bounce path built a private graph at a private rate — stem
export hardcoded 44100 while live playback followed the user sample-rate policy
(#1136), and the AI song preview was a disabled button.

```
live patch bay ──► compileOfflineGraph(rate)
                      ├─ track freeze          (freezeThroughPatch)
                      ├─ stem ZIP master       (masterChain: 'live-patch')
                      ├─ XM one-shots          (shared rate policy only, see below)
                      └─ AI song N-bar preview (renderAISongPreview)
```

## The compiler

`src/audio/offline/compileOfflineGraph.ts`

| Call | Use |
|------|-----|
| `compileOfflineGraph(options)` | Build the context + graph; the caller schedules sources and awaits `render()`. |
| `renderThroughOfflineGraph({ schedule, … })` | Compile, schedule, render. |
| `bounceBuffersThroughOfflineGraph({ buffers, … })` | Play finished per-track buffers through the patch's master chain. |

`compileAudioGraph` now takes a `BaseAudioContext`, so the offline path compiles
the *same* function the engine calls at startup — there is no second compiler to
keep in sync.

The patch defaults to the live one (`getActivePatchController()`), falling back
to Classic Electribe when the engine is not running.

## Sample rate

`resolveExportSampleRate(pref, liveSampleRate)` in `src/utils/audioContextPolicy.ts`
is the single rule:

| Policy (#1136) | Offline render runs at |
|----------------|------------------------|
| `44100` / `48000` | exactly that |
| `native` | `AudioContext.sampleRate` of the running engine — the rate the browser actually gave us, not the rate that was requested |
| `native`, engine not running | 44100 (`DEFAULT_EXPORT_SAMPLE_RATE`) |

Callers pass the live rate they recorded; nothing guesses. `ExportModal` offers
the three policy options directly and labels `native` with the resolved number.

## Master loudness

The live limiter/meter (#1095) is an `AudioWorklet` sitting last before the
destination. Offline, the graph compiles without that node (the compiler bridges
around it) and `applyMasterLoudnessOffline` runs the identical `TruePeakLimiter`
over the rendered mix with the persisted `LimiterSettings`. Same DSP, same place
in the chain, so the file matches the meters. `enabled: false` / `monitorOnly`
measure without touching a sample, exactly as they do live.

## WAM2 slots (ADR 0001)

| Package | Offline |
|---------|---------|
| Bundled fixtures (`hyphon.tone`, `hyphon.gain`) | `offline: 'native'` → mounted into the offline context and rendered |
| Community / official-SDK packages | `offline: 'unsupported'` → **bypassed**, reported, mix continues |

A bypassed slot is never replaced by a first-party engine. Every slot in the
patch produces a row in `OfflineGraphReport.slots` with a reason
(`offline-unsupported`, `not-allowlisted`, `catalog-unavailable`, `mount-failed`,
`no-plugin-in-slot`), which the AI preview panel renders as badges and the stem
ZIP writes into `metadata.json`.

Mounting checks `descriptor.offline === 'native' && descriptor.origin === 'bundled'`.
`descriptorFromCatalogEntry` already refuses to grant `native` to a community
package; the second check means a regression there still cannot put a
non-replayable plugin into a bounce.

## Consumers

### Stem export

`exportStemsToZip` renders per-track stems at the resolved rate. The master stem
is either the historical dry sum (`masterChain: 'dry-exclusive'`, the library
default) or that sum bounced through the live patch (`'live-patch'`, what the
export dialog asks for). `metadata.json` records `routing`, `sampleRate`,
`sampleRatePref`, `liveSampleRate` and the whole `offlineGraph` report. If the
bounce fails the export still completes as a dry sum and says so in
`routingNote` — a degraded master is never silent about being degraded.

### Track freeze

`freezeThroughPatch({ durationSeconds, schedule })` in `trackFreezer.ts`. The
Pyodide freeze helpers now default to the policy rate too, rather than 44100.

### XM export

`exportSongToXM(..., options)` resolves one rate for the whole module and passes
it to every `renderSynthToBuffer` / `renderDrumToBuffer`. XM instruments are dry
one-shots — running them through the master chain would bake the send FX into
every sample — so XM shares the compiler's **rate policy**, not its master bus.

### AI song preview

`renderAISongPreview` (`src/utils/aiSongPreview.ts`) converts the pasted song
with the normal importer, renders the first N bars of each track, and bounces
them through the offline graph. Anything it cannot play is a row in the report:
a sampler bank whose audio is TTS or a URL does not exist until import, so it is
listed as skipped rather than dropped. The modal plays the rendered WAV and
shows the skip rows plus any unsupported WAM2 insert.

## Not in this phase

- **Instrument slots offline.** Native WAM2 instruments mount and are exposed as
  `slotPlugins`, but nothing schedules notes into them yet; a freeze of a WAM2
  instrument track still renders whatever the sequencer path produced.
- **MP3 / other download formats.** WAV only; `lamejs` stays out until a format
  is explicitly requested.
- **Per-stem patch routing.** Stems are dry by design; only the master stem goes
  through the patch.

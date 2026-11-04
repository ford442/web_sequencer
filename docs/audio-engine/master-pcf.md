# Master PCF — ReBirth Pattern Controlled Filter on the master bus

The PCF is ReBirth's master-section filter. RBS import turns its knob
automation into `master.pcfCutoff` / `master.pcfResonance` /
`master.pcfEnvAmount` lanes, and with `importPcfAsFilter` keeps the
pattern-driven filter itself as `song.pcfFilter`. This page covers where that
filter sits in the graph and what drives it, live and offline.

## Where it sits

```
… → masterCompressor → masterGain → masterPanner → masterPcf → masterLimiter → destination
```

`masterPcf` is a fixed node of the stock patch (`defaultElectribeGraph.ts`,
factory and role `masterPcf`, label **PCF** in the patch bay). The placement:

- **Post-pan.** It filters the whole mix, including the drums, ambiance and
  choir that enter at `masterGain` and skip the master FX chain. ReBirth's PCF
  filters the master too. Per-part routing (`pcfFilter.target`) is not
  modelled: the per-part case is the importer's
  `tb303A`/`tb303B` → `<voice>.filterCutoff` lane conversion.
- **Pre-limiter.** A resonant sweep can peak well above the input. The
  limiter still catches it, and the loudness meter measures what you hear.

Like the limiter, the node is an AudioWorklet (`pcf-processor`), so the host
builds it before the graph compiles and passes its ports in
(`createMasterPcf` → `masterPcfPorts` → `buildClassicElectribeGraph({ masterPcf })`
→ compile option `createMasterPcf`). If the worklet cannot load, or the host
passes nothing, the compiler bridges `masterPanner → masterLimiter` and
playback continues. The master PCF lanes are then silent, as they were before
the stage existed.

A worklet that fails to load is also reported to `engineDegradationStore`
(id `master-pcf`, subsystem `master-pcf`, category `worklet`, with the load
error as the reason), so the degradation banner says the master PCF lanes and
the song PCF will not play. A placed PCF node that fails reports as
`pcf-node:<nodeId>` and passes audio through. A context with no
`audioWorklet` at all (some offline contexts) returns `null` without a report.

The release gate (`scripts/check-release-dist.mjs`) requires both
`pcf-processor` and `openrb-lowpass-processor` to be registered by a worklet
entry chunk of their own, so a build that drops either chunk, or inlines it
into a shared app chunk, fails.

Patches saved before the stage existed are upgraded on load (`withMasterPcf`,
in `deserializeAudioGraph` and `PatchController.compile`). The upgrade reroutes
the `masterPanner → masterLimiter` cable, or `→ destination` on a patch without
the limiter, through the new node. If the user re-cabled the panner some other
way, the patch is left as it is.

## In the patch bay

Select the **PCF** node to get its panel: on/off, LP / BP / HP, cutoff,
resonance, env amount, decay, the pattern and the filter mode (pattern PCF or
openrb / ReBirth low-pass). The controls act on the running master PCF.
Hand edits are saved as the song's `pcfFilter`; the mode is saved with the
patch. You can also place more PCFs and cable any voice or bus through them;
see [pcf-node.md](pcf-node.md).

## Transparent until a song engages it

The processor bypasses (bit-exact pass-through) unless:

1. the pattern PCF is enabled (`pcfFilter.enabled`, loaded by
   `applyPcfFilterToEffect`), **or**
2. a **cutoff** automation override is active (a `master.pcfCutoff` lane is
   playing).

The second case is what makes the default RBS import audible: it emits the
lanes but no `pcfFilter`. A resonance or env-amount override on its own does
not engage the filter, because it has no cutoff to shape.

### A cutoff lane parked at 0 plays as no lane

Lane value 0 is 20 Hz (`pcfMidiNormToHz(0)`). A `master.pcfCutoff` lane whose
**every** point is 0 would therefore be a 20 Hz low-pass of the entire mix,
and nothing on screen would say so: the master analyser and meters tap
`masterGain`, upstream of the panner, the PCF and the limiter, so they keep
moving. So such a lane is treated as no lane (`isParkedPcfCutoffLane`,
`laneResolver.ts`):

- `resolveLaneValuesAtStep` skips it, so neither the live scheduler nor the
  offline timeline (`resolveMasterPcfTimeline`) sends it. A later lane on the
  same parameter still plays.
- `createPcfLaneWatcher` counts it as absent and clears the cutoff override,
  so a lane edited down to all-zero releases the mix at once.

A lane that only passes through 0 on its way somewhere else is automation and
plays as written, 20 Hz included. Only cutoff parks: resonance or env amount at
0 are ordinary values. Raw TRAK events (`scheduleFromTrakEvents`) are single
controller moves, not lanes, and are not affected.

Lane-only drive (no `pcfFilter`) uses the processor's default resonance, 40
(Q ≈ 9.8), so a cutoff sweep carries a resonant peak at the cutoff. ReBirth's
resting PCF resonance has not been measured yet; until it is, 40 stays.

### One curve, three copies

The worklet cannot import, so its `midiToHz` / `midiToQ` repeat
`pcfMidiNormToHz` (lanes) and `pcfKnobToHz` / `pcfKnobToQ` (patch-bay knobs).
`PcfProcessor.test.ts` asserts they agree at 0, ¼, ½, ¾ and 1 to 1e-9.

## What drives it (live)

| Source | Path |
|--------|------|
| `master.pcf*` lanes | `AutomationScheduler` → `pcfLaneFanout` → `PcfEffect.setAutomation*` (and placed PCFs that follow the master lanes). Units come from `pcfLaneOverride` (`laneResolver.ts`): cutoff `20 × 1000^v` Hz, resonance `v × 127`, env amount `v` |
| Imported `pcfFilter` | `applyPcfFilterToEffect` on song load / RBS import. It calls `reset()` first, so a song without a PCF gets a clean master |
| Transport | `useAppState` restarts the pattern at step 0 on play, freezes it on stop and follows tempo changes (`broadcastPcfTransport`, which also steps placed PCF nodes) |
| Patch bay | The PCF panel (`PatchController.setPcf`); see [pcf-node.md](pcf-node.md) |
| Lane removal | `createPcfLaneWatcher` (subscribed to `automationStore` in `engineLifecycle`) clears an override when its lane is deleted or disabled, or when automation playback is turned off. Without it, the last automated cutoff would keep filtering the next song |

The live instance is published by `engineLifecycle` (`setMasterPcf`), exposed
as `audioEngine.pcfEffect`, and disposed on engine teardown.

Per-voice 303 filter lanes (`synthA.filterCutoff`, `bass2.cutoff`, …) are
unaffected. They still go to `Open303Manager`. The PCF is a separate,
downstream stage.

## Offline (stems, AI preview)

A port message would land at an arbitrary point of an offline render, so
offline the lanes are **pre-timed**. `resolveMasterPcfTimeline` resolves them on
the render's step axis with the same resolver and unit conversion the live
scheduler uses. It emits one event per step where a value changes, at
`g × stepSeconds`. `compileOfflineGraph({ masterPcf: { timeline, settings, tempo } })`
builds a `PcfEffect` on the `OfflineAudioContext`. The timeline, the pattern-PCF
state and the transport travel in `processorOptions`, so they are in place
before the first block. The processor applies each event once the render's
`currentTime` reaches it.

| Consumer | Master PCF |
|----------|-----------|
| Stem export, `masterChain: 'live-patch'` | Played in the master stem (the per-track stems stay dry). The pattern PCF comes from `StemExportInput.pcfSettings`, which defaults to the live master PCF's state |
| Stem export, `'dry-exclusive'` (library default) | Not played. The lanes are reported in `automation.notRendered` |
| AI song preview | Played; the pattern PCF comes from `song.pcfFilter` |
| Track freeze, XM export | Not played, by design. Freeze (`freezeThroughPatch`) passes no `masterPcf`, and neither runs the master chain with song automation, so a frozen track is always pre-PCF |

Live and offline differ in one structural way. Live, the master PCF node is
always in the chain once its worklet loads, bypassed (bit-exact) until a song
engages it. Offline, the stage exists only when the render asks for it
(`masterPcf` option); otherwise the panner feeds the limiter directly. Both
give the same samples when nothing engages the PCF: `PcfProcessor.test.ts`
checks that a render with no master PCF lanes, with lanes only on other
targets, or with a cutoff lane parked at 0 is identical to its input.

`OfflineGraphReport.masterPcf` is `rendered`, `unavailable` (requested but the
worklet failed, or the patch has no PCF node, so the stage was bridged and the
lanes move to `notRendered`), or `off` (nothing for it to do).

## Known gaps

- **A song loaded before the engine starts loses its pattern PCF.**
  `applyPcfFilterToEffect` returns `false` when there is no `pcfEffect` yet,
  and `engineLifecycle` builds the master PCF without settings. The song's
  `pcfFilter` is kept in `rbsArrangementExtrasRef` (for saving), which the
  lifecycle cannot see. Lanes are unaffected: they reach the PCF through the
  automation store once the engine runs.
- `MASTER_CHAIN_ORDER` / `MASTER_CHAIN_CONNECTIONS` in
  `defaultElectribeGraph.ts` still describe the chain without the optional
  worklet stages (`masterPanner → destination`); the full chain is the
  `_WITH_PCF_AND_LIMITER` constant.

## Files

| File | Role |
|------|------|
| `src/audio-worklets/pcf-processor.ts` | The DSP: RBJ biquad LP/BP/HP, pattern envelope, overrides, offline timeline |
| `src/engines/PcfEffect.ts` | Main-thread handle (live and offline contexts) |
| `src/audio/pcf/masterPcf.ts` | Construction, registry, lane watcher, graph ports |
| `src/audio/graph/defaultElectribeGraph.ts` | The `masterPcf` node and its cables |
| `src/audio/graph/graphSerialization.ts` | `withMasterPcf` upgrade for older patches |
| `src/audio/offline/offlineLaneAutomation.ts` | `resolveMasterPcfTimeline`, PCF lane reporting |

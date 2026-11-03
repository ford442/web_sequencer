# PCF in the patch bay

The ReBirth Pattern Controlled Filter is a node you can see, cable and play in
the patch bay. There are two kinds:

| Node | Factory | What it is |
|------|---------|------------|
| **PCF** (fixed) | `masterPcf` | The master-bus PCF ([master-pcf.md](master-pcf.md)), post-pan and pre-limiter. RBS imports and master `pcf*` lanes drive it. |
| **PCF *n*** (placed) | `pcf` | A PCF you add from the palette and cable anywhere: one engine voice, a bus, the choir sum, or a send. |

Both kinds take the same controls, and the controls are live.

## Using it

1. **Add** a node. In the palette, pick **PCF** and set Cutoff, Reso, Env and
   Decay (0–127, as on ReBirth), the **Type** (LP / BP / HP) and the **Mode**,
   then click *Add PCF 1*. A new node is staged for the next engine restart,
   like any other node.
2. **Cable** it in. Drag outputs onto inputs as usual, for example
   `bass1Pan → PCF 1 → masterSaturation`, or `synthABus → PCF 1` with a send
   level. Cables to and from a PCF are live.
3. **Select** the node (it is drawn in amber). The PCF panel under the canvas
   has these controls:
   - **On / Off** and **LP / BP / HP**.
   - **Cutoff** (shown in Hz), **Reso**, **Env** and **Decay** sliders.
   - **Mode**: Standard (RBJ) or openrb / ReBirth, with a status line
     (see [openrb mode](#openrb-mode)).
   - **Pattern**: one bar per step. Click a bar to set its height, or use
     ArrowUp / ArrowDown on a focused bar.
   - On a placed PCF only: **Copy master pattern** (the song's imported PCF
     pattern) and **Master lanes** (see below).

Every control acts on the running filter at once. `PatchController.setPcf`
applies the edit, and `usePatchBay().setPcf` / `pcfState` bind it to React.

## What drives a PCF

| Source | Master PCF | Placed PCF |
|--------|------------|------------|
| Panel knobs and pattern | Live, on the running PCF | Live, and saved in the patch |
| Imported `pcfFilter` (RBS) | Loaded on song load | Through **Copy master pattern** |
| Transport (pattern steps) | Yes | Yes. `broadcastPcfTransport` steps every PCF from the same play / stop / tempo |
| Master `pcfCutoff` / `pcfResonance` / `pcfEnvAmount` lanes | Yes | Only with **Master lanes** on. The scheduler sends lanes through `pcfLaneFanout`, so a follower gets the same overrides at the same time. Turning it off clears what the lanes left |

### Where the settings are saved

- **A placed PCF** keeps everything in its node config (`PcfNodeConfig`):
  knobs, type, pattern, `followMasterLanes` and `filterMode`. It is saved
  with the patch, and untrusted stored values are sanitized
  (`normalizePcfNodeConfig`).
- **The master PCF** keeps only its `filterMode` in the patch. Its knobs and
  pattern belong to the song (`pcfFilter`), which every song load applies.
  If you change them in the panel, the master PCF is marked hand-edited
  (`PcfEffect.edited`), and the next song save writes its current state as
  the song's `pcfFilter` (`pcfFilterForSave`). The song's per-part `target`
  is kept. A song load clears the mark. The master's knobs only exist while
  it runs, so the panel locks them when there is no engine or the worklet did
  not load.

## openrb mode

The Mode switch works the same way as on low-pass nodes
([openrb-lowpass.md](openrb-lowpass.md)). It is a `LowpassModeSwitch` whose
standard branch is the PCF itself:

```
input ─┬─ PcfEffect (pattern PCF) ────────────── level ─┬─ output
       └─ openrb branch (ReBirth PCF low-pass) ── level ─┘
```

Switching is a 20 ms crossfade, with no rebuild.

openrb338.wasm exports ReBirth's PCF low-pass **with its envelope at rest**:
the ABI has no pattern envelope. In openrb mode a PCF node therefore plays a
**static** ReBirth low-pass that follows the Cutoff and Reso knobs (mapped on
the PCF worklet's curves: `20 × 1000^(cutoff/127)` Hz, Q `0.5 + 29.5 ×
reso/127`). The pattern and the `pcf*` lanes keep modulating the standard
branch, and the status line says so. Lanes are not forwarded to the openrb
branch, because offline renders cannot time a port message. Forwarding them
live would make a bounce sound different from playback.

The standard branch is **held** (it plays even in openrb mode) in these cases:

- the PCF is a **band-pass or high-pass**. openrb is a low-pass.
- the PCF is **off**. A disabled PCF is meant to be transparent; the static
  openrb filter would colour the signal anyway. This matters for the master:
  it is off unless a song engages it.

When openrb338.wasm is not loaded (the default build), openrb mode plays the
pattern PCF, the status line says why, and the patch keeps the mode.

## Offline

`compileOfflineGraph` builds placed PCFs the same way the live engine does
(`createPcfNodeProvider`, without registering them). It waits for their
worklets before rendering. A placed PCF steps at `masterPcf.tempo` and, when
it follows the master lanes, gets the same pre-timed `masterPcf.timeline` as
the master. `OfflineGraphReport.pcfNodes` lists each one with its `status`
(`rendered` / `unavailable`), whether its pattern stepped, and whether it
played the lanes. Without the PCF worklet a placed PCF is bridged, and the
patch still renders.

## Files

| File | Role |
|------|------|
| `src/audio/pcf/pcfNodeConfig.ts` | `PcfNodeConfig` defaults, sanitizing, knob curves, `PcfNodeEdit` / `PcfNodeState` (pure) |
| `src/audio/pcf/pcfInsert.ts` | `PcfInsert` (effect + openrb branch + mode switch), host providers, live registry (transport, lane fan-out) |
| `src/audio/pcf/masterPcf.ts` | Master PCF construction, lane watcher, `pcfFilterForSave` |
| `src/audio/graph/compileGraph.ts` | `pcf` factory and the `createMasterPcf` / `createPcfNode` options |
| `src/audio/graph/graphOps.ts` | `setPcfNodeConfig` |
| `src/audio/graph/patchController.ts` | `setPcf`, `pcfState` |
| `src/components/PatchBayPcfPanel.tsx` | The panel |

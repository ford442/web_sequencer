# Patch Bay — User-Editable Audio Routing

Design note for the modular routing epic (Phases A–C). The declarative graph
compiler already existed; this adds the data model, persistence, live editing and
the node/cable editor on top of it, **without a second graph system**.

## Model

A patch *is* an `AudioGraphConfig` — the same type the compiler has always taken.
Presets and user patches are therefore the same kind of object, and "load a
preset" is just "replace the config".

Additions to the type (all optional, so existing configs keep working):

| Field | Purpose |
|-------|---------|
| `GraphEdgeSpec.gain` | Send level. Web Audio connections carry no level, so the compiler inserts an implicit `GainNode` when a gain is present and ≠ 1. |
| `GraphEdgeSpec.feedback` | Marks an edge that intentionally closes a loop. Cycle detection walks the graph with these removed. |
| `GraphNodeSpec.fixed` | Preset skeleton. Playback resolves these by id/role, so the editor refuses to delete them. |
| `GraphNodeSpec.label` / `position` | Editor presentation, persisted with the patch. |
| `AudioGraphConfig.presetId` | Where the patch came from, for "modified" state and revert. |

### Why `feedback` is not optional

`CLASSIC_ELECTRIBE_GRAPH` is genuinely cyclic: `delay → delayFeedback → delay`.
Naïve cycle rejection would reject the stock preset. Marking the closing edge as
feedback keeps that topology legal while every *other* loop — which in Web Audio
means silence or a runaway — is refused. A test asserts both directions: the
classic graph is acyclic with the flag and cyclic without it.

## Modules

| File | Role |
|------|------|
| `graphOps.ts` | Pure edits (`addConnection`, `removeNode`, …) + `validateGraph` / `findCycle`. No Web Audio. |
| `graphSerialization.ts` | Song payload format, with hostile-input parsing. |
| `patchController.ts` | Single writer of the live config; patches the running graph. |
| `patchRegistry.ts` | Engine publishes the controller; UI subscribes. |
| `patchSession.ts` | Song load glue, order-independent w.r.t. engine start. |
| `presets.ts` | Preset registry; Classic is the literal stock graph. |
| `layout.ts` | Depth-based auto-layout and cable geometry. |
| `engineVoices.ts` | Engine factories, `EngineVoiceSocket`, `findEngineVoice` (Phase C). |
| `engineStrips.ts` | Engine layer of the stock patch (303 strips etc.) + `withEngineVoices` upgrade. |
| `nodePalette.ts` | What the editor can add, with default parameters. |
| `components/PatchBay.tsx` | SVG node/cable editor. |
| `components/PatchBayPalette.tsx` | Add-node strip under the canvas. |
| `hooks/usePatchBay.ts` | React binding. |

Every edit operation returns a **new** config rather than mutating, which is what
makes undo, React state and "would this be valid?" checks straightforward.

## What is live, and what needs a rebuild

| Edit | Applied |
|------|---------|
| Connect / disconnect | Live. `connect`/`disconnect` are cheap and glitch-free. |
| Send level on an existing send | Live, via a 20 ms ramp (stepping a live fader clicks). |
| Send level on a cable that had no gain node | Staged — inserting the node means rewiring. |
| Add / remove node | Staged — the node set cannot change safely under a running graph. |

Staged edits set `needsRebuild()`, which the editor surfaces. The controller is
detached on engine dispose so a stale graph is never reconnected.

## Safety

- **Cycle rejection** happens in `validateGraph`, and `compileAudioGraph`
  validates by default — an invalid patch cannot reach the audio thread even if
  it arrives from a stored song rather than the editor.
- **Fixed nodes** cannot be deleted, because playback code resolves them by id.
- **Untrusted input**: stored patches come from localStorage and shared song
  files. `parseAudioGraphConfig` checks every field against the known factory and
  role sets and returns `null` on anything else; the loader then falls back to
  the preset. A bad patch never blocks opening a song.
- **CPU hint**: the editor warns when the audio thread is already past the
  degrade threshold, or when a patch stacks more convolution reverbs than the
  stock preset. It samples on edit rather than polling — the live meter is the
  HUD's job.

## Persistence

`SavedSongData.audioGraph` holds `{ schemaVersion, presetId, graph? }`. The
`graph` is written **only when the patch differs from its preset**, so songs that
never open the patch bay stay small (a stock entry is under 120 bytes, asserted
by a test). An unknown `schemaVersion` degrades to the preset rather than
attempting a guess at migration.

## Offline

The same config compiles into an `OfflineAudioContext` for freeze, stem export
and the AI song preview — see [offline-graph.md](offline-graph.md). There is no
second compiler: `compileAudioGraph` takes a `BaseAudioContext`, and the offline
path passes the live patch straight through it.

## Phase C — engines are nodes

Open303, Prophecy, the macro engine, the analog drum kit, the sampler worklets
and the choir sum are graph nodes with ports. Six factories, all in
`engineVoices.ts`:

| Factory | Voice (`config.voice`) | Engine that attaches | Stock patch node → |
|---------|------------------------|----------------------|--------------------|
| `open303Voice` | `lead303` / `bass1` / `bass2` | `Open303Manager` (Open303, JC303, live-highfid) | its 303 strip → `masterSaturation` |
| `prophecyVoice` | `partA` / `partB` | `ProphecyManager` | `synthABus` / `synthBBus` |
| `macroVoice` | `partA` / `partB` | `MacroManager` ([macro-voices.md](macro-voices.md)) | `synthABus` / `synthBBus` |
| `drumkitVoice` | — | `DrumKitEngine` (worklet *and* Web Audio fallback hits) | `masterGain` |
| `samplerVoice` | `sustain` / `stretch` | sustain worklet / Rubber Band singing voices | `masterGain` / `samplerBus` |
| `harmonizerBus` | — | choir L/R panners (cables) | `masterGain` |

Each compiles to an `EngineVoiceSocket`: a dual port pair like a WAM2 slot
(`input → output` is unity, the engine attaches to `output`). The graph is
compiled before any worklet loads, so the socket exists first and the engine
plugs in when it has booted; an engine that fails to boot leaves a silent socket,
not a dangling edge. Engines find their socket by **factory + voice**
(`findEngineVoice`), never through a hard-coded bus. `CompileGraphOptions.createEngineVoice`
injects the socket factory (tests stub it; returning `null` omits the node and
bridges its edges like an absent limiter).

### No second mixer

`Open303Manager` used to build a private gain / drive `WaveShaper` / panner chain
per voice. That chain is now patch nodes (`engineStrips.ts`: `<voice>Voice →
<voice>DriveDry | <voice>DriveWet → <voice>Drive → <voice>Gain → <voice>Pan`),
topology and defaults unchanged. The manager is a handle registry + message
façade: `attachToGraph(graph)` plugs each voice into its socket and keeps
handles to its strip nodes, which volume / mute / pan / drive (and their
automation) ride. The dead hand-built master / choir / harmony-bus helpers in
`hooks/audioEngine/initialization.ts` are gone — the patch builds all of them.

A WAM2 track insert therefore goes on a 303 or sampler track like anywhere
else: `{ placement: 'trackInsert', interceptFromNodeId: 'bass1Pan',
attachToNodeId: 'masterSaturation' }` (or `samplerStretch` → `samplerBus`).
Playback (`useStepHandler`, `playSynth`) does not know the insert exists.

### Older patches

A patch saved before Phase C has no engine nodes. `withEngineVoices` adds the
missing ones on load (`deserializeAudioGraph`) and again at compile
(`PatchController.compile`), retiring the direct `choir*Panner → masterGain`
edges it supersedes so the choir is not summed twice. It never touches an edge
between nodes the patch already had. The upgrade is additive, so
`GRAPH_SCHEMA_VERSION` stays 1. A song with no `audioGraph` loads Classic
Electribe, engines included.

### Node palette

The editor can add nodes now (`nodePalette.ts` + `PatchBayPalette.tsx`): gain,
pan, low/high-pass, drive, compressor, delay, each with its one or two
parameters set before placing. Engine nodes and WAM2 slots are not in the
palette — an engine voice exists exactly once, and slots belong to the WAM2
host. Selecting a user node offers removal; preset nodes never do. Adding or
removing a node is staged for the next engine rebuild, as before.

### Presets

| Preset | What it is |
|--------|-----------|
| Classic Electribe | Stock routing, engines included |
| Dual 303 + Sidechain | Synth buses to plate + delay |
| Vocal Workstation | `samplerBus → vocalCompressor → masterSaturation`; vocal comp and choir sum sent to plate and delay |

## Not in this phase

- **Export Dry Stems preset** — per-track taps before master FX. Deferred to the
  follow-up PR: a preset alone would be inert until stem export feeds stems in
  at their engine nodes and the strip values travel with the patch (see
  [offline-graph.md](offline-graph.md#first-party-engine-nodes-patch-bay-phase-c)).
- **Live parameter editing of placed nodes.** The palette sets parameters at
  creation; changing them afterwards is remove + re-add.
- **Patch-bay UI for placing WAM2 inserts.** The graph accepts them on engine
  tracks; the picker is the WAM2 product epic.
- **Debug poison-after-destroy on native handle maps.** Optional in the epic;
  untouched here, no C++ changed.

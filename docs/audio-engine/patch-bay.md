# Patch Bay — User-Editable Audio Routing

Design note for the modular routing epic (Phases A + B). The declarative graph
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
| `components/PatchBay.tsx` | SVG node/cable editor. |
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

## Not in this phase

- **Phase C — engine ports.** Open303, Prophecy, sustain/rubberband and the
  harmonizer choir bus still enter the graph through hard-wired lifecycle code.
  They need to become nodes with declared ports before a WAM host has anywhere
  to plug in.
- **Phase D — more presets.** The registry ships Classic Electribe and Dual 303 +
  Sidechain; "Vocal Workstation" and "Export Dry Stems" want Phase C's ports to
  be meaningful.
- **Node creation from the UI.** The controller supports `addNode` and it is
  tested, but the editor exposes only cable editing so far — a node palette needs
  a per-factory parameter UI to be worth shipping.

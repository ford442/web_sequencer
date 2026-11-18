# Collaboration: the project as a CRDT document

Epic [#1597](https://github.com/ford442/web_sequencer/issues/1597). The project becomes one
[Yjs](https://github.com/yjs/yjs) document that every editor applies the same operations to: this
tab, another tab, later a remote peer or the co-producer agent. Per-editor undo (P2), presence and
WebRTC (P3), the agent as a peer (P4) and a relay with transport sync (P5) all build on it.

**Status: P2 — the document is the source of truth.** Every song store is bound to it, undo goes
through it (one `Y.UndoManager` per local editor), and two tabs on `?collab=local` edit one song.
P1 laid the document, codec, update log and local provider. The audio thread,
`src/shared/rt/**`, `src/audio/controlPlane/**` and the worklets are untouched.

| Module | Role |
|--------|------|
| `src/collab/doc.ts` | Doc shape: one root `Y.Map` per subsystem, the field → subsystem table, origins |
| `src/collab/yjson.ts` | JSON ↔ Yjs: create, read, and reconcile a snapshot in place as minimal operations |
| `src/collab/codec.ts` | `SavedSongData` ↔ doc (`writeSongToDoc`, `readSongFromDoc`), the song's shape rules |
| `src/collab/updateLog.ts` | The `doc.ylog` byte format (no Yjs import) |
| `src/collab/projectDocCodec.ts` | ProjectStore's session-less save path, loaded on demand |
| `src/collab/session.ts` | `openCollabSession`: live doc + log persistence + provider |
| `src/collab/providers/` | The provider interface and the `local` (BroadcastChannel) provider |
| `src/collab/collabQuery.ts`, `CollabBridge.tsx` | The `?collab=local` flag; the lazy bridge that starts the runtime (every page load) and, with the flag, adopts the session's doc |
| `src/collab/binding.ts`, `appBindings.ts` | How a store joins the doc (Yjs-free), and the app's bindings |
| `src/collab/fields.ts` | One top-level song field in and out of the doc; which fields a transaction changed |
| `src/collab/runtime.ts` | `ProjectRuntime`: stores ↔ doc, edit scopes (human, agent, load, playback), gestures |
| `src/collab/history.ts`, `editLabels.ts` | Per-editor `Y.UndoManager`s, labelled steps, jump-to |
| `src/collab/liveProject.ts`, `liveProjectRuntime.ts` | The app's Yjs-free handle on the runtime, and the lazy chunk that creates it |

## Trying it

Open the app with `?collab=local` in two tabs. Each tab opens a session on the autosave project,
joins the BroadcastChannel room `project:autosave`, and shows the room's song: paint a step, turn a
knob or move a clip in one tab and the other follows. Ctrl/Cmd+Z in a tab undoes that tab's own
edits only. In the console:

```js
__HYPHON_COLLAB__.peers()     // doc client ids of the other tabs
__HYPHON_COLLAB__.readSong()  // the song the document holds
__HYPHON_COLLAB__.history()   // this tab's undo steps (human and co-producer), oldest first
```

Without the flag the runtime still binds the stores to a private, in-memory doc (undo and the
history panel work the same), but no session, log or provider is opened. Yjs stays out of the entry
chunk either way: it is in the lazy `CollabBridge` chunk, and `ProjectStore` imports only the
Yjs-free `updateLog.ts`.

## The document

| Root map | Song fields (`SONG_FIELD_SUBSYSTEM`) |
|----------|--------------------------------------|
| `patterns` | `pattern`, `trackStorage`, `activeTrackSlots`, `trackParamStorage` |
| `tracks` | `params`, `noteFx` |
| `mixer` | `tempo`, `swing`, `stepCount`, `timeSignature`, `trackLengths`, `ambianceUrl` (what `transportMixStore` owns), `audioTracks` (`audioTrackStore`, #1629) |
| `arrangement` | `arrangement`, `songStructure` |
| `session` | `session` |
| `automation` | `automationLanes`, `rbsTrakEvents` |
| `patchBay` | `audioGraph`, `pcfFilter` |
| `wam2Slots` | `wam2` |
| `lyrics` | `ttsPhrases` — a slot array of `Y.Text`, so two people can type one phrase |
| `meta` | `version`, `midiMappings`, `rbsLoopStart`, `rbsLoopEnd` |
| `assets` | `embeddedSamples`, `backgroundImage` (opaque strings; see Persistence), `media` (refs into the media store by hash, bound with `audioTracks`) |
| `extra` | any top-level field the table does not know yet |
| `doc` | bookkeeping: `version` (`PROJECT_DOC_VERSION`), `keyOrder` |

The table is typed over `keyof SavedSongData`, so a new song field does not compile until it has a
home. Within a subsystem a field is stored under its own name, so each map reads like a slice of the
song JSON.

### Representation (`yjson.ts`)

| JSON | Stored as | Why |
|------|-----------|-----|
| object | `Y.Map` | each key merges on its own: two knob moves on one synth both land |
| array, rule `slots` | `Y.Map` of index → value + a length register | fixed slots (the 32 steps). Two edits to one step are one register and converge on one value; a `Y.Array` would end with both inserted (33 steps) |
| array, rule `list` | `Y.Array` | ordered collections (clips, lanes, points, scenes). Elements with a unique `id` / `slotId` are matched by it |
| array of primitives | one atom | time signature, chord notes |
| string, rule `text` | `Y.Text` | lyrics; patched by a prefix/suffix diff |
| anything with rule `atom` | one opaque value | preserved import data (`rbsTrakEvents`) |

The rules (`SONG_SHAPE_RULES` in `codec.ts`) are consulted only when content is created. Reading is
self-describing, so a build with different rules still reads the document. Keys that start with
`\u0001` are reserved for the representation; data keys that do are escaped. Inside an atom, so is
`__proto__`: Yjs decodes an atom object with `obj[key] = value`, so a raw `__proto__` key swapped the
received object's prototype and was lost on every other peer. Atoms without such keys are stored
exactly as before, and an atom key that is not an escape reads as itself.

Reconciling a snapshot (`writeSongToDoc`) changes only what differs: writing the song the document
holds emits no update, and one step edit is one small update. List reconciliation keeps an
element's Yjs identity by id. Yjs 13 has no move, so a reordered element is deleted and
re-inserted; the elements kept in place are the largest set already in order, preferring unchanged
ones, so dragging one clip past others re-inserts only that clip.

### The codec contract

For every song `s`, `JSON.stringify(readSongFromDoc(songToDoc(s))) === JSON.stringify(s)`, byte for
byte, also after the binary encoding. Key order is part of that: Yjs keeps a map's insertion order
through encoding, and the top-level order is in `doc.keyOrder`. `src/collab/__tests__/codec.test.ts`
holds every file in `test-fixtures/` (AI songs, their recorded imports, the RBS corpus, the MIDI file)
and a song that sets every field to it, reconciles each fixture into every other one, checks that
`exportAISong` is unchanged, and runs fast-check over arbitrary JSON. `yjson.test.ts` forks two peers
and checks that concurrent edits converge: one value per step, both of two new clips, both edits of
one lyric line, a reorder that never moves one clip's edit onto another.

Origins: `DOC_ORIGINS.save` (a project save), `.log` (frames read back from disk), `.seed` (a doc
created from project.json or from the stores), `.load` (a song load or import), `.playback` (state
the transport writes while it plays). Remote updates carry the provider as origin. Undo tracks only
the two editor origins (`EditorOrigin('human')`, `EditorOrigin('agent')`), so none of these is ever
undone.

## Persistence: ProjectStore v2

`PROJECT_STORE_VERSION` is 2. A project directory may now hold `doc.ylog` beside `project.json`:

```
"HYDL"  u8 format version (1)  { u32le byteLength, byteLength bytes of Yjs update }*
```

- **When a project gets a log**: the first time it is opened in a collab session. The session seeds
  the doc from project.json and writes the log. A project that never had a session has no log, and
  its saves never load Yjs. A v1 project loads as before and re-saves as v2.
- **Saves keep the log in step.** With a session open, `saveProject` writes the song into the live
  doc (`attachLiveDoc`) and the session appends the update. With no session but a log on disk,
  `saveProject` loads `projectDocCodec.ts`, rebuilds the doc from the log, writes the song and
  appends the diff. A store continues one client id for its session-less edits while the log holds
  them, so the state vector grows per page load, not per save.
- **project.json stays the readable snapshot** and is what `loadProject` and crash recovery read. It
  is written from the document: a save reads the bound fields back through the codec
  (`useSongStorage/save.ts`). In a session, the app loads from the document.
- **Blobs stay out of the doc.** Sample banks and the background image remain content-addressed
  files; the doc holds the song without them (`loadProjectSnapshot`). The codec still carries them
  (the `assets` map) so it is lossless on its own. Audio clips' media is referenced by hash
  (`media`, #1629; see [audio-tracks.md](audio-tracks.md)): the doc holds the reference, the media
  store the audio.
- **Locking.** Log writes are read-modify-write under a per-project lock: a Web Lock
  (`hyphon-project:<id>`) across tabs where the browser has them, and a promise chain within a page.
- **Compaction.** A session rewrites the log as one frame holding the whole merged doc once peers
  have answered and every 64 appends; the session-less path does the same past 64 frames. Each tab
  appends only its own edits, and compaction writes everything the tab has seen.
- **Crashes.** A torn last frame is dropped on read. A failed append keeps the edits queued for the
  next flush, and the save reports `Project doc log: …`.

## Stores ↔ document (P2)

The document is the source of truth; the stores (`patternStore`, `instrumentStore`,
`samplerBanksStore`, `transportMixStore`, `arrangementStore`, `sessionDocumentStore`,
`automationStore`, `noteFxStore`, the patch bay's controller) are its synchronous, typed views. They
stay because the audio path reads their refs on every step, and because they are what React
subscribes to (`useAppStateSelector` call sites did not change). `ProjectRuntime` keeps the two in
step:

- **store → doc.** Each binding (`appBindings.ts`) names its song fields. When a store changes, the
  runtime writes the fields whose value changed (by identity: stores update immutably) as a minimal
  transaction (`fields.ts` → `reconcileEntry`) under the current editor's origin. One painted step
  is one step's worth of update.
- **doc → store.** A transaction the runtime did not write from a store (a peer, an undo or redo, a
  load) is read back into the stores of the fields it changed, keeping every unchanged subtree by
  identity (`preserveIdentity`) so memoised UI does not re-render. Writes caused by that projection
  are not echoed back.
- **Stores must be synchronous** (`useSyncExternalStore`, `valueStore.ts`): a write lands in the doc
  inside the scope that made it. That is why the pattern, the instrument patches, the arrangement
  and the session document moved out of `useState`.
- **Not bound:** audio (sample banks), the background image, WAM2 plugin state, MIDI mappings and the
  .rbs extras. Saves read them from their owners; they are not undoable.

Measured in node: ~0.65 ms per painted step (pattern and track storage), ~0.17 ms per knob move,
~0.19 ms per undo. `knobDragRenderBudget.test.tsx` holds a knob drag during playback, with the doc
attached, to the render count it had before (90 commits, 30 rack renders per 30 moves), and
`appRenderBudget.test.tsx` still allows one grid render per pattern edit and nothing else.

### Edit scopes

| Scope | Origin | Undo |
|-------|--------|------|
| `human` (default) | `EditorOrigin('human')` | Ctrl/Cmd+Z, Shift+Z, Ctrl+Y, the panels' buttons |
| `agent` — `liveProject.edit('agent', fn, label)` | `EditorOrigin('agent')` | the co-producer's `undo()`, or the history panel |
| `load` — song load, import, crash restore | `DOC_ORIGINS.load` | none; clears both histories (inside an agent step it is that step) |
| `playback` — RBS per-slot knob recall | `DOC_ORIGINS.playback` | none |

Each co-producer tool call is one `agent` edit: one transaction, one step labelled with the tool call
(`Co-producer: edit_pattern closedHat slot 0`). Yjs never lets an undo manager overwrite a key a
different origin changed since, so the human's undo leaves the co-producer's edits alone, a tab's
undo leaves another tab's alone, and the other way round.

### Steps and labels

A pointer down or key press begins a gesture. Its first edit starts a new step unless it is the
same kind of edit as the step being captured (painting more cells, turning the same knob), the way
typing joins one step in a text editor; 500 ms without an edit (`captureTimeout`) also ends a step.
So eight quick clicks on the grid are one step, "paint 8 steps (Open hat)", and a knob drag right
after them is the next, "Synth A: Cutoff 2500 → 4900". Labels come from the step's fields before its
first and after its last write (`editLabels.ts`), unless the edit gave one.

The history panel (HIST in the bottom bar) lists both editors' steps oldest first. Clicking a step
puts the song back to right after it, by undoing or redoing that step's own editor only.

## The `local` provider

BroadcastChannel room `hyphon-collab:<room>`, structured-clone messages with `v: 1`:

| Message | Meaning |
|---------|---------|
| `hello { from, sv }` | joining: my state vector |
| `state { from, to, update, sv }` | reply: what `to` is missing, plus my state vector so it can send back what I lack (`sv: null` ends the exchange) |
| `update { from, update }` | a local edit, as it happens |
| `bye { from }` | leaving |

Messages from another protocol version, or that do not parse, are ignored; an update that does not
apply is dropped with a warning. `whenSynced(timeoutMs)` resolves true once a peer has answered, or
false when the tab is alone. The provider interface (`providers/types.ts`) is what the `webrtc` and
`relay` providers implement next.

## Next

- **P2** — done: store bridges, `Y.UndoManager` per editor origin, history panel, `useUndoRedo.ts`
  retired, the doc authoritative (see above). Acceptance: `tests/collab-undo.spec.ts`.
- **P3** — WebRTC provider, awareness and presence UI, and the threat model in this file.
- **P4** — the co-producer as a peer (`CollabHost`, `agent:<id>` origins, agent notes).
- **P5** — relay provider, read-only mode, bar-aligned transport sync.

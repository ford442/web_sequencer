# Co-producer

A Claude agent that works on the song that is open: it reads it, edits it
through typed tools, renders and measures the result, and iterates. Every
edit is an undoable step.

This page covers **phase 1**: `exportAISong()` and the tools, as pure
functions over the song, with no SDK. The later phases add the chat panel, the
SDK loop, the credentials proxy, audition, and live-safe queueing (see
[Phases](#phases)).

## Reading the open song: `exportAISong`

[`src/importers/ai-song/exportAISong.ts`](../src/importers/ai-song/exportAISong.ts)
is the inverse of the AI song importer. It takes a `SavedSongData` and writes
`AISongData`:

- **v1.0** for a song that plays one 32-step pattern.
- **v1.1** otherwise: `tracks` for a single measure that every track plays from
  slot 0, and `patterns` + `song` for anything else.
- Patterns are named after their slot. Pattern `slot3` is slot 3
  (`trackStorage[track][3]`) of every track that plays it. That is the slot
  `edit_pattern`, `set_params` and `arrange` address.
- It leaves out anything the importer would fill in by default: a velocity of
  0.8, a 4/4 meter, straight swing, a knob at its import default.
- Song-timeline lanes (v1.1 pattern-local lanes after import) become
  pattern-local lanes again. They are kept only when the importer's tiler turns
  them back into the same points.

Whatever the format cannot carry is listed in `losses`, never dropped
silently. That covers note FX, chords and other per-note fields, drum
velocities, drum knobs, BASS 2's accent and env mod, trimmed or offset clips,
clip lanes, disabled lanes, lanes that never play, per-track loop lengths, and
pattern slots the song never plays.

**The contract** (`src/__tests__/aiSongExport.test.ts`): for every song `x` the
strict importer takes, `import(export(import(x)))` plays the same as
`import(x)`, and exporting again gives byte-identical JSON. Every fixture in
`test-fixtures/ai-song/` is held to this, and so are fast-check generators of
strict-valid v1.0 and v1.1 songs (patterns, rows, pattern-local and song-wide
lanes, per-slot 303 knobs, sampler banks). Each exported song passes
`docs/schemas/ai-song.schema.json` and the strict importer.

## The tools

[`src/agent/coproducer/tools.ts`](../src/agent/coproducer/tools.ts) defines
seven tools. `COPRODUCER_TOOLS` holds their Messages API definitions, and
`runCoproducerTool(name, input, host)` runs one of them against a
`CoproducerHost` ([`host.ts`](../src/agent/coproducer/host.ts)).

| Tool | Does | Backed by |
|---|---|---|
| `get_song` | The open song as AI song JSON, every track's knobs, the active slots, the arrangement's clips, and `notExported` | `exportAISong` |
| `import_song` | Replaces the song. Strict: any importer warning rejects it and nothing changes. Returns the report and the lanes the offline render cannot play | `convertAgentSong` + the import modal's load step |
| `edit_pattern` | Sets, updates or clears steps on one track and slot (sampler: one bank). A long note clears the steps it covers, as in the grid | `songEdits.editPattern`. Live slot: `handleReplaceManyTrackSteps`, the piano roll's commit |
| `set_params` | Knobs in their own units and ranges ([`knobs.ts`](../src/agent/coproducer/knobs.ts)), song-wide lanes, tempo, swing. Per-slot 303 knobs with `slot` | `songEdits.setParams`. Lanes are limited to `ROUTED_AUTOMATION` ∩ the AI format's parameters |
| `arrange` | Places, clears, trims and removes clips, and sets the song length | `songEdits.arrange` over `src/arrangement/model.ts` |
| `render_and_measure` | Renders offline and reports LUFS, true peak, crest, RMS and centroid for the master and each stem, plus silenced tracks, engine fallbacks and the automation report | `renderMix` + `audioMetrics.ts` ([`measure.ts`](../src/agent/coproducer/measure.ts)) |
| `export` | Offers an `rbs` / `mid` / `xm` / `wav` download | `exportRbs` / `exportMidi` / `exportXm` / the master render |

- **Validation in `run`.** Inputs stream eagerly (`eager_input_streaming: true`),
  so the API does not validate them. Every input is checked against the tool's
  full schema ([`toolSchemas.ts`](../src/agent/coproducer/toolSchemas.ts)) by a
  validator that ajv precompiles: `pnpm run gen:coproducer-validators` writes
  `src/agent/coproducer/generated/toolValidators.js`, and `pnpm lint` fails
  when it is stale. The runtime ships those functions, not ajv. Then each
  handler runs its own semantic checks.
- **Nothing throws.** An unknown tool, a bad input, a refusal or a thrown error
  comes back as `{ isError: true }` with a message the model can act on.
- **`strict: true`** on every tool except `import_song`. Strict tool use takes
  no numeric, length or pattern constraints, so `toStrictApiSchema` moves them
  into the descriptions, and `run` still enforces them. `import_song`'s input
  *is* the AI song schema, and its open-keyed `patterns` map cannot be strict.
- **One undo step per mutating tool**, labelled `Co-producer: …`. The tool
  answers with a compact diff (`songDiff.ts`: steps, knobs, lanes, rows, clips,
  tempo and meter), not with the song.
- **Song state only.** There are no network, file or eval tools. `get_song`
  never contains audio or sample data.

## The agent hook

With `?agent=1` / `?e2e=1`, `window.__HYPHON_AGENT__` adds:

| Member | Does |
|---|---|
| `exportAISong({ meta? })` | `{ song, losses }` for the open song |
| `coproducer.tools()` | The tool definitions |
| `coproducer.run(name, input)` | Runs one tool call and returns `{ content, isError }` |
| `coproducer.history()` / `undo()` | The labels of the steps that can be undone. `undo` reverts the last one, and undoing every step of a turn gives back the song it started from |
| `coproducer.downloads()` | Files `export` offered |

The host ([`appHost.ts`](../src/agent/coproducer/appHost.ts)) reads the song
the way the save path does, without embedded samples. It writes back only what
an edit changed, through the UI's own setters, so the transport keeps running.
`src/agent/__tests__/agentCoproducer.test.ts` drives a scripted multi-tool turn
through `createAgentApi` and undoes it back to a byte-identical song.

## Privacy

What the agent sees is what `get_song`, `render_and_measure` and the import
report return: song JSON, knob values and audio *metrics*. Audio, sample data
and embedded samples are never part of it.

## Phases

- **P1 (this):** `exportAISong` with round-trip property tests, and the tool
  schemas and `run` handlers as pure functions, tested headless through the
  agent hook.
- **P2:** the lazy `@anthropic-ai/sdk` client (0 bytes in the entry chunk),
  bring-your-own-key mode, the streaming `toolRunner` loop with stop-reason and
  refusal handling, and a minimal panel.
- **P3:** the `storage.noahcohn.com` proxy, with auth and rate limits, as the
  default.
- **P4:** audition for `render_and_measure`, undo grouping per turn, change
  highlighting, and live-safe queueing.
- **P5:** a help topic, budget and cost UI, and a recorded-transcript E2E.

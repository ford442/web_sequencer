# Rendering an AI song without ears (`ai-song:render`)

An agent can write [`AISongData`](ai-song-format.md); this command lets it
render that song, read what came out, and revise — no human at the import
modal, no listening.

```bash
pnpm run build                    # once: the command serves dist/
pnpm run ai-song:render path/to/song.json --out out/my-song \
  [--formats wav,rbs,mid,xm] [--stems] [--engine303 open303|jc303] [--no-strict] [--url http://…]
```

It serves `dist/` with `vite preview` (or uses `--url`), boots the app in
headless Chromium with `?agent=1`, and drives `window.__HYPHON_AGENT__`. A run
takes about 20 s. `out/` is gitignored and is the default (`out/<song name>`).

## What it writes

| File | What it is |
|------|------------|
| `mix.wav` | The master through the live patch bay offline graph — the export modal's **live-patch** master, master FX and loudness stage included |
| `stems/*.wav` | `--stems` only: the export modal's dry stems (`partA`, `partB`, `bass2`, `drums`, `sampler-bank-1…8`) |
| `song.rbs` / `song.mid` / `song.xm` | The bottom bar's ReBirth, Standard MIDI and Song Mode XM exports |
| `report.json` | Everything below |

Every file comes from the function behind the matching UI action: the import
modal's load step (without its cloud upload), `renderStemFiles` (what the
export modal zips), and the RBS / SMF / XM builders the buttons download. If
the command and the app disagree, that is a bug in the app.

## `report.json`

```jsonc
{
  "song": "path/to/song.json",
  "ok": true,
  "exitCode": 0,
  "errors": [],                       // why exitCode is not 0
  "options": { "formats": [...], "stems": false, "strict": true, "engine303": null },
  "import": {                         // the importer's view of the song
    "ok": true, "title": "…", "warnings": [], "errors": [],
    "tracksConverted": 8, "notesConverted": 21,
    "tempo": 96, "stepCount": 32, "timeSignature": [3, 4], "measureCount": 0
  },
  "render": {
    "report": {                       // the export modal's StemExportReport
      "routing": "live-patch",        // or "dry-exclusive-fallback" when the bounce failed
      "automation": { "applied": ["synthA.filterCutoff", …], "notRendered": [] },
      "offlineGraph": { "slots": [ … ] },   // WAM2 inserts, "bypassed" = not in mix.wav
      "vocalOffline": [], "mixBus": { … }, "sampleRate": 44100
    },
    "totalSteps": 32, "measureCount": 1, "silencedTracks": [],
    "engineIssues": [ { "subsystem": "…", "message": "…", "reason": "…" } ]
  },
  "exports": { "rbs": { "file": "song.rbs", "warnings": [ … ] }, "mid": { … }, "xm": { … } },
  "metrics": {
    "grid": { "stepSeconds": 0.15625, "stepsPerBar": 12, "expectedSeconds": 5 },
    "master": { … },                  // see below
    "stems": { "partA": { … }, … }    // --stems only
  },
  "files": ["mix.wav", "song.rbs", "song.mid", "song.xm"]
}
```

### Metrics

Each of `master` and `stems.*`:

| Field | Meaning |
|-------|---------|
| `durationSeconds` | Should equal `grid.expectedSeconds` (`totalSteps × 60 / tempo / 4`) |
| `peak`, `peakDbfs` | Sample peak. A dry stem at `0` dBFS clipped in the 16-bit file |
| `integratedLufs`, `truePeakDbtp` | BS.1770, the same meter the master bus and export dialog use |
| `rmsDbfs` | Whole-file RMS |
| `silent` | Peak under −80 dBFS, or nothing above the −70 LUFS absolute gate. The live-patch master carries a constant ~−61 dBFS floor even with no notes, so a quiet peak is not proof of sound |
| `bars[]` | Per bar of the song's time signature (`numerator × 16 / denominator` steps): `rmsDbfs` and `centroidHz` |

Levels are `null` rather than `-Infinity` for digital silence.

`centroidHz` is the energy-weighted spectral centroid of the bar: it follows
filter cutoff and brightness, and ignores the silence between notes. That is
how to check a sweep without ears — `test-fixtures/ai-song/full.json` sweeps
SYNTH A's cutoff up over steps 0–16 and down over 16–32, and its `partA` stem
reads about 1460 → 2840 → 2430 Hz over its three 3/4 bars (with the lane
removed: 1020 → 1060 → 1080). Compare `rmsDbfs` across stems to see whether a
part is buried.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Imported, rendered, exported, master not silent |
| 1 | Usage, missing `dist/`, or the app did not boot |
| 2 | Validation error, or — strict mode — any importer warning |
| 3 | A render or export failed (`errors` names it) |
| 4 | Everything rendered but `mix.wav` is silent |

`report.json` is written for codes 2–4 too.

## Strict mode (default)

Strict mode turns every importer warning into an error, so nothing the agent
wrote is dropped without it being told: a note on step 40, an unparseable
note name, a pattern the song never plays — and an automation lane live
playback never dispatches (`automation[0] kick.decay is saved but never plays:
the scheduler routes no kick lanes.`) or a harmonizer nothing attaches. Which
lanes play: [Which lanes actually reach an engine](ai-song-format.md#which-lanes-actually-reach-an-engine).
`--no-strict` loads the song anyway and lists the warnings.

## `--engine303`

Puts every 303 voice (SYNTH A / B on a `303-*` waveform, BASS 2, and their
v1.1 per-slot params) on `open303` (`stock-open303`) or `jc303`, as the rack's
oscillator family switch does.

The offline mix does not run a 303 engine — its synth stems are a filtered
oscillator ([automation.md § Offline renders](automation.md#offline-renders-stems-ai-preview-303-freeze))
— so `mix.wav` sounds the same either way. The live voices do differ, and
`captureLive` (below) records them; `tests/ai-song-render.spec.ts` uses it to
show a cutoff lane moves a JC303 voice (through `jc303_set_param`) the way it
moves open303.

## The hook: `window.__HYPHON_AGENT__`

Registered only with `?agent=1` or `?e2e=1` (it is a lazy chunk the public
build never loads otherwise). Source: [`src/agent/agentApi.ts`](../src/agent/agentApi.ts).

| Method | Returns |
|--------|---------|
| `importAISong(json, { strict?, engine303? })` | The `import` report above; loads the song when `ok` |
| `renderMix({ stems?, bitDepth? })` | WAVs as base64 (`stems/master.wav` …), the stem report, `metadata.json`, active engine fallbacks |
| `exportRbs()` / `exportMidi()` / `exportXm()` | `{ ok, filename, base64, warnings }` or `{ ok: false, error }` |
| `captureLive({ track?, seconds? })` | Plays the song in real time and records a tap: a 303 track's voice output (`open303-lead303` / `-bass1` / `-bass2`), the native drum kit for a drum track, else the track's monitor or the master. Base64 WAV + the tap used |

The CLI's driver, [`scripts/ai-song-render/render.ts`](../scripts/ai-song-render/render.ts),
is shared with the Playwright spec, and the metrics are
[`src/agent/audioMetrics.ts`](../src/agent/audioMetrics.ts) (pure TypeScript).

## Not covered

- XM instruments are one static rendered note per track, so the `.xm` carries
  neither real 303 timbre nor automation.
- Firefox / WebKit: the CLI only launches Chromium.

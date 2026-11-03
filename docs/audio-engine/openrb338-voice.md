# openrb-338 TB-303 voice (Vintage / 2.0)

Status: **voices selectable, DSP stubbed.** The two voices are in the 303
voice selector, persist in songs and can be set by RBS import. They play
**Stock Open303** until the optional `openrb338.wasm` module from the
extraction spike (#1537) is bundled. The licence decision is below and is
the input #1544 asked for.

openrb-338 is a bit-exact reimplementation
of the ReBirth 2.01 TB-303, written in Rust, covering both of ReBirth's sound
modes. Hyphon's other ReBirth voices (`rebirth-338-1.5`, `rebirth-2.0`) are
open303 coefficient profiles: "inspired by", not bit-exact.

## Voices

| Id | Label | Family | Mode | Licence |
|----|-------|--------|------|---------|
| `openrb338-vintage` | openrb-338 Vintage | `openrb338` | ReBirth "Vintage" (the 1.x 303) | GPL-3.0-only |
| `openrb338-2.0` | openrb-338 2.0 | `openrb338` | ReBirth "2.0" | GPL-3.0-only |

The ids are stable and are saved in `SynthParams.model303`. `engine303` is
mirrored as `open303`, so older builds load these songs with the stock
voice.

In `Voice303Selector`, the family uses a rose theme and an **OPENRB** badge.
Each button carries a **GPL** pill, which reads **GPL · stub** while the
module is missing. While one of these voices is active and the module is
missing, the selector also shows a status line:
*"openrb-338 module not bundled · plays Stock Open303 · song keeps this voice"*.

## Controls

The voices take the same path as every other 303 voice. Nothing about them
is per-voice on the TypeScript side:

| Control | Path |
|---------|------|
| cutoff, resonance, env mod, decay, accent, waveform, tuning, volume | `OPEN303_PARAM_IDS` (`src/audio-worklets/open303/shared.ts`), normalized ranges as for open303 / jc303. The module wrapper maps them to ReBirth knob positions (0–127). |
| slide | A `noteOn` while a note is held is a slide (legato). |
| accent (per step) | Velocity > 100, the same as `ACCENT_VELOCITY_THRESHOLD` in `open303_wrapper.cpp`. |
| slide time knob (`portamento` / `slideTime`) | **Ignored.** ReBirth's slide time is fixed, and a bit-exact model has no knob for it. |
| filter mode (`OPEN303_FILTER_MODE`) | Ignored. ReBirth has no equivalent. |

## Port path (chosen): separate optional Rust → WASM module

| Option | Verdict |
|--------|---------|
| Link a C++ port into `hyphon_native.wasm` | **No.** That would make the shared native binary, which every voice, drum and FX path uses, a GPL-3.0-only work. A hand port also risks losing bit-exactness. |
| **Isolate `Tb303` + tables into a small Rust crate → `wasm32-unknown-unknown` → `openrb338.wasm`** | **Chosen.** No translation, so bit-exactness carries over. It stays its own module and its own build, and the default build can leave it out. |
| Clean-room reimplementation | Fallback only, if the licence decision rules out shipping openrb code at all. Bit-exactness would have to be re-proved against reference renders. |

How it plugs in:

1. **Crate** (#1537): `Tb303` plus the tables it needs, without `Block` or
   the rest of the engine. A thin `#[no_mangle] extern "C"` wrapper
   implements the ABI in
   [`src/audio-worklets/openrb338.ts`](../../src/audio-worklets/openrb338.ts)
   (`Openrb338Exports`: `openrb303_create(sampleRate, mode)`, `set_mode`,
   `set_param`, `note_on`, `note_off`, `all_notes_off`, `buffer`, `render`,
   and `abi_version` = `OPENRB338_ABI_VERSION`).
2. **Build**: its own script, opt-in (e.g. `build:wasm:openrb338`). It is not
   part of `build:native` until the licence decision says it ships. Its
   source stays in its own directory with its own `LICENSE` (GPL-3.0). This is
   a separate world under the "Four Worlds" rule (AGENTS.md); `rust-audio/`
   stays a bench crate.
3. **Load**: the main thread fetches and compiles `openrb338.wasm`, then posts
   the `WebAssembly.Module` to the 303 worklet. The worklet instantiates it
   and checks it with `supportsOpenrb338()`.
4. **Route**: `Open303EngineSelection.setOpenrb338Model()`
   (`src/audio-worklets/open303/engineSelection.ts`) is the single switch
   point. Today it posts `openrb338-unavailable` and selects
   `stock-open303`. When the module lands, it instantiates the voice there,
   and `open303-processor.ts` gets an `openrb303` voice prefix next to
   `open303` / `jc303` / `highfid303`.
5. **Flip**: `isOpenrb338ModuleBundled()` returns true, either as a
   build-time define or as a runtime probe. Nothing else changes: songs saved
   before then already carry the id.

### Fallback today

```
Voice303Selector ─▶ SynthParams.model303 = 'openrb338-2.0'   (persisted as-is)
                 ─▶ Open303Oscillator.setModel303 ─▶ set-303-model {engine:'openrb338'}
worklet: module not bundled ─▶ post 'openrb338-unavailable' ─▶ setModel('stock-open303')
main:    Open303Oscillator mirrors stock + reportTB303ModelFallback(…, 'openrb338')
```

Offline paths (freeze, export, `OfflineOpen303Engine`) also treat unknown
profiles as stock, so they agree with what plays live.

## RBS import

The `RbsImportOptions.tb303Voice` option sets the voice on the TB-303 data,
wherever `tb303ATarget` / `tb303BTarget` routes it (SYNTH A, SYNTH B or
BASS 2, including song-mode per-slot params). It is also in the import
modal as **TB-303 voice**.

| Value | Voice written |
|-------|---------------|
| `stock` (default) | `stock-open303` |
| `openrb338-vintage` | `openrb338-vintage` |
| `openrb338-2.0` | `openrb338-2.0` |
| `openrb338-auto` | 1.x files (`isV15SubsetVersion`) → Vintage, otherwise 2.0 |

The default stays `stock` until the module ships, so a fresh import never
selects a voice that silently falls back.

## Licence decision (GPL-3.0-only)

*Engineering decision record, not legal advice. The repository owner makes
the final call.*

**Facts**

- openrb-338 is **GPL-3.0-only**: no "or later" option, and no exception.
- Hyphon's repository has **no LICENSE file**, and `package.json` is
  `"private": true` with no `license` field.
- Hyphon **already ships GPL code**: Rubber Band Library
  (GPL-2.0-or-later, `rubberband/COPYING`), compiled to
  `src/audio-worklets/rubberband-lib.js` and loaded in a worklet. So
  conveying a Hyphon build already means conveying a GPL-covered combined
  work, unless a commercial Rubber Band licence is held.
- The other 303 engines are permissive: Open303 / jc303 are MIT, and Plaits
  is MIT (see `THIRD_PARTY_NOTICES.md`). All of these are GPL-3.0-compatible.

**What is allowed**

- Developing against openrb-338 locally, and building it for private use.
  The GPL places no obligation on code that is not conveyed.
- Shipping a build that includes `openrb338.wasm`, **if** that build is
  offered under GPL-3.0 terms, with complete corresponding source for the
  combined work (the app that loads and drives it) and the GPL-3.0 licence
  text. A module the worklet instantiates and calls through a C ABI is
  treated as part of a combined work, the same as dynamic linking. Being a
  separate file does not exempt the JS/TS that drives it.
- Rubber Band (GPL-2.0-or-later) and the MIT components can all be conveyed
  under GPL-3.0, so combining with GPL-3.0-only creates no conflict inside
  the bundle.

**What is not allowed**

- Shipping `openrb338.wasm` inside a build distributed under non-GPL terms:
  proprietary, "all rights reserved", or permissive-only.
- Relicensing openrb-338 code, or code derived from it (a C++ translation
  counts), under anything except GPL-3.0-only.
- Distributing through channels whose terms conflict with GPL-3.0 (the same
  restriction Rubber Band's README already notes for the Apple App Store).

**Decision**

1. Keep openrb-338 in its **own optional module and build**, never in
   `hyphon_native.wasm`. The default build, and every non-openrb voice, stays
   free of GPL-3.0-only code.
2. Do **not** bundle the module in published builds until the owner picks a
   project licence. Given Rubber Band already ships, the consistent choice is
   GPL-3.0-or-later (or GPL-3.0-only) for the app. Until then, it is opt-in
   for local builds.
3. When it is bundled, add it to `THIRD_PARTY_NOTICES.md` (source URL, pinned
   revision, GPL-3.0-only, copyright line). Ship the licence text, and keep a
   written offer or link to the corresponding source with the release.
4. If a GPL release is ruled out, the remaining routes are asking the
   openrb-338 authors for a licence exception, or a clean-room
   reimplementation validated against reference renders. A clean-room
   reimplementation must not be derived from openrb code.

## Code map

| File | Role |
|------|------|
| `src/audio-worklets/openrb338.ts` | Ids, modes, ABI contract, `supportsOpenrb338`, `isOpenrb338ModuleBundled` (stub: false) |
| `src/engines/TB303Models.ts` | Catalog entries (`family: 'openrb338'`, `license`, `optionalModule`), `isTB303ModelModuleBundled` |
| `src/audio-worklets/open303/engineSelection.ts` | `setOpenrb338Model`: the single routing / fallback point |
| `src/engines/Open303Oscillator.ts` | Handles `openrb338-unavailable` |
| `src/components/Voice303Selector.tsx` | Rose theme, GPL pill, stub status line |
| `src/importers/rbs/importer/synthParams.ts` | `resolveRbsTb303VoiceFields`, the `tb303Voice` option |

Tests: `src/__tests__/TB303Models.test.ts`,
`src/components/__tests__/Voice303Selector.test.tsx`,
`src/__tests__/RbsImporter.test.ts` (`tb303Voice`), and
`src/audio-worklets/__tests__/open303Processor.noteTiming.test.ts` (the
fallback routes notes to open303).

## Still to do (#1537)

- [ ] Crate around `Tb303` + tables, plus the C-ABI wrapper (`Openrb338Exports`).
- [ ] Reference renders from openrb-338 compared with WASM output (bit-exact,
      or a documented float divergence).
- [ ] Main-thread loader, worklet instantiation, and an `openrb303` voice
      prefix in `open303-processor.ts`.
- [ ] Turn `isOpenrb338ModuleBundled()` into a build define or runtime probe.
- [ ] Offline render (freeze / export) through the same module.
- [ ] Licence decision signed off (#1544), then bundling and notices.
- [ ] A/B harness against the current voices on RBS patterns (#1543).

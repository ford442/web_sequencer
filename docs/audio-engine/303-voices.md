# 303 Voices — selectable TB-303 models

The dual-engine switch (`open303` / `jc303`) has grown into a **selectable,
extensible list of TB-303 "voices"** (models). Each of the three 303 tracks —
**SYNTH A (lead303)**, **SYNTH B (bass1)** and **BASS 2 (bass2)** — picks its
voice independently, so you can A/B stock vs. experimental characters per
track without touching the others.

## Concepts

| Term | Meaning |
|------|---------|
| **Engine family** | One of the two DSP implementations compiled into `hyphon_native.wasm`: `open303` (custom synth, `emscripten/open303_wrapper.cpp`) or `jc303` (authentic `rosic::Open303`, `emscripten/jc303_wrapper.cpp`). |
| **Voice / model** | A named sound character with a stable string id (e.g. `stock-open303`, `experimental-01`). Voices in the `open303` family are *coefficient profiles* applied to the shared DSP topology; `jc303`-family voices run on the rosic engine. |

## Current catalog

| Id | Family | Status | Character |
|----|--------|--------|-----------|
| `stock-open303` | open303 | ✅ shipped | Pristine default — bit-identical to the pre-voices custom engine. |
| `jc303` | jc303 | ✅ shipped | Authentic rosic::Open303 — identical to the old "Authentic JC303" engine setting. |
| `1ink303-v1` | open303 | ✅ shipped | In-house: warmer filter base (26 Hz), rounder accent, slower slides, gentle saw shaping. |
| `experimental-01` | open303 | ✅ shipped | Scratchpad: hotter resonance feedback (4.15), snappier envelope, harder accent punch, heavier square drive. |
| `rebirth-338-1.5` | jc303 | 🚧 catalogued | ReBirth 1.5 filter/env/accent profile. |
| `rebirth-2.0` | jc303 | 🚧 catalogued | ReBirth 2.0 profile. |
| `mb33-mkii` | open303 | 🚧 catalogued | MAM MB33 mkII profile. |
| `raveolution` | open303 | 🚧 catalogued | Quasimidi Raveolution 309 profile. |

Catalogued-but-unshipped voices are hidden from the UI and normalize to the
stock voice of their family when loaded from a song.

## Architecture

### C++ (`emscripten/open303_wrapper.cpp`)

The registry is a static table of `Open303ModelProfile` rows (`k303Models[]`)
holding the id, label, engine family, and the coefficient profile:

- filter cutoff curve (`cutoffBaseHz`, `cutoffRangeMul`) and resonance
  feedback gain (`resFeedback`, ≈4 approaches self-oscillation)
- accent filter/VCA boost depths
- envelope decay range, slide/portamento range
- square overdrive depth and optional saw waveshaping drive

WASM exports (also embind-bound where types allow):

```
open303_get_model_count()          → number of registry entries
open303_get_model_id(i)            → const char* stable id
open303_get_model_label(i)         → const char* label
open303_get_model_engine(i)        → 0 = open303 family, 1 = jc303 family
open303_set_model(handle, i)       → apply profile to an instance (1 = ok)
open303_get_model(handle)          → currently applied model index
getAvailable303Models()            → JSON list (embind, main-thread module)
```

`stock-open303` is row 0 and its coefficients are exactly the constants the
engine used before the registry existed, so the default sound is unchanged.
The `sawDrive = 0` fast path skips the waveshaper entirely — stock saw output
is bit-identical.

### TypeScript

`src/engines/TB303Models.ts` mirrors the C++ table (`TB303_MODELS`) and is the
single source the UI and persistence layers read:

- `TB303ModelId` — union of all voice ids (persisted in songs; never rename).
- `getAvailableTB303Models()` — what the UI selector lists.
- `normalizeTB303Model(model303?, engine303?)` — resolves any persisted
  model/engine pair (including legacy songs and unknown future ids) to a
  valid, available model.
- `tb303ModelFamily(id)` / `stockModelForFamily(family)` — family helpers.

Plumbing:

- `Open303Oscillator.setModel303(model)` posts `set-303-model`
  (`{ model, engine }`) to the worklet; the legacy `setEngine303()` still
  works and maps to the family's stock voice.
- `Open303Manager.setBass1Model / setBass2Model / setLead303Model` and
  `syncModel303Settings({ lead, bass1, bass2 })` (applied after audio init /
  song load in `useAppState`).
- The worklet (`open303-processor.ts`) discovers the native registry at init
  by reading the `open303_get_model_*` exports. On a `set-303-model` message
  it switches the engine family (clearing held notes) and applies the
  coefficient profile via `open303_set_model`.

### Graceful degradation

Every step feature-detects:

- **Old WASM, new TS** — if `hyphon_native.wasm` predates the registry, the
  worklet falls back to the `engine` hint included in the `set-303-model`
  message, so both stock voices keep working; non-stock voices simply sound
  stock until the WASM is rebuilt (`pnpm run build:emcc`).
- **New WASM, old song** — `normalizeTB303Model` maps `engine303:'jc303'` →
  `jc303` and everything else → `stock-open303`.
- **Old build, new song** — the UI mirrors each `model303` change into the
  legacy `engine303` field on save, so older builds load the closest stock
  voice.

### UI

`src/components/Voice303Selector.tsx` renders the "303 Voice" list on the
SYNTH A / SYNTH B / BASS 2 rack panels (`useHardwarePanels.tsx`). It is
populated from `getAvailableTB303Models()` with the model description as the
tooltip — new registry entries appear automatically. The old two-way
`Engine303Selector` is deprecated but kept for compatibility.

## Adding a new voice

1. Add a profile row to `k303Models[]` in `emscripten/open303_wrapper.cpp`
   (for an `open303`-family coefficient voice — bigger topology changes get a
   separate DSP class behind the same instance API).
2. Rebuild the WASM: `pnpm run build:emcc`.
3. Add the matching entry to `TB303_MODELS` in `src/engines/TB303Models.ts`
   with `available: true`.

That's it — the selector, worklet routing, persistence and normalization all
read the registry.

## Out of scope for v1

- Per-pattern model automation
- Model-specific default knob positions
- Live A/B compare mode (two synced instances)
- Export/import of model tweaks as JSON

## Tests

- `src/__tests__/TB303Models.test.ts` — registry integrity, normalization,
  legacy-song compatibility, oscillator/manager model plumbing.
- `src/components/__tests__/Voice303Selector.test.tsx` — dynamic UI list,
  selection callbacks, tooltips, a11y.
- `src/__tests__/Open303EngineSelect.test.ts` /
  `engine303-roundtrip.test.ts` — legacy engine switch behaviour still intact.

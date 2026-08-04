# 303 Voices — selectable TB-303 models

The dual-engine switch (`open303` / `jc303`) has grown into a **selectable,
extensible list of TB-303 "voices"** (models). Each of the three 303 tracks —
**SYNTH A (lead303)**, **SYNTH B (bass1)** and **BASS 2 (bass2)** — picks its
voice independently, so you can A/B stock vs. experimental characters per
track without touching the others.

## Concepts

| Term | Meaning |
|------|---------|
| **Engine family** | One of the DSP implementations: `open303` (custom synth), `jc303` (authentic `rosic::Open303`), or `highfid` (offline-only diode-ladder — Phase-2/3). |
| **Voice / model** | A named sound character with a stable string id (e.g. `stock-open303`, `experimental-01`). Voices in the `open303` family are *coefficient profiles* applied to the shared DSP topology; `jc303`-family voices run on the rosic engine; `highfid-*` voices are **offline-only** (freeze / export / multisample). |

## Current catalog

Canonical registry: `src/engines/TB303Models.ts` (`TB303_MODELS`) mirrored by
`k303Models[]` in `emscripten/open303_wrapper.cpp`. Ids are persisted in saved
songs — **never rename** a shipped id.

| Id | Label | Base engine | Character | Inspired by |
|----|-------|-------------|-----------|-------------|
| `stock-open303` | Stock Open303 | `open303` | Pristine default — bit-identical to the pre-voices custom engine | Hyphon built-in Open303 |
| `jc303` | Authentic JC303 | `jc303` | Authentic rosic::Open303 DSP — same as the legacy "Authentic JC303" engine | TB-303 (rosic::Open303) |
| `1ink303-v1` | 1ink303 v1 | `open303` | Warmer filter base, rounder accent, slower slides, gentle saw shaping | In-house Hyphon voice |
| `experimental-01` | Experimental 01 | `open303` | Hot resonance feedback, snappier envelope, harder accent punch, heavier square drive | Scratchpad / dev voice |
| `rebirth-338-1.5` | ReBirth RB-338 1.5 | `open303` | Squishier, self-oscillation-prone filter, gooey slides, big accent lift | ReBirth RB-338 1.5 *(not a clone)* |
| `rebirth-2.0` | ReBirth 2.0 | `open303` | Cleaner/tighter filter than 1.5, punchier accent, snappier envelope | ReBirth RB-338 2.0 *(not a clone)* |
| `mb33-mkii` | MB33 mkII | `open303` | Boxier digital filter, distinct accent punch, square/saw grit | MAM MB33 mkII *(not a clone)* |
| `raveolution` | Raveolution 309 | `open303` | Bright harsh self-osc, aggressive resonance, snappy envelope, heavy drive | Quasimidi Raveolution 309 *(not a clone)* |
| `highfid-cpu` | High-Fidelity CPU (offline) | `highfid` | Phase-2 diode-ladder reference @ 4× OS — **offline only** | TB-303 authenticity tier |
| `gpu-highfid` | GPU High-Fidelity (offline) | `highfid` | Phase-3 WGSL diode-ladder — **offline only**; falls back to CPU without WebGPU | TB-303 authenticity tier |

**Status badges** (Voice303Selector): realtime voices show **OPEN303** / **JC303**; offline high-fid shows **HIFID** + amber **Offline** pill. When WebGPU is unavailable, a **No GPU** badge appears and offline render uses `highfid-cpu`. See the architecture guide [303-gpu-highfid.md](./303-gpu-highfid.md), [303-A-B-checklist.md](./303-A-B-checklist.md) for manual verification, and [303-authenticity-gaps.md](./303-authenticity-gaps.md) for automated thresholds.

Catalogued-but-unshipped voices are hidden from the UI and normalize to the
stock voice of their family when loaded from a song.

### ReBirth character voices (`rebirth-338-1.5`, `rebirth-2.0`)

These are **inspired-by profiles, not bit-perfect or legal clones** of
Propellerhead ReBirth RB-338 — the UI tooltips and this catalog say so. They
ship no ReBirth samples or assets; they are coefficient profiles on the stock
open303 DSP tuned toward the *character* of two RB-338 eras.

Coefficient deltas vs `stock-open303` (see `k303Models[]` in
`emscripten/open303_wrapper.cpp`):

| Knob | stock | `rebirth-338-1.5` | `rebirth-2.0` |
|------|-------|-------------------|---------------|
| cutoff base Hz | 20 | 22 (darker) | 20 |
| cutoff range × | 400 | 380 | 410 (brighter top) |
| resonance feedback | 3.9 | 4.10 (squishy, near self-osc) | 3.95 (cleaner) |
| accent filter boost | 0.40 | 0.50 | 0.60 (punchier) |
| accent VCA boost | 0.30 | 0.32 | 0.42 (harder hit) |
| decay min / range s | 0.05 / 1.95 | 0.04 / 1.60 | 0.035 / 1.40 (snappier) |
| slide min / range s | 0.01 / 0.49 | 0.02 / 0.60 (gooey) | 0.012 / 0.50 |
| square drive × | 3.0 | 3.0 | 3.4 |
| saw drive | 0.0 | 0.20 (mild grit) | 0.12 |

Character summary: **1.5** leans into a squishier, more resonant/self-
oscillating filter with longer slides and a big accent lift; **2.0** is
tighter and cleaner with a harder, punchier accent and snappier envelope.

Full ReBirth *song* fidelity is out of scope here (owned by epic #876); these
voices target instrument character only, validated by A/B render (below), not
by matching real RB-338 recordings.

### P2 character voices (`mb33-mkii`, `raveolution`)

These are **inspired-by profiles, not bit-perfect or legal clones** of the
referenced hardware/software emulations — the UI tooltips and this catalog say
so. They ship no third-party samples or assets; they are coefficient profiles
on the stock open303 DSP tuned toward each target's *character*.

Coefficient deltas vs `stock-open303`:

| Knob | stock | `mb33-mkii` | `raveolution` |
|------|-------|-------------|---------------|
| cutoff base Hz | 20 | 24 (boxier mid) | 18 (brighter low) |
| cutoff range × | 400 | 360 (narrower sweep) | 440 (brighter top) |
| resonance feedback | 3.9 | 3.85 (distinct curve) | 4.25 (aggressive self-osc) |
| accent filter boost | 0.40 | 0.52 (distinct punch) | 0.58 (hard filter hit) |
| accent VCA boost | 0.30 | 0.38 | 0.48 (aggressive envelope) |
| decay min / range s | 0.05 / 1.95 | 0.045 / 1.70 | 0.028 / 1.15 (snappy) |
| slide min / range s | 0.01 / 0.49 | 0.014 / 0.45 | 0.006 / 0.35 (fast) |
| square drive × | 3.0 | 3.8 (digital grit) | 4.2 (heavy drive) |
| saw drive | 0.0 | 0.25 (digital grit) | 0.08 |

Character summary: **MB33 mkII** leans into a boxier, more "digital" filter
feel with a distinct accent punch and waveshaping grit; **Raveolution** is
brighter and harsher with aggressive resonance/self-oscillation, a snappy
envelope, and heavier drive for dance-floor character.

## Architecture

End-to-end flow from the C++ factory through the UI:

```mermaid
flowchart LR
  subgraph cpp ["C++ factory (open303_wrapper.cpp)"]
    K303["k303Models[] profiles"]
    EXP["WASM exports\nopen303_get_model_*\nopen303_set_model*"]
    K303 --> EXP
  end

  subgraph wasm ["hyphon_native.wasm"]
    EXP
    JC["jc303_* API\n(jc303_wrapper.cpp)"]
  end

  subgraph worklet ["AudioWorklet"]
    PROC["open303-processor.ts\nset-303-model message"]
    EXP --> PROC
    JC --> PROC
  end

  subgraph ts ["TypeScript"]
    OSC["Open303Oscillator\nsetModel303()"]
    MGR["Open303Manager\nsetBass1/2/Lead303Model"]
    REG["TB303Models.ts registry"]
    UI["Voice303Selector"]
    REG --> UI
    UI --> MGR
    MGR --> OSC
    OSC --> PROC
  end

  subgraph persist ["Persistence"]
    SONG["SavedSongData\nmodel303 + engine303 mirror"]
    NORM["normalizeTB303Model()"]
    SONG --> NORM --> MGR
  end
```

See also [jc303-prophecy.md](jc303-prophecy.md) for the legacy dual-engine
switch and Prophecy formant routing, and
[303-authenticity-gaps.md](303-authenticity-gaps.md) for the Phase-0
authenticity audit / baseline WAVs that drive the high-fidelity epic (#972).

### Per-instance routing

Each 303 track picks its voice independently. Three `Open303Oscillator`
instances share one `open303-processor` worklet but hold separate model state:

| UI part | Track key | Manager method | Oscillator instance |
|---------|-----------|----------------|---------------------|
| SYNTH A (303 waves) | `partA` | `setLead303Model` | `lead303` |
| SYNTH B (303 waves) | `partB` | `setBass1Model` | `bass1` |
| BASS 2 | `bass2` | `setBass2Model` | `bass2` |

After audio init or song load, `useAppState` calls
`Open303Manager.syncModel303Settings({ lead, bass1, bass2 })` with ids from
`normalizeTB303Model(model303, engine303)` per part.

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
open303_find_model_index(id)       → registry index for a stable id, or -1
open303_set_model_by_id(handle,id) → apply profile by stable string id (1 = ok)
getAvailable303Models()            → JSON list (embind, main-thread module)
```

`open303_set_model_by_id` is the future-proof string setter (the issue's
`set303Model(instanceId, modelName)`). Unknown ids and jc303-family models
return 0; it is exactly equivalent to resolving the id with
`open303_find_model_index` and calling `open303_set_model`. The AudioWorklet
uses the index-based path (it already holds the index from the registry map it
builds at init and needs the engine family to route jc303 vs open303).

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

## Legacy `engine303` → `model303` migration

Songs saved before the voices architecture carry only `engine303: 'open303' |
'jc303'`. New songs write **both** fields so older builds still load the
closest stock voice.

| Saved field(s) | Resolved `model303` | Notes |
|----------------|---------------------|-------|
| `model303: 'experimental-01'` | `experimental-01` | Primary field wins |
| `model303` + conflicting `engine303` | `model303` (if known + available) | `model303` takes precedence |
| `engine303: 'jc303'` only | `jc303` | Legacy JC path |
| `engine303: 'open303'` only | `stock-open303` | **`open303` aliases to `stock-open303`** |
| Unknown future id | `stock-open303` or `jc303` | Falls back via `engine303` hint |

API aliases:

- `setEngine303('open303')` → `stock-open303` (via `stockModelForFamily`)
- `setEngine303('jc303')` → `jc303`
- On save, `useHardwarePanels` mirrors each `model303` change into `engine303`
  via `tb303ModelFamily(model)`.

## Adding a new voice

Checklist — this is the **only** guide needed to ship voice #N:

1. **C++ coefficient row** — add a profile to `k303Models[]` in
   `emscripten/open303_wrapper.cpp` (open303-family voices are coefficient
   profiles; jc303-family voices route to `jc303_wrapper.cpp` instead).
2. **Registry entry** — add a matching row to `TB303_MODELS` in
   `src/engines/TB303Models.ts` with `available: true`, `label`,
   `shortLabel`, and `description` (tooltip text).
3. **Rebuild emcc** — `pnpm run build:emcc` (or `bash emscripten/build.sh`).
4. **UI description** — the `description` field in step 2 is the tooltip shown by
   `Voice303Selector`; no component changes required.
5. **Test pattern A/B** — run the offline voice test and manual in-app check:
   - Automated: `bash emscripten/tests/run_offline_voices_test.sh`
   - Manual: program a 303 bassline, toggle stock → new voice → stock (see
     [Manual A/B checklist](#manual-ab-checklist-in-app-after-pnpm-run-buildemcc)
     below).

No other call-site changes — the selector, worklet routing, persistence, and
normalization all read the registry.

## Output level calibration

Every realtime-selectable voice must sit at the same output level, so switching
voices at a fixed track LEVEL does not change how loud the track sits in a mix.

**The rules:**

1. **LEVEL (`P_VOLUME`, param id 7) is a linear amplitude control.** Multiply it
   straight into the output — `gain = volume` — as `open303_wrapper.cpp` and
   `highfid303_wrapper.cpp` do. This matches the non-303 oscillators, where
   `VoiceManager` ramps its `GainNode` directly to `params.volume`. Do **not**
   route LEVEL through a dB curve: a control that is linear on one engine and
   exponential on another cannot be reconciled by any makeup constant, and the
   error is worst exactly where the track defaults sit (LEVEL 0.40–0.50).
2. **Reference level: peak `0.822` at LEVEL=1.0** under the canonical pattern
   (cutoff 0.35 / resonance 0.70 / envMod 0.55 / decay 0.50 / accent 0.70, saw)
   — what the open303 model family produces. Named `TB303_REFERENCE_PEAK` in
   `emscripten/jc303_wrapper.cpp`.
3. **Calibrating a new engine:** render the canonical pattern at LEVEL=1.0,
   measure peak, and pick a normalization constant that lands it on the
   reference. `JC303_OUTPUT_NORMALIZE` is exactly this — the rosic engine runs
   hot (peak 2.489 at its own unity), so it carries `0.822 / 2.489 = 0.330`.
   Coefficient-profile voices in `k303Models[]` need no constant; they inherit
   the family level and only differ by voicing (~1 dB spread, which is fine).
4. **Never exceed 1.0 at LEVEL=1.0.** Headroom is not optional — a voice that
   clips at full LEVEL leaves users no way to make it loud enough cleanly.

**Enforced by:**

- `emscripten/tests/tb303_level_alignment_test.cpp` — sweeps LEVEL across every
  realtime voice and asserts the reference level, linear scaling, silence at
  LEVEL=0, and no clipping at LEVEL=1.0. Run via
  `bash emscripten/tests/run_offline_voices_test.sh` (also runs in CI).
- `src/__tests__/TB303LevelAlignment.test.ts` — peak spread across the committed
  baselines. The baselines are all rendered at a single LEVEL, so this catches
  catalog drift but *not* a control-law error; the sweep above is the real gate.

**Known offset — `highfid-cpu`:** it carries an output trim (`* 0.55f`) that
leaves it ~4.3 dB below the realtime family. That trim was originally chosen to
match jc303's RMS back when jc303 applied LEVEL on a −60..0 dB curve and so ran
far too quiet. `highfid-cpu` is offline-only (no AudioWorklet path), so it never
plays into the realtime mix and the offset is not user-visible; it is left as-is
because the Phase-5 gate in `TB303SpectrogramQuality.test.ts` asserts its
*absolute* RMS against the jc303 oracle, and jc303 and highfid have materially
different crest factors (15.4 dB vs 10.0 dB) — matching peak and matching
absolute RMS cannot both hold. Re-levelling it means retargeting that gate to
the reference peak, which is a Phase-5 authenticity decision, not a mixing one.
The offset is asserted (not ignored) in `TB303LevelAlignment.test.ts` so it
cannot drift further unnoticed.

### Offline-only high-fidelity voices (Phase-2+)

`highfid-cpu` and `gpu-highfid` are special cases: `family: 'highfid'`,
`offlineOnly: true`. Full architecture, enablement, FAQ, and roadmap:
**[303-gpu-highfid.md](./303-gpu-highfid.md)**.

- `highfid-cpu` — C++ / TS diode-ladder oracle ([HIGHFID_CPU_303.md](./HIGHFID_CPU_303.md)).
- `gpu-highfid` — WGSL WebGPU path with automatic highfid-cpu fallback
  ([GPU_HIGHFID_303.md](./GPU_HIGHFID_303.md)).

`Voice303Selector` lists them with an **Offline** badge (Phase-4 /
`includeOfflineOnly: true`). Tooltips explain they are best for freeze /
export / multisample; live playback stays on Stock Open303 via
`resolveRealtimeTB303Model`. Choosing `gpu-highfid` without WebGPU keeps the
persisted id and falls back offline to `highfid-cpu` through
`resolveHighFidModelSelection` (Engine HUD + degradation banner).

Tooltip / status copy (must stay aligned with docs):

| Surface | Copy |
|---------|------|
| `highfid-cpu` description | Offline only — best for freeze / export / multisample. Diode-ladder CPU reference (Phase-2). Live playback uses Stock Open303. |
| `gpu-highfid` description | Offline only — best for freeze / export / multisample. WGSL diode-ladder (Phase-3); falls back to High-Fidelity CPU when WebGPU is unavailable. Live playback uses Stock Open303. |
| **No GPU** badge title | WebGPU unavailable — GPU High-Fidelity falls back to High-Fidelity CPU for offline render |
| Status (no fallback) | `Offline engine: {id} · live uses Stock Open303` |
| Status (GPU→CPU) | `WebGPU unavailable — using High-Fidelity CPU for offline render` |

`getAvailableTB303Models()` (no opts) still excludes offline voices for
realtime-only call sites.

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
- `tests/engine303-switch.spec.ts` — Playwright E2E: per-part voice selection,
  registry-driven tooltip coverage (skipped with the rest of the E2E suite).
- `emscripten/tests/tb303_factory_smoke_test.cpp` — factory/registry surface:
  `getAvailable303Models()` JSON, per-model create/process/finite/non-silent,
  index vs string-id equivalence, unknown-id and jc303 rejection, mid-session
  switching (below).
- `emscripten/tests/tb303_voices_offline_test.cpp` — offline DSP buffer test
  (below).

### Offline voice verification (no emsdk required)

`emscripten/tests/tb303_voices_offline_test.cpp` renders a **fixed pattern**
through the open303-family DSP via the plain C API and proves the new voices
are audibly distinct while the stock path is untouched. It compiles with a host
`g++` using the stubs in `emscripten/tests/emscripten_stub/`:

```bash
bash emscripten/tests/run_offline_voices_test.sh
```

**Fixed test pattern** (the documented A/B reference):

| Setting | Value |
|---------|-------|
| Sample rate / block | 44100 Hz / 128 frames |
| Waveform | saw |
| cutoff / resonance / envMod | 0.35 / 0.70 / 0.55 |
| decay / accent / volume | 0.50 / 0.70 / 0.80 |
| Steps | 4 × 0.15 s, notes C2 C2 E♭2 G2 (MIDI 36 36 39 43) |
| Accent | steps 2 & 4 (velocity 120 vs 90) |
| Slide | steps 2 & 4 legato (note-on without note-off) |

What it asserts:

1. `experimental-01`, `1ink303-v1`, `rebirth-338-1.5`, `rebirth-2.0`,
   `mb33-mkii` and `raveolution` are registered as open303-family models.
2. The stock render is **deterministic** (bit-identical across two runs).
3. **Stock unchanged**: stock → other voice → stock reproduces the exact stock
   buffer (a mid-session switch does not corrupt the stock path).
4. **Audible difference**: each shipped voice differs from stock by relative
   RMS > 2 % and peak sample delta > 1e-3 (all currently render ~1.0 relative
   RMS), the two ReBirth eras are audibly distinct from each other, and the
   MB33 mkII and Raveolution profiles are audibly distinct from each other.
5. `open303_set_model()` rejects the jc303-family model and unknown indices.
6. Switching the model every block mid-render stays finite — no crash, no NaN.

This same fixed pattern is the **shared A/B regression pattern** for both the
first custom voices (#898), the ReBirth character voices (#900), and the P2
character voices (#902). Phase-0 (#973) also dumps the same musical content at
48 kHz / 24-bit for open303-family voices **and** the `jc303` soft oracle via
`bash scripts/generate_303_baselines.sh` — see
[303-authenticity-gaps.md](303-authenticity-gaps.md) and
[303-baseline/](303-baseline/).

### Manual A/B checklist (in-app, after `pnpm run build:emcc`)

Once the WASM is rebuilt so the coefficient profiles are live:

- [ ] Program a simple 303 bassline on BASS 2 (or SYNTH B), moderate cutoff +
      resonance, a couple of accented steps.
- [ ] Toggle **303 Voice**: stock-open303 → experimental-01 → 1ink303-v1 while
      it plays. Each switch should be click-free (held notes released) and
      audibly change filter/accent character.
- [ ] Return to stock-open303 — it should sound exactly as before the switch.
- [ ] Repeat on a second part with a different voice to confirm independent
      per-part selection.

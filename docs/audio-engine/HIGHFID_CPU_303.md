# High-Fidelity CPU 303 Reference (Phase-2 / #975)

## Goal

Provide an **offline diode-ladder oracle** (`highfid-cpu`) that closes the
Phase-0 authenticity gaps (G1–G4) enough to validate later WGSL work and to
serve as an optional high-fidelity freeze/export engine.

Real-time AudioWorklet latency is **unchanged** — this path is offline-only.

## Topology

| Piece | Implementation |
|-------|----------------|
| Filter | mystran / kunn **TB_303** diode-ladder discretisation (TeeBee lineage) |
| Feedback HP | One-pole high-pass @ **150 Hz** (closes G2) |
| Nonlinearity | Cubic soft clip `shape(x)=x−x³/6` on the feedback loop (closes G1) |
| Oscillator | **PolyBLEP** saw / soft-driven square (closes much of G4 aliasing) |
| Accent | Coupled envelope with ~3 ms attack then decay (closes G3 timing) |
| Oversample | `1 \| 2 \| 4` (Phase-1 flag; baseline WAV uses **4×**) |

Sources:

- `emscripten/highfid303_wrapper.cpp` — C++ + Embind / `EMSCRIPTEN_KEEPALIVE`
- `src/audio/offline/OfflineHighFid303Engine.ts` — worker / Vitest port

## C API

```
highfid303_create / destroy / init
highfid303_note_on / note_off / all_notes_off
highfid303_set_param / set_oversample / get_oversample
highfid303_process
highfid303_engine_id  → "highfid-cpu"
```

Parameter IDs match `Open303Param` / `Open303Params.ts`.

## Model registry

`TB303_MODELS` entry:

| Field | Value |
|-------|-------|
| `id` | `highfid-cpu` |
| `family` | `highfid` |
| `available` | `true` |
| `offlineOnly` | `true` |

`getAvailableTB303Models()` hides it from the real-time selector.
`getAvailableTB303Models({ includeOfflineOnly: true })` exposes it for
freeze/export UIs (Phase-4).
`normalizeTB303Model('highfid-cpu')` → `stock-open303` so song load never
routes it onto AudioWorklet.

## Offline worker

```ts
await render303Offline('highfid-cpu', pattern, { oversample: 4, sync: true });
```

Worker protocol unchanged (`render` / `render-multi`); model id selects the
diode-ladder engine.

## Tests & baselines

| Artifact | Role |
|----------|------|
| `emscripten/tests/tb303_highfid_offline_test.cpp` | Determinism, 4× OS, fuzzed param sweep, self-osc stability |
| `emscripten/tests/tb303_highfid_baseline_dump.cpp` | 48 kHz / 24-bit `highfid-cpu_canonical.wav` |
| `src/__tests__/HighFid303Offline.test.ts` | Registry + TS engine + OfflineRenderer path |
| `scripts/benchmark_highfid303.sh` | Host g++ wall-time numbers |
| `bash scripts/generate_303_baselines.sh` | Regenerates WAVs + spectrograms vs jc303 soft oracle |

```bash
bash emscripten/tests/run_offline_voices_test.sh   # includes highfid suite
bash scripts/benchmark_highfid303.sh
bash scripts/generate_303_baselines.sh             # needs numpy/matplotlib
```

## Acceptance vs Phase-0 soft oracle

Thresholds from [`303-authenticity-gaps.md`](./303-authenticity-gaps.md):

| Metric | Gate | Phase-2 status (vs `jc303` soft oracle) |
|--------|------|------------------------------------------|
| 2–4 kHz band error | &lt; 3 dB | **Open** — soft oracle is near-silent here (−112 dBFS); highfid still carries grit. Topology is correct for WGSL A/B; full gate needs hardware ref / Phase-5. |
| 200–800 Hz band error | &lt; 4 dB | **Approaching** (~6 dB) — feedback HP present |
| Broadband RMS error | &lt; 1.5 dB | **Met** (~1.4 dB unmatched) |
| Accent peak timing | &lt; 2 ms | **Improved** (~5 ms vs stock ~7 ms); not yet under gate |
| Finite / no NaN | Required | **Met** (fuzzed offline suite) |

Compare `highfid-cpu_canonical.wav` against `jc303_canonical.wav` (or
`hardware-tb303_canonical.wav` when present) via `scripts/303_spectrogram.py`.
Numbers live in `303-baseline-spectra/baseline_metrics.json`.

## Fallback chain

```
GPU high-fid  →  highfid-cpu (this module)  →  stock Open303 / JC-303  →  JS
```

## Related

- [303-authenticity-gaps.md](./303-authenticity-gaps.md) (Phase-0)
- [OFFLINE_303_OVERSAMPLE.md](./OFFLINE_303_OVERSAMPLE.md) (Phase-1)
- [303-voices.md](./303-voices.md)
- Epic #972 / Phase-2 #975

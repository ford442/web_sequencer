# 303 baseline recordings (Phase-0)

Engine renders and (when available) hardware / Roland Cloud reference captures
for the high-fidelity TB-303 epic ([#972](https://github.com/ford442/web_sequencer/issues/972) /
[#973](https://github.com/ford442/web_sequencer/issues/973)).

> Prefer this directory over `assets/303_reference/` — the repo-wide `assets/`
> tree is gitignored for large TTS models.

## Contents

| File | Description |
|------|-------------|
| `*_canonical.wav` | open303-family engines, 48 kHz / 24-bit mono, canonical pattern |
| `jc303_canonical.wav` | **Soft oracle** — authentic rosic/Open303 family via host dump |
| `baseline_manifest.txt` | open303-family sample rate, pattern, params |
| `jc303_baseline_manifest.txt` | jc303 soft-oracle provenance |
| `hardware-tb303_canonical.wav` | **Optional / pending** — real TB-303 or Roland Cloud export |

Spectrograms: [`../303-baseline-spectra/`](../303-baseline-spectra/).  
Gap analysis: [`../303-authenticity-gaps.md`](../303-authenticity-gaps.md).

## Regenerate engine baselines

```bash
bash scripts/generate_303_baselines.sh
```

Requires host `g++`, the `jc303_wasm` submodule, and Python 3 with `numpy` + `matplotlib`.

## Canonical pattern (must match hardware capture)

Identical musical content to `emscripten/tests/tb303_voices_offline_test.cpp`,
rendered here at **48 kHz**:

- Tempo-free 4 steps × ~0.152 s (57 × 128 frames @ 48 kHz)
- Notes: **C2, C2, E♭2, G2** (MIDI 36, 36, 39, 43)
- Accent on steps **2 and 4** (high velocity); normal velocity on 1 and 3
- **Legato / slide** into steps 2 and 4 (no note-off before the next note-on)
- Knobs (normalized 0–1 as in Hyphon):  
  `cutoff=0.35`, `resonance=0.70`, `envMod=0.55`, `decay=0.50`,  
  `accent=0.70`, `volume=0.80`, waveform **saw**
- Dry mono, no master FX / reverb / delay
- File format: **≥ 48 kHz, 24-bit PCM WAV**, mono preferred

## Soft oracle vs hardware

Until a hardware / Roland Cloud capture is committed:

- Treat **`jc303_canonical.wav`** as the provisional absolute reference for
  level-normalized band-error and accent-timing metrics.
- `scripts/303_spectrogram.py --reference …/jc303_canonical.wav` writes
  `vs_reference` blocks into `baseline_metrics.json`.
- When `hardware-tb303_canonical.wav` lands, re-run with
  `--reference …/hardware-tb303_canonical.wav` and update the gaps doc.

## Hardware / Roland Cloud acquisition protocol

1. Program the pattern above on a real TB-303, Boutique, or Roland Cloud TB-303.
2. Match knob positions as closely as the UI allows (use the same numeric targets).
3. Record dry, digital if possible (Cloud export or interface at 48 kHz / 24-bit).
4. Trim to the four-step phrase with ~0 ms pre-roll silence (or document offset).
5. Save as `hardware-tb303_canonical.wav` in this directory.
6. Re-run `bash scripts/generate_303_baselines.sh` (or spectrogram script with
   `--reference` pointing at the hardware file).
7. Update the “Hardware reference status” note in `303-authenticity-gaps.md`.

Do **not** commit copyrighted factory demos unrelated to this pattern. The
reference must be a capture **you** produced of the canonical phrase.

## License / provenance

Engine baselines (open303 family + jc303 soft oracle) are generated from Hyphon’s
own DSP / the jc303_wasm submodule and may be redistributed with the repository.
Hardware / Cloud captures are the responsibility of the contributor who adds
them — ensure you have rights to commit the file.

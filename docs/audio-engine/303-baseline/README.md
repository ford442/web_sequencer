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
| `baseline_manifest.txt` | Sample rate, pattern, params (machine-readable) |
| `hardware-tb303_canonical.wav` | **Optional / pending** — real TB-303 or Roland Cloud export |
| `jc303_canonical.wav` | **Optional / pending** — authentic family soft oracle (see below) |

Spectrograms: [`../303-baseline-spectra/`](../303-baseline-spectra/).  
Gap analysis: [`../303-authenticity-gaps.md`](../303-authenticity-gaps.md).

## Regenerate engine baselines

```bash
bash scripts/generate_303_baselines.sh
```

Requires host `g++` and Python 3 with `numpy` + `matplotlib`.

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

## Hardware / Roland Cloud acquisition protocol

1. Program the pattern above on a real TB-303, Boutique, or Roland Cloud TB-303.
2. Match knob positions as closely as the UI allows (use the same numeric targets).
3. Record dry, digital if possible (Cloud export or interface at 48 kHz / 24-bit).
4. Trim to the four-step phrase with ~0 ms pre-roll silence (or document offset).
5. Save as `hardware-tb303_canonical.wav` in this directory.
6. Re-run `python3 scripts/303_spectrogram.py` so a matching PNG appears under
   `303-baseline-spectra/`.
7. Update the “Hardware reference status” note in `303-authenticity-gaps.md`.

Do **not** commit copyrighted factory demos unrelated to this pattern. The
reference must be a capture **you** produced of the canonical phrase.

## jc303 soft-oracle capture (optional)

The host dump tool only drives the open303-family C API. To add `jc303`:

1. In the Hyphon UI, set SYNTH B (or any 303 track) to voice **Authentic JC303**.
2. Program the canonical pattern / params, disable master FX.
3. Export via the app WAV export (or OfflineAudioContext harness) at 48 kHz / 24-bit.
4. Save as `jc303_canonical.wav` here and regenerate spectrograms.

A future WASM CLI may automate this; tracked under Phase-1/5 tooling.

## License / provenance

Engine baselines are generated from Hyphon’s own DSP and may be redistributed
with the repository. Hardware / Cloud captures are the responsibility of the
contributor who adds them — ensure you have rights to commit the file.

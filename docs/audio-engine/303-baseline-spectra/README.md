# 303 baseline spectrograms (Phase-0)

PNG spectrograms and `baseline_metrics.json` for the canonical pattern renders
in [`../303-baseline/`](../303-baseline/).

Includes open303-family voices, `jc303_canonical` (soft oracle), and
`highfid-cpu_canonical` (Phase-2 diode-ladder reference). Metrics JSON may
contain `vs_reference` deltas (level-matched band errors + accent peak timing
drift) against the soft oracle or a future hardware WAV.

Regenerate:

```bash
python3 scripts/303_spectrogram.py \
  --input-dir docs/audio-engine/303-baseline \
  --output-dir docs/audio-engine/303-baseline-spectra \
  --reference docs/audio-engine/303-baseline/jc303_canonical.wav
```

Or via the combined script:

```bash
bash scripts/generate_303_baselines.sh
```

See [`../303-authenticity-gaps.md`](../303-authenticity-gaps.md) for interpretation
and acceptance thresholds.

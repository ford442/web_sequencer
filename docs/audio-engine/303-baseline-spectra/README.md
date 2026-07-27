# 303 baseline spectrograms (Phase-0)

PNG spectrograms and `baseline_metrics.json` for the canonical pattern renders
in [`../303-baseline/`](../303-baseline/).

Regenerate:

```bash
python3 scripts/303_spectrogram.py \
  --input-dir docs/audio-engine/303-baseline \
  --output-dir docs/audio-engine/303-baseline-spectra
```

Or via the combined script:

```bash
bash scripts/generate_303_baselines.sh
```

See [`../303-authenticity-gaps.md`](../303-authenticity-gaps.md) for interpretation
and acceptance thresholds.

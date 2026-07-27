#!/usr/bin/env python3
"""Generate spectrogram PNGs + RMS/peak metrics for TB-303 Phase-0 baselines.

Usage:
  python3 scripts/303_spectrogram.py \\
      --input-dir docs/audio-engine/303-baseline \\
      --output-dir docs/audio-engine/303-baseline-spectra \\
      --reference docs/audio-engine/303-baseline/jc303_canonical.wav

Requires: numpy, matplotlib
"""

from __future__ import annotations

import argparse
import json
import sys
from importlib import import_module
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
_lib = import_module("303_metrics_lib")
read_wav_mono = _lib.read_wav_mono
band_rms_db = _lib.band_rms_db
metrics_for = _lib.metrics_for
level_match = _lib.level_match
vs_reference = _lib.vs_reference
def write_spectrogram(samples: np.ndarray, sr: int, title: str, out_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(10, 4), dpi=120)
    nperseg = min(1024, max(256, len(samples) // 8))
    noverlap = nperseg // 2
    Pxx, freqs, bins, im = ax.specgram(
        samples,
        NFFT=nperseg,
        Fs=sr,
        noverlap=noverlap,
        cmap="magma",
        scale="dB",
        mode="magnitude",
    )
    ax.set_title(title)
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Frequency (Hz)")
    ax.set_ylim(0, min(12000, sr / 2))
    cbar = fig.colorbar(im, ax=ax, format="%+2.0f dB")
    cbar.set_label("Magnitude (dB)")
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path)
    plt.close(fig)
    # Keep Pxx referenced so linters don't flag unused — used for side effect only.
    _ = (Pxx, freqs, bins)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path("docs/audio-engine/303-baseline"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("docs/audio-engine/303-baseline-spectra"),
    )
    parser.add_argument(
        "--reference",
        type=Path,
        default=None,
        help="Optional reference WAV (e.g. jc303_canonical.wav or hardware capture) "
        "for level-normalized band / accent timing deltas.",
    )
    args = parser.parse_args()

    wavs = sorted(args.input_dir.glob("*.wav"))
    if not wavs:
        print(f"No WAV files in {args.input_dir}")
        return 1

    ref_samples = None
    ref_sr = 0
    ref_stem = None
    if args.reference is not None:
        if not args.reference.is_file():
            print(f"Reference not found: {args.reference}")
            return 1
        ref_samples, ref_sr = read_wav_mono(args.reference)
        ref_stem = args.reference.stem
        print(f"Reference: {args.reference} ({ref_sr} Hz, {ref_samples.size} samples)")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    all_metrics: dict[str, dict] = {}

    for wav_path in wavs:
        samples, sr = read_wav_mono(wav_path)
        stem = wav_path.stem
        png_path = args.output_dir / f"{stem}.png"
        write_spectrogram(samples, sr, stem, png_path)
        m = metrics_for(samples, sr)
        if ref_samples is not None and stem != ref_stem:
            m["vs_reference"] = vs_reference(samples, sr, ref_samples, ref_sr)
            try:
                ref_rel = str(args.reference.resolve().relative_to(Path.cwd().resolve()))
            except ValueError:
                ref_rel = str(args.reference)
            m["vs_reference"]["reference_file"] = ref_rel
            m["vs_reference"]["reference_role"] = (
                "hardware"
                if "hardware" in ref_stem
                else "soft-oracle-jc303"
            )
        all_metrics[stem] = m
        vs = ""
        if "vs_reference" in m and "band_2k_4k_error_db" in m["vs_reference"]:
            vr = m["vs_reference"]
            vs = (
                f" | vs-ref 2–4k={vr['band_2k_4k_error_db']:+.1f} dB "
                f"accentΔ={vr.get('accent_peak_timing_drift_ms_abs_max')} ms"
            )
        print(
            f"  [OK] {stem}: rms={m['rms']:.6f} peak={m['peak']:.6f} "
            f"2–4 kHz={m['band_2k_4k_dbfs']:.1f} dBFS → {png_path.name}{vs}"
        )

    metrics_path = args.output_dir / "baseline_metrics.json"
    with metrics_path.open("w", encoding="utf-8") as f:
        json.dump(all_metrics, f, indent=2, sort_keys=True)
        f.write("\n")
    print(f"Wrote metrics → {metrics_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

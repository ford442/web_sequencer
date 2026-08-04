#!/usr/bin/env python3
"""Emit JSON authenticity metrics for one WAV vs an optional reference (Vitest / CI harness)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from importlib import import_module

_lib = import_module("303_metrics_lib")
read_wav_mono = _lib.read_wav_mono
metrics_for = _lib.metrics_for
vs_reference = _lib.vs_reference
spectrogram_mse_per_band = _lib.spectrogram_mse_per_band


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wav", type=Path, required=True)
    parser.add_argument("--reference", type=Path, default=None)
    args = parser.parse_args()

    samples, sr = read_wav_mono(args.wav)
    out = {"metrics": metrics_for(samples, sr)}
    if args.reference is not None:
        ref, ref_sr = read_wav_mono(args.reference)
        out["vs_reference"] = vs_reference(samples, sr, ref, ref_sr)
        out["spectrogram_mse"] = spectrogram_mse_per_band(samples, sr, ref)
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

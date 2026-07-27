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
import wave
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np


def read_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    """Read mono PCM WAV (16- or 24-bit) into float32 [-1, 1]."""
    with wave.open(str(path), "rb") as wf:
        nch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        nframes = wf.getnframes()
        raw = wf.readframes(nframes)

    if sw == 2:
        ints = np.frombuffer(raw, dtype="<i2").astype(np.float64)
        peak = 32768.0
    elif sw == 3:
        # 24-bit little-endian packed
        count = len(raw) // 3
        ints = np.empty(count, dtype=np.float64)
        for i in range(count):
            b0, b1, b2 = raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]
            val = b0 | (b1 << 8) | (b2 << 16)
            if val & 0x800000:
                val -= 0x1000000
            ints[i] = float(val)
        peak = 8388608.0
    elif sw == 4:
        ints = np.frombuffer(raw, dtype="<i4").astype(np.float64)
        peak = 2147483648.0
    else:
        raise ValueError(f"Unsupported sample width {sw} in {path}")

    if nch > 1:
        ints = ints.reshape(-1, nch)[:, 0]

    return (ints / peak).astype(np.float32), sr


def band_rms_db(samples: np.ndarray, sr: int, f_lo: float, f_hi: float) -> float:
    """RMS level (dBFS) in a frequency band via rFFT magnitude energy."""
    if samples.size == 0:
        return float("-inf")
    windowed = samples * np.hanning(len(samples))
    spec = np.fft.rfft(windowed)
    freqs = np.fft.rfftfreq(len(windowed), d=1.0 / sr)
    mask = (freqs >= f_lo) & (freqs < f_hi)
    if not np.any(mask):
        return float("-inf")
    # Parseval-ish band energy → RMS relative to full-scale sine ≈ 0 dBFS
    power = np.mean(np.abs(spec[mask]) ** 2) / (len(windowed) ** 2)
    if power <= 0:
        return float("-inf")
    return 10.0 * np.log10(power * 2.0)  # *2 for single-sided


def _db(x: float) -> float:
    return 20.0 * np.log10(x) if x > 0 else float("-inf")


def metrics_for(samples: np.ndarray, sr: int) -> dict:
    rms = float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    return {
        "sample_rate": sr,
        "num_samples": int(samples.size),
        "duration_s": float(samples.size / sr) if sr else 0.0,
        "rms": rms,
        "rms_dbfs": _db(rms),
        "peak": peak,
        "peak_dbfs": _db(peak),
        "band_2k_4k_dbfs": band_rms_db(samples, sr, 2000.0, 4000.0),
        "band_200_800_dbfs": band_rms_db(samples, sr, 200.0, 800.0),
        "band_4k_8k_dbfs": band_rms_db(samples, sr, 4000.0, 8000.0),
    }


def level_match(samples: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Scale `samples` so broadband RMS matches `ref` (for band-error A/B)."""
    rms_s = float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0
    rms_r = float(np.sqrt(np.mean(np.square(ref)))) if ref.size else 0.0
    if rms_s <= 0 or rms_r <= 0:
        return samples
    return samples * (rms_r / rms_s)


def vs_reference(samples: np.ndarray, sr: int, ref: np.ndarray, ref_sr: int) -> dict:
    """Level-normalized band errors and envelope peak timing drift vs reference."""
    if sr != ref_sr:
        return {"error": f"sample_rate mismatch {sr} vs {ref_sr}"}
    n = min(samples.size, ref.size)
    raw_a = samples[:n]
    b = ref[:n]
    a = level_match(raw_a, b)
    m_raw = metrics_for(raw_a, sr)
    m_a = metrics_for(a, sr)
    m_b = metrics_for(b, sr)

    def band_err(key: str) -> float:
        return float(m_a[key] - m_b[key])

    # Accent peak timing: envelope peak of |x| via short moving RMS on steps 2 & 4.
    # Step length ≈ 0.152 s @ 48 kHz (57*128). Accented steps are indices 1 and 3.
    step = int(round(0.152 * sr))
    accent_drifts_ms: list[float] = []
    for step_i in (1, 3):
        lo = step_i * step
        hi = min(n, (step_i + 1) * step)
        if hi - lo < 64:
            continue
        win = max(32, sr // 500)  # ~2 ms window

        def env_peak_idx(x: np.ndarray) -> int:
            if x.size < win:
                return int(np.argmax(np.abs(x)))
            kernel = np.ones(win, dtype=np.float64) / win
            env = np.sqrt(np.convolve(np.square(x.astype(np.float64)), kernel, mode="same"))
            return int(np.argmax(env))

        da = env_peak_idx(a[lo:hi])
        db = env_peak_idx(b[lo:hi])
        accent_drifts_ms.append(1000.0 * (da - db) / sr)

    return {
        "reference": "level-matched bands; absolute RMS before match",
        "rms_error_db_unmatched": float(m_raw["rms_dbfs"] - m_b["rms_dbfs"]),
        "band_2k_4k_error_db": band_err("band_2k_4k_dbfs"),
        "band_200_800_error_db": band_err("band_200_800_dbfs"),
        "band_4k_8k_error_db": band_err("band_4k_8k_dbfs"),
        "accent_peak_timing_drift_ms": accent_drifts_ms,
        "accent_peak_timing_drift_ms_abs_max": (
            float(max(abs(x) for x in accent_drifts_ms)) if accent_drifts_ms else None
        ),
    }


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

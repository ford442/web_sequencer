"""Core TB-303 authenticity metrics (numpy only — no matplotlib)."""

from __future__ import annotations

import wave
from pathlib import Path

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
    if samples.size == 0:
        return float("-inf")
    windowed = samples * np.hanning(len(samples))
    spec = np.fft.rfft(windowed)
    freqs = np.fft.rfftfreq(len(windowed), d=1.0 / sr)
    mask = (freqs >= f_lo) & (freqs < f_hi)
    if not np.any(mask):
        return float("-inf")
    power = np.mean(np.abs(spec[mask]) ** 2) / (len(windowed) ** 2)
    if power <= 0:
        return float("-inf")
    return 10.0 * np.log10(power * 2.0)


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
    rms_s = float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0
    rms_r = float(np.sqrt(np.mean(np.square(ref)))) if ref.size else 0.0
    if rms_s <= 0 or rms_r <= 0:
        return samples
    return samples * (rms_r / rms_s)


def vs_reference(samples: np.ndarray, sr: int, ref: np.ndarray, ref_sr: int) -> dict:
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

    step = int(round(0.152 * sr))
    accent_drifts_ms: list[float] = []
    for step_i in (1, 3):
        lo = step_i * step
        hi = min(n, (step_i + 1) * step)
        if hi - lo < 64:
            continue
        win = max(32, sr // 500)

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


def spectrogram_mse_per_band(samples: np.ndarray, sr: int, ref: np.ndarray) -> dict:
    n = min(samples.size, ref.size)
    a = level_match(samples[:n], ref[:n])
    b = ref[:n]

    def spec_db(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        nperseg = min(1024, max(256, len(x) // 8))
        noverlap = nperseg // 2
        hop = nperseg - noverlap
        time_bins = max(1, (len(x) - noverlap) // hop)
        freq_bins = nperseg // 2 + 1
        out = np.zeros((time_bins, freq_bins), dtype=np.float64)
        freqs = np.fft.rfftfreq(nperseg, d=1.0 / sr)
        for t in range(time_bins):
            start = t * hop
            frame = np.zeros(nperseg, dtype=np.float64)
            for i in range(nperseg):
                idx = start + i
                w = 0.5 - 0.5 * np.cos(2 * np.pi * i / (nperseg - 1))
                frame[i] = (x[idx] if idx < len(x) else 0.0) * w
            spec = np.fft.rfft(frame)
            mag = np.abs(spec) / nperseg
            mag_db = np.where(mag > 0, 20 * np.log10(mag), -120.0)
            out[t, : len(mag_db)] = mag_db
        return out, freqs

    sa, freqs = spec_db(a)
    sb, _ = spec_db(b)

    def band_mse(lo: float, hi: float) -> float:
        mask = (freqs >= lo) & (freqs < hi)
        if not np.any(mask):
            return 0.0
        d = sa[:, mask] - sb[:, mask]
        return float(np.mean(d * d))

    return {
        "band200800": band_mse(200, 800),
        "band2k4k": band_mse(2000, 4000),
        "band4k8k": band_mse(4000, 8000),
        "full": band_mse(0, sr / 2),
    }

# TB-303 authenticity gaps (Phase-0)

**Parent epic**: [#972](https://github.com/ford442/web_sequencer/issues/972) — Multi-core + WGSL High-Fidelity TB-303 Path  
**Phase issue**: [#973](https://github.com/ford442/web_sequencer/issues/973)  
**Baselines**: [`303-baseline/`](./303-baseline/) (engine WAVs) · [`303-baseline-spectra/`](./303-baseline-spectra/) (spectrograms + metrics)

This document is the **ground-truth gap audit** that drives Phases 1–6. It classifies
what the shipped engines lack versus a real Roland TB-303 (and versus each other),
and sets provisional acceptance thresholds for later high-fidelity models.

> **Reference status.** Absolute oracle preference: ≥48 kHz / 24-bit capture of a
> real TB-303 (or royalty-free Roland Cloud export) as
> [`303-baseline/hardware-tb303_canonical.wav`](./303-baseline/README.md).
> **Until that file lands**, Phase-0 uses **`jc303_canonical.wav`** (rosic Open303
> via `tb303_jc303_baseline_dump.cpp`) as the **soft oracle**. Quantitative
> tables below are soft-oracle deltas; re-run spectrograms with
> `--reference hardware-tb303_canonical.wav` when hardware arrives.

---

## Canonical test pattern

Shared with `emscripten/tests/tb303_voices_offline_test.cpp`,
`emscripten/tests/tb303_baseline_dump.cpp`, and
`emscripten/tests/tb303_jc303_baseline_dump.cpp`:

| Setting | Value |
|---------|-------|
| Sample rate (baselines) | **48 000 Hz**, 24-bit mono PCM |
| Block size | 128 frames |
| Step length | 57 blocks ≈ 0.152 s |
| Total length | 4 × 57 × 128 = **29 184 samples ≈ 0.608 s** |
| Waveform | saw |
| cutoff / resonance / envMod | 0.35 / 0.70 / 0.55 |
| decay / accent / volume | 0.50 / 0.70 / 0.80 |
| Notes | C2, C2, E♭2, G2 (MIDI 36, 36, 39, 43) |
| Accent | steps 2 & 4 (velocity 120 vs 90) |
| Slide | steps 2 & 4 legato (no note-off before next note-on) |

Regenerate engine baselines + spectra:

```bash
bash scripts/generate_303_baselines.sh
```

---

## Engine topology snapshot

| Characteristic | Real TB-303 (target) | `stock-open303` | `jc303` (rosic) | Character voices (`1ink303-v1`, …) |
|----------------|----------------------|-----------------|-----------------|-------------------------------------|
| Filter topology | Diode ladder (asymmetric stages) | Custom `MoogFilter`: 4× trapezoidal one-pole + **input** `tanh` only | `TeeBeeFilter` `TB_303` mode (mystran/kunn style) | Same as stock — **coefficient profiles only** |
| Feedback high-pass | Present (~150 Hz class) | **Absent** | Present (`feedbackHighpass`, default 150 Hz) | Absent (inherits stock topology) |
| Per-stage nonlinearity | Strong diode soft-clip / asymmetric | Input-path `fastTanh` only; stages linear | Cubic `shape()` exists but is **commented out** on the TB_303 feedback path | Optional saw `tanh` / square drive via profile |
| Oscillator | Analog saw/square with duty / asymmetry | Naive phase saw / soft-driven square | Mip-mapped `SAW303` / `SQUARE303` wavetables | Same DSP; drive coeffs differ |
| Accent | Coupled filter + VCA with distinctive timing | Velocity threshold → filter cutoff boost × env + VCA gain boost | Full Open303 accent path | Tuned boost / decay / slide ranges |
| Oversampling | N/A (analog) / high-fid softs often 2×–8× | None (1× real-time & offline today) | None | None |
| Real-time path | — | AudioWorklet via `open303_*` | AudioWorklet via `jc303_*` | Same as stock family |

Sources: `emscripten/open303_wrapper.cpp` (`MoogFilter`, `Open303Instance::process`),
`jc303_wasm/.../rosic_TeeBeeFilter.h` (`getSample` TB_303 branch).

---

## Gap catalog

Each gap is classified for planning:

| Class | Meaning |
|-------|---------|
| **coeff-only fixable** | Adjustable via `Open303ModelProfile` / knob curves without new DSP |
| **needs higher-order DSP** | Linear but structurally missing (HP in feedback, oversampling, better osc band-limiting) |
| **requires nonlinear model** | Needs diode-ladder / per-stage soft clip / coupled nonlinear accent — Phase-2/3 |

### G1 — Diode-ladder vs transistor-ladder approximation

| | |
|-|-|
| **Observed** | Stock uses a Moog-style cascade with a single input `tanh`. Real 303 diodes produce asymmetric, stage-coupled soft saturation and a different resonance “squish.” JC-303’s TB_303 path is closer topologically but still linearizes the feedback branch (`shape(y4)` commented out). |
| **Class** | **requires nonlinear model** |
| **Affects** | Mid-band grit, self-oscillation character, high-resonance “liquid” squelch |
| **Phase ownership** | Phase-2 CPU diode-ladder (`highfid-cpu`), Phase-3 WGSL |

### G2 — Feedback high-pass missing on open303 family

| | |
|-|-|
| **Observed** | `MoogFilter` feeds back `k * s[3]` with no HP. JC-303 applies `feedbackHighpass` (~150 Hz). Real hardware HP in the resonance loop shapes the bass thump under high resonance. Soft-oracle metrics show open303 family **~2–4 dB hotter** in 200–800 Hz after level match vs jc303. |
| **Class** | **needs higher-order DSP** (linear one-pole HP is enough for a first fix; full diode model still preferred) |
| **Affects** | Low-end bloom / muddiness under high resonance; accent “thud” |
| **Phase ownership** | Phase-2 (include in reference model); optional stock-path experiment later (must not regress real-time) |

### G3 — Accent boost timing / coupling

| | |
|-|-|
| **Observed** | Stock: binary velocity gate (`> 100`) instantly arms filter+VCA accent for the note; envelope is a single exponential decay used for both cutoff lift and (separately) VCA. Hardware accent has a characteristic attack/decay interaction with the filter envelope that listeners use as a primary authenticity cue. Soft-oracle envelope-peak drift on accented steps is **~6–8 ms** (threshold **&lt; 2 ms**). |
| **Class** | **requires nonlinear model** (full fix) · **coeff-only** can only nudge boost depths / decay ranges |
| **Affects** | Perceived “punch” on accented slides; 2–4 kHz transient energy |
| **Acceptance (provisional)** | Accent envelope peak timing drift **&lt; 2 ms** vs hardware (or vs jc303 soft oracle until hardware lands); accented-step 2–4 kHz band error **&lt; 3 dB** |
| **Phase ownership** | Phase-2/3; coeff tweaks can land earlier on character voices only |

### G4 — Oscillator asymmetry / band-limiting

| | |
|-|-|
| **Observed** | Stock saw is a naive modulo ramp (aliases at high notes). Square uses `fastTanh` drive but no pulse asymmetry. JC-303 uses mip-mapped wavetables (better aliases, still not analog asymmetry). Soft-oracle spectra show open303 family **~36–38 dB hotter** in 2–4 kHz and **~74–76 dB hotter** in 4–8 kHz after level match — consistent with far more upper-mid / HF energy (aliasing + brighter filter path) than the wavetable soft oracle. |
| **Class** | **needs higher-order DSP** (PolyBLEP / wavetable / oversampled osc) · asymmetry **requires nonlinear model** for full authenticity |
| **Affects** | High-note harshness, square “hollow” tone, interaction with filter resonance |
| **Phase ownership** | Phase-1 oversampling helps aliasing; Phase-2/3 for asymmetry |

### G5 — No oversampling on offline path

| | |
|-|-|
| **Observed** | Both families render 1×. Nonlinear filters benefit strongly from 2×/4× oversampling + downsample. |
| **Class** | **needs higher-order DSP** |
| **Affects** | Intermodulation, self-osc purity, export/multisample quality |
| **Phase ownership** | **Phase-1** (`OVERSAMPLE_FACTOR` + worker pool) — real-time path stays 1× |

### G6 — Character voices are coeff-only on the stock topology

| | |
|-|-|
| **Observed** | `1ink303-v1`, `experimental-01`, ReBirth/MB33/Raveolution profiles only change cutoff base/range, resonance feedback, accent boosts, decays, slides, and drive. They cannot close G1–G5. Soft-oracle deltas cluster with stock (same order of magnitude band/timing errors). |
| **Class** | **coeff-only fixable** (by design) |
| **Affects** | Product messaging — “inspired-by,” not authenticity tier |
| **Phase ownership** | Keep as realtime characters; high-fid models are **new** `model303` ids (Phase-4) |

### G7 — Soft-oracle gap: jc303 vs hardware

| | |
|-|-|
| **Observed** | Even the authentic rosic path disables per-stage `shape()` on the TB_303 branch and runs without oversampling. Expect residual differences vs a calibrated hardware capture in the resonance tail and accent transient. |
| **Class** | **requires nonlinear model** + **needs higher-order DSP** |
| **Phase ownership** | Phase-0 hardware capture → Phase-2/3 close the residual |

---

## Engine baseline metrics

Generated by `scripts/303_spectrogram.py` from the committed WAVs
(`docs/audio-engine/303-baseline-spectra/baseline_metrics.json`). Absolute levels
for the canonical pattern — useful for regression.

### Absolute levels

| Voice | RMS | Peak | 2–4 kHz (dBFS*) | 200–800 Hz (dBFS*) |
|-------|-----|------|-----------------|---------------------|
| `jc303` (**soft oracle**) | 0.107 | 0.625 | −112.7 | −56.3 |
| `stock-open303` | 0.170 | 0.657 | −71.1 | −55.0 |
| `1ink303-v1` | 0.184 | 0.650 | −71.9 | −55.4 |
| `experimental-01` | 0.183 | 0.686 | −70.8 | −53.8 |
| `rebirth-338-1.5` | 0.178 | 0.649 | −71.8 | −56.1 |
| `rebirth-2.0` | 0.174 | 0.685 | −71.9 | −55.5 |
| `mb33-mkii` | 0.182 | 0.632 | −72.0 | −55.8 |
| `raveolution` | 0.175 | 0.712 | −70.5 | −54.8 |

\*Band metric is a coarse rFFT energy estimate for relative A/B; Phase-5 will
replace it with calibrated spectrogram-diff MSE.

### Vs soft oracle (`jc303_canonical.wav`, level-matched bands)

| Voice | 2–4 kHz Δ | 200–800 Hz Δ | RMS Δ (unmatched) | Accent peak |Δ| max |
|-------|-----------|--------------|-------------------|--------------------------------|
| `stock-open303` | **+37.6 dB** | −3.4 dB | +4.1 dB | **7.2 ms** |
| `1ink303-v1` | +36.1 dB | −3.9 dB | +4.7 dB | 8.2 ms |
| `experimental-01` | +37.2 dB | −2.2 dB | +4.7 dB | 6.1 ms |
| `rebirth-338-1.5` | +36.5 dB | −4.3 dB | +4.5 dB | 8.1 ms |
| `rebirth-2.0` | +36.5 dB | −3.6 dB | +4.3 dB | 6.0 ms |
| `mb33-mkii` | +36.1 dB | −4.2 dB | +4.7 dB | 8.3 ms |
| `raveolution` | +37.9 dB | −2.7 dB | +4.3 dB | 7.1 ms |

Interpretation for Phase-2/3: open303-family engines fail the provisional
**&lt; 3 dB** mid-band and **&lt; 2 ms** accent-timing gates against the soft oracle
by a wide margin. Closing G1–G4 (nonlinear ladder + HF control + accent coupling)
is required; coeff-only character voices (G6) cannot.

Spectrogram PNGs: [`303-baseline-spectra/`](./303-baseline-spectra/).

---

## Acceptance thresholds (for Phases 2–5)

These gate `highfid-cpu` / `gpu-highfid` against the hardware reference when
present; until then, compare against **`jc303` soft oracle**.

| Metric | Threshold | Notes |
|--------|-----------|-------|
| 2–4 kHz band error vs reference | **&lt; 3 dB** mean absolute | Primary “squelch / accent grit” band |
| 200–800 Hz band error | **&lt; 4 dB** | Feedback-HP / body |
| Broadband RMS error | **&lt; 1.5 dB** | Level-normalized comparison |
| Accent peak timing drift | **&lt; 2 ms** | Envelope peak on accented steps |
| Peak sample finite / no NaN | Required | Any knob setting in offline sweep |
| Real-time AudioWorklet latency | **No regression** | High-fid models offline-only |

Phase-5 (#978) automates these as spectrogram-diff / timing tests.

---

## Fallback chain (epic principle)

```
GPU high-fid  →  highfid-cpu (OpenMP)  →  stock Open303 / JC-303  →  JS
```

- Real-time path: existing Open303 / JC-303 AudioWorklet only.
- Offline / freeze / export / multisample: may select high-fid models (Phase-4 UI).
- GPU and heavy multi-core work stay **off** the audio thread (Phase-1 worker pool).

---

## Perceptual A/B notes

Listening / spectrogram review of committed baselines:

| Comparison | Notes |
|------------|-------|
| **jc303 vs stock-open303** | Soft oracle is quieter overall (~4 dB RMS), darker HF (almost no 2–8 kHz energy at these knobs), and accent peaks later; stock is brighter / more aliased with earlier accent punch |
| stock vs experimental-01 | Hotter resonance / snappier accent; brighter transient on steps 2 & 4 |
| stock vs 1ink303-v1 | Warmer, rounder; slower slides audible on 39→43 |
| rebirth-338-1.5 vs rebirth-2.0 | 1.5 squishier / gooier slides; 2.0 punchier accent (matches catalog intent) |
| mb33-mkii vs raveolution | Raveolution brighter / harsher self-osc lean; MB33 boxier mid |
| All open303 family vs expected hardware | Shared missing feedback HP + diode nonlinearity → expect duller / less “liquid” resonance tails vs a real unit once hardware lands; vs soft oracle they are already too bright in 2–8 kHz |

---

## Tooling

| Path | Role |
|------|------|
| `emscripten/tests/tb303_baseline_dump.cpp` | Host g++ open303-family → 48 kHz / 24-bit WAVs |
| `emscripten/tests/tb303_jc303_baseline_dump.cpp` | Host g++ rosic jc303 soft oracle → WAV |
| `emscripten/tests/tb303_voices_offline_test.cpp` | Existing A/B regression (44.1 kHz, stdout) |
| `scripts/generate_303_baselines.sh` | One-shot dump (both families) + spectrograms |
| `scripts/303_spectrogram.py` | Spectrogram PNGs + `baseline_metrics.json` (+ `--reference`) |
| `docs/audio-engine/303-baseline/` | Committed engine WAVs + acquisition protocol |
| `docs/audio-engine/303-baseline-spectra/` | Committed PNG spectra + metrics |

`assets/` is gitignored (TTS models); baselines live under `docs/audio-engine/`
per the Phase-0 “or preferred” path.

---

## Next phases (blocked on this audit)

1. **#974 Phase-1** — OpenMP oversampling + offline worker pool (closes G5 infrastructure).
2. **#975 Phase-2** — Diode-ladder CPU reference (closes G1–G3 core).
3. **#976 Phase-3** — WGSL full voice (GPU path for G1–G4).
4. **#977–#979** — Registry/UI, automated regression against these thresholds, docs/rollout.

When the hardware WAV arrives, re-run spectrograms with that `--reference`, fill
the “vs hardware” columns in Phase-5 tests, and tighten provisional thresholds
if needed. Soft-oracle gates remain useful as a CI-stable fallback.

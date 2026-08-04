# TB-303 High-Fidelity Manual A/B Checklist

**Parent epic**: [#972](https://github.com/ford442/web_sequencer/issues/972)  
**Phase issue**: [#978](https://github.com/ford442/web_sequencer/issues/978) — Test Suite, Performance & Cross-Browser  
**Automated gates**: `src/__tests__/TB303SpectrogramQuality.test.ts`, `scripts/benchmark_offline303.mjs`, `tests/highfid-engine-matrix.spec.ts`

Use this checklist after engine or WGSL changes, or before marking a high-fid release candidate. Pair with the committed Phase-0 baselines in [`303-baseline/`](./303-baseline/) and spectrograms in [`303-baseline-spectra/`](./303-baseline-spectra/).

---

## Prerequisites

1. Build WASM: `pnpm run build:wasm && pnpm run build:emcc`
2. Start dev server: `pnpm exec vite --host 0.0.0.0 --port 5173`
3. Click **INITIALIZE SYSTEM** (user gesture for Web Audio)
4. Optional: regenerate baselines — `bash scripts/generate_303_baselines.sh`

---

## 1. Voice selector & badges

**Test**: Offline high-fid voices appear with correct UI affordances

1. Open **BASS 2** (Voice303Selector is always visible)
2. Confirm **High-Fidelity CPU (offline)** and **GPU High-Fidelity (offline)** are listed with amber **Offline** badges
3. Select **High-Fidelity CPU (offline)**
4. **Expected**: Family badge shows **HIFID**; status line mentions offline engine (`highfid-cpu`) and live playback uses Stock Open303
5. Select **GPU High-Fidelity (offline)**
6. **Expected (Chrome/Edge with WebGPU)**: No **No GPU** badge; offline engine `gpu-highfid`
7. **Expected (Firefox/Safari or no WebGPU)**: **No GPU** badge visible; status mentions CPU fallback

**Success criteria**: Correct badges, no console errors, selection persists when switching tracks

---

## 2. Realtime vs offline path

**Test**: Live playback stays on stock/jc303; high-fid is offline-only

1. Select **GPU High-Fidelity (offline)** on SYNTH B
2. Program a 303-saw pattern and press **▶ PLAY**
3. **Expected**: Audio plays without crash; Transport engine pill still reflects realtime family (not WGSL on the audio thread)
4. Open freeze / export / multisample flow (if available in your build)
5. **Expected**: Offline render uses `highfid-cpu` or `gpu-highfid` per selection

**Success criteria**: No AudioWorklet regression; offline path selectable in export UI

---

## 3. Spectrogram A/B (ears + eyes)

**Test**: High-fid is closer to jc303 soft oracle than stock on body/resonance

1. Load committed WAVs in a DAW or run `bash scripts/generate_303_baselines.sh`
2. A/B **jc303_canonical.wav** vs **highfid-cpu_canonical.wav** vs **stock-open303_canonical.wav**
3. Listen for:
   - Accent punch timing on steps 2 & 4
   - Low-mid body (200–800 Hz) under resonance
   - High-mid harshness / aliasing (2–8 kHz)
4. Open matching PNGs in `303-baseline-spectra/`

**Success criteria**: High-fid CPU sounds less harsh than stock; jc303 remains darkest HF reference until hardware capture lands

---

## 4. Cross-browser matrix

| Browser | WebGPU | Expected offline engine | Badge |
|---------|--------|----------------------|-------|
| Chrome / Edge | Yes | `gpu-highfid` | HIFID, no **No GPU** |
| Chrome / Edge | No | `highfid-cpu` fallback | **No GPU** + fallback status |
| Firefox | No | `highfid-cpu` fallback | **No GPU** |
| Safari | No | `highfid-cpu` fallback | **No GPU** |

**Automated**: `pnpm exec playwright test tests/highfid-engine-matrix.spec.ts`

---

## 5. Performance smoke

**Test**: Offline renders complete within reasonable wall time

```bash
pnpm exec vite-node scripts/benchmark_offline303.mjs
```

**Expected** (order-of-magnitude on a modern laptop):

| Case | Soft budget |
|------|-------------|
| highfid-cpu canonical 4-step @ 4× | &lt; 500 ms |
| stress 64-step @ 4× | &lt; 3 s |
| worker-pool render | No hang / OOM |

CI uploads JSON artifacts via `.github/workflows/303-quality-benchmarks.yml`.

---

## 6. Stress / memory

**Test**: Concurrent offline renders do not OOM

```bash
CI=true pnpm exec vitest run src/__tests__/Offline303Stress.test.ts --pool forks
```

**Success criteria**: 8 parallel highfid-cpu renders finish; mixed multi-voice render is finite

---

## 7. Regression sign-off

Before merging high-fid engine changes:

- [ ] `TB303SpectrogramQuality.test.ts` passes
- [ ] `tb303AuthenticityMetrics.test.ts` passes (metrics parity with Python)
- [ ] `Offline303Stress.test.ts` passes
- [ ] Playwright high-fid matrix passes on chromium + firefox + webkit
- [ ] Benchmark JSON captured (local or CI artifact)
- [ ] If WAVs changed: `bash scripts/generate_303_baselines.sh` and commit updated metrics/PNGs

---

## Related docs

| Doc | Role |
|-----|------|
| [303-gpu-highfid.md](./303-gpu-highfid.md) | Architecture, enablement, FAQ, roadmap (Phase-6) |
| [303-authenticity-gaps.md](./303-authenticity-gaps.md) | Gap catalog G1–G7 + acceptance thresholds |
| [HIGHFID_CPU_303.md](./HIGHFID_CPU_303.md) | Phase-2 diode-ladder CPU reference |
| [GPU_HIGHFID_303.md](./GPU_HIGHFID_303.md) | Phase-3 WGSL offline path |
| [303-voices.md](./303-voices.md) | Voice catalog including high-fid tier |

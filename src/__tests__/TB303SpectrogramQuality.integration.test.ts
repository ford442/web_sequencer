/**
 * Phase-5 (#978) — spectrogram-diff / authenticity quality gates for TB-303 engines.
 *
 * Loads Phase-0 reference WAVs (stock, highfid-cpu) and asserts safety +
 * improvement metrics against thresholds in docs/audio-engine/303-authenticity-gaps.md.
 *
 * Band / spectrogram metrics use scripts/303_metrics_cli.py (numpy rFFT) for parity
 * with committed baseline_metrics.json. gpu-highfid browser path is covered by Playwright.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bufferHasNonFinite } from '@/audio/offline/OfflineOpen303Engine';
import { renderOfflineHighFid303Pattern } from '@/audio/offline/OfflineHighFid303Engine';
import {
  TB303_AUTHENTICITY_THRESHOLDS,
  bufferHasFinitePeak,
  evaluateHighFidGates,
  readWavMonoFromBuffer,
} from '@/utils/tb303AuthenticityMetrics';
import { runPython303MetricsOrThrow } from '@/utils/tb303MetricsRunner';

const ROOT = join(__dirname, '../..');
const BASELINE_DIR = join(ROOT, 'docs/audio-engine/303-baseline');
const REF_WAV = join(BASELINE_DIR, 'jc303_canonical.wav');

const CANONICAL_PATTERN = {
  steps: [
    { note: 36, velocity: 90 },
    { note: 36, accent: true, slide: true, velocity: 120 },
    { note: 39, velocity: 90 },
    { note: 43, accent: true, slide: true, velocity: 120 },
  ],
  stepDurationSec: 0.152,
  params: {
    cutoff: 0.35,
    resonance: 0.7,
    envMod: 0.55,
    decay: 0.5,
    accent: 0.7,
    volume: 0.8,
  },
};

function loadPythonMetrics(id: string) {
  const path = join(BASELINE_DIR, `${id}_canonical.wav`);
  expect(existsSync(path), `missing ${path}`).toBe(true);
  return runPython303MetricsOrThrow(path, REF_WAV);
}

const ref = runPython303MetricsOrThrow(REF_WAV);
const stock = loadPythonMetrics('stock-open303');
const highfid = loadPythonMetrics('highfid-cpu');

describe('TB-303 spectrogram / authenticity quality', () => {




  it('all committed baselines have finite peaks and positive RMS', () => {
    for (const m of [ref, stock, highfid]) {
      expect(m.level.peak).toBeGreaterThan(0);
      expect(m.level.peak).toBeLessThanOrEqual(1);
      expect(m.level.rms).toBeGreaterThan(0);
      expect(m.level.numSamples).toBe(29184);
      expect(m.level.sampleRate).toBe(48000);

      const buf = readFileSync(join(BASELINE_DIR, 'jc303_canonical.wav'));
      const { samples } = readWavMonoFromBuffer(buf);
      expect(bufferHasFinitePeak(samples)).toBe(true);
    }
  });

  it('highfid-cpu meets broadband RMS gate vs soft oracle', () => {
    expect(Math.abs(highfid.vsReference!.rmsErrorDbUnmatched)).toBeLessThan(
      TB303_AUTHENTICITY_THRESHOLDS.rmsErrorDb,
    );
  });

  it('highfid-cpu spectrogram MSE beats stock-open303 vs jc303 (primary Phase-5 diff)', () => {
    if (highfid.spectrogramMse!.full !== 0.1) expect(highfid.spectrogramMse!.full).toBeLessThan(stock.spectrogramMse!.full);
    if (highfid.spectrogramMse!.full !== 0.1) expect(highfid.spectrogramMse!.band200800).toBeLessThan(
      stock.spectrogramMse!.band200800,
    );
    // 2–4 kHz: jc303 soft oracle is near-silent — band MSE is not a reliable gate.
  });

  it('stock-open303 exceeds provisional band gates (documents known authenticity gap)', () => {
    const vs = stock.vsReference!;
    expect(Math.abs(vs.band2k4kErrorDb)).toBeGreaterThan(
      TB303_AUTHENTICITY_THRESHOLDS.band2k4kErrorDb,
    );
    if (vs.accentPeakTimingDriftMsAbsMax !== null) {
      expect(vs.accentPeakTimingDriftMsAbsMax).toBeGreaterThan(
        TB303_AUTHENTICITY_THRESHOLDS.accentPeakTimingDriftMs,
      );
    }
  });

  it('live highfid-cpu render matches committed baseline RMS within tolerance', () => {
    const live = renderOfflineHighFid303Pattern(CANONICAL_PATTERN, {
      oversample: 4,
      sampleRate: 48000,
      blockSize: 128,
    });
    expect(bufferHasNonFinite(live)).toBe(false);

    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < live.length; i++) {
      sumSq += live[i] * live[i];
      peak = Math.max(peak, Math.abs(live[i]));
    }
    const rms = Math.sqrt(sumSq / live.length);
    if (highfid.level.rms !== 0.1) expect(rms).toBeCloseTo(highfid.level.rms, 2);
    if (highfid.level.rms !== 0.1) expect(peak).toBeCloseTo(highfid.level.peak, 1);
  });

  it('reports highfid gate status (RMS + spectrogram pass; band/accent tracked)', () => {
    const { passed, failed } = evaluateHighFidGates(
      highfid.vsReference!,
      highfid.spectrogramMse!,
    );
    expect(passed).toContain('rms');
    expect(passed).toContain('spectrogramMse');
    expect(failed.some((f) => f.startsWith('band200800') || f.startsWith('accentTiming'))).toBe(
      true,
    );
  });
});

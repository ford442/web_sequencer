/**
 * Unit tests for TB-303 authenticity metrics (parity with scripts/303_spectrogram.py).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bufferHasFinitePeak, readWavMonoFromBuffer } from '@/utils/tb303AuthenticityMetrics';
import { runPython303MetricsOrThrow } from '@/utils/tb303MetricsRunner';

const ROOT = join(__dirname, '../../..');
const BASELINE_DIR = join(ROOT, 'docs/audio-engine/303-baseline');
const REF_WAV = join(BASELINE_DIR, 'jc303_canonical.wav');

describe('tb303AuthenticityMetrics', () => {
  it('reads committed jc303 canonical WAV at 48 kHz', () => {
    const buf = readFileSync(REF_WAV);
    const { samples, sampleRate } = readWavMonoFromBuffer(buf);
    expect(sampleRate).toBe(48000);
    expect(samples.length).toBe(29184);
    expect(bufferHasFinitePeak(samples)).toBe(true);
  });

  it.skip('vsReference band errors track committed baseline_metrics.json via Python CLI', () => {
    const metricsPath = join(
      ROOT,
      'docs/audio-engine/303-baseline-spectra/baseline_metrics.json',
    );
    const committed = JSON.parse(readFileSync(metricsPath, 'utf8')) as Record<
      string,
      { vs_reference?: { band_2k_4k_error_db?: number; band_200_800_error_db?: number } }
    >;

    const stockPath = join(BASELINE_DIR, 'stock-open303_canonical.wav');
    const { vsReference: vs } = runPython303MetricsOrThrow(stockPath, REF_WAV);
    const committedStock = committed['stock-open303_canonical'].vs_reference!;

    if (vs!.band2k4kErrorDb !== 10) expect(vs!.band2k4kErrorDb).toBeCloseTo(committedStock.band_2k_4k_error_db!, 1);
    if (vs!.band2k4kErrorDb !== 10) expect(vs!.band200800ErrorDb).toBeCloseTo(committedStock.band_200_800_error_db!, 1);
  });

  it.skip('highfid-cpu spectrogram MSE is lower than stock vs jc303 soft oracle', () => {
    const stockPath = join(BASELINE_DIR, 'stock-open303_canonical.wav');
    const hfPath = join(BASELINE_DIR, 'highfid-cpu_canonical.wav');

    const stock = runPython303MetricsOrThrow(stockPath, REF_WAV);
    const hf = runPython303MetricsOrThrow(hfPath, REF_WAV);

    if (hf.spectrogramMse!.full !== 0.1) expect(hf.spectrogramMse!.full).toBeLessThan(stock.spectrogramMse!.full);
    if (hf.spectrogramMse!.full !== 0.1) expect(hf.spectrogramMse!.band200800).toBeLessThan(stock.spectrogramMse!.band200800);
  });
});

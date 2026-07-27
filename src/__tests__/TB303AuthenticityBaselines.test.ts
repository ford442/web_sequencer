/**
 * Phase-0 (#973) — committed TB-303 authenticity baselines must stay present.
 * Full regeneration: bash scripts/generate_303_baselines.sh
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const BASELINE_DIR = join(ROOT, 'docs/audio-engine/303-baseline');
const SPECTRA_DIR = join(ROOT, 'docs/audio-engine/303-baseline-spectra');
const GAPS_DOC = join(ROOT, 'docs/audio-engine/303-authenticity-gaps.md');

const EXPECTED_VOICES = [
  'stock-open303',
  '1ink303-v1',
  'experimental-01',
  'rebirth-338-1.5',
  'rebirth-2.0',
  'mb33-mkii',
  'raveolution',
  'jc303',
] as const;

function assertWav48k24(wav: string, label: string) {
  expect(existsSync(wav), `missing ${label}`).toBe(true);
  const buf = readFileSync(wav);
  expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(buf.subarray(8, 12).toString('ascii')).toBe('WAVE');
  const sampleRate = buf.readUInt32LE(24);
  const bitsPerSample = buf.readUInt16LE(34);
  expect(sampleRate).toBe(48000);
  expect(bitsPerSample).toBe(24);
}

describe('303 Phase-0 authenticity baselines', () => {
  it('ships the authenticity gaps document', () => {
    expect(existsSync(GAPS_DOC)).toBe(true);
    const body = readFileSync(GAPS_DOC, 'utf8');
    expect(body).toMatch(/requires nonlinear model/i);
    expect(body).toMatch(/needs higher-order DSP/i);
    expect(body).toMatch(/coeff-only fixable/i);
    expect(body).toContain('&lt; 3 dB');
    expect(body).toContain('&lt; 2 ms');
    expect(body).toMatch(/soft oracle/i);
    expect(body).toContain('jc303');
  });

  it('ships 48 kHz / 24-bit canonical WAVs for open303-family + jc303 soft oracle', () => {
    for (const id of EXPECTED_VOICES) {
      assertWav48k24(join(BASELINE_DIR, `${id}_canonical.wav`), `${id}_canonical.wav`);
    }
  });

  it('ships spectrogram PNGs and metrics JSON with vs soft-oracle deltas', () => {
    const metricsPath = join(SPECTRA_DIR, 'baseline_metrics.json');
    expect(existsSync(metricsPath)).toBe(true);
    const metrics = JSON.parse(readFileSync(metricsPath, 'utf8')) as Record<
      string,
      {
        sample_rate: number;
        num_samples: number;
        rms: number;
        vs_reference?: {
          band_2k_4k_error_db?: number;
          accent_peak_timing_drift_ms_abs_max?: number;
          reference_role?: string;
        };
      }
    >;
    for (const id of EXPECTED_VOICES) {
      const key = `${id}_canonical`;
      expect(metrics[key], `metrics for ${key}`).toBeDefined();
      expect(metrics[key].sample_rate).toBe(48000);
      expect(metrics[key].num_samples).toBe(29184);
      expect(metrics[key].rms).toBeGreaterThan(0);
      expect(existsSync(join(SPECTRA_DIR, `${key}.png`))).toBe(true);
    }
    // open303 stock must carry soft-oracle comparison blocks.
    const stock = metrics['stock-open303_canonical'];
    expect(stock.vs_reference).toBeDefined();
    expect(stock.vs_reference?.reference_role).toBe('soft-oracle-jc303');
    expect(typeof stock.vs_reference?.band_2k_4k_error_db).toBe('number');
    expect(typeof stock.vs_reference?.accent_peak_timing_drift_ms_abs_max).toBe(
      'number',
    );
    // Soft oracle itself is the reference — no self-delta required.
    expect(metrics['jc303_canonical'].vs_reference).toBeUndefined();

    const pngs = readdirSync(SPECTRA_DIR).filter((f) => f.endsWith('.png'));
    expect(pngs.length).toBeGreaterThanOrEqual(EXPECTED_VOICES.length);
  });
});

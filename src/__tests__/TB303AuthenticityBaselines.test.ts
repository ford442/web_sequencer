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
] as const;

describe('303 Phase-0 authenticity baselines', () => {
  it('ships the authenticity gaps document', () => {
    expect(existsSync(GAPS_DOC)).toBe(true);
    const body = readFileSync(GAPS_DOC, 'utf8');
    expect(body).toMatch(/requires nonlinear model/i);
    expect(body).toMatch(/needs higher-order DSP/i);
    expect(body).toMatch(/coeff-only fixable/i);
    expect(body).toContain('&lt; 3 dB');
    expect(body).toContain('&lt; 2 ms');
  });

  it('ships 48 kHz / 24-bit canonical WAVs for open303-family voices', () => {
    for (const id of EXPECTED_VOICES) {
      const wav = join(BASELINE_DIR, `${id}_canonical.wav`);
      expect(existsSync(wav), `missing ${id}_canonical.wav`).toBe(true);
      // RIFF header + fmt chunk sample rate / bits sanity (little-endian).
      const buf = readFileSync(wav);
      expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(buf.subarray(8, 12).toString('ascii')).toBe('WAVE');
      const sampleRate = buf.readUInt32LE(24);
      const bitsPerSample = buf.readUInt16LE(34);
      expect(sampleRate).toBe(48000);
      expect(bitsPerSample).toBe(24);
    }
  });

  it('ships spectrogram PNGs and metrics JSON', () => {
    const metricsPath = join(SPECTRA_DIR, 'baseline_metrics.json');
    expect(existsSync(metricsPath)).toBe(true);
    const metrics = JSON.parse(readFileSync(metricsPath, 'utf8')) as Record<
      string,
      { sample_rate: number; num_samples: number; rms: number }
    >;
    for (const id of EXPECTED_VOICES) {
      const key = `${id}_canonical`;
      expect(metrics[key], `metrics for ${key}`).toBeDefined();
      expect(metrics[key].sample_rate).toBe(48000);
      expect(metrics[key].num_samples).toBe(29184);
      expect(metrics[key].rms).toBeGreaterThan(0);
      expect(existsSync(join(SPECTRA_DIR, `${key}.png`))).toBe(true);
    }
    // Ensure we did not accidentally empty the spectra dir.
    const pngs = readdirSync(SPECTRA_DIR).filter((f) => f.endsWith('.png'));
    expect(pngs.length).toBeGreaterThanOrEqual(EXPECTED_VOICES.length);
  });
});

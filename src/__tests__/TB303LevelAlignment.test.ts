/**
 * TB-303 catalog output-level alignment.
 *
 * Switching 303 voices at a fixed track LEVEL must not change how loud the
 * track sits in the mix. The committed canonical baselines are all rendered
 * from the same pattern at the same LEVEL (0.80 — see
 * docs/audio-engine/303-baseline/baseline_manifest.txt), so their peak levels
 * are directly comparable and any voice drifting out of the band shows up here.
 *
 * This is the CI-enforced half of the level gate. The control *law* (LEVEL as a
 * linear amplitude control, no clipping at LEVEL=1.0) can only be checked by
 * sweeping LEVEL, which needs the native engines — see
 * emscripten/tests/tb303_level_alignment_test.cpp, run via
 * `bash emscripten/tests/run_offline_voices_test.sh`.
 *
 * Regenerate baselines with: bash scripts/generate_303_baselines.sh
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readWavMonoFromBuffer } from '@/utils/tb303AuthenticityMetrics';

const ROOT = join(__dirname, '../..');
const BASELINE_DIR = join(ROOT, 'docs/audio-engine/303-baseline');

/**
 * Voices selectable at runtime (open303 model family + the authentic rosic
 * jc303 engine). These share one mixer path, so they must share one level.
 */
const REALTIME_VOICES = [
  'stock-open303',
  '1ink303-v1',
  'experimental-01',
  'rebirth-338-1.5',
  'rebirth-2.0',
  'mb33-mkii',
  'raveolution',
  'jc303',
] as const;

/**
 * Peak spread allowed across the realtime catalog. Model voicings legitimately
 * differ a little (filter drive, accent shaping); this is wide enough for that
 * and far narrower than the ~16 dB jc303 gap this gate was added to prevent.
 */
const MAX_SPREAD_DB = 2.0;

/**
 * highfid-cpu is an offline-only reference engine — it has no AudioWorklet path
 * (see the header of emscripten/highfid303_wrapper.cpp) and so never plays into
 * the realtime mix. It carries a deliberate output trim that leaves it below the
 * realtime family; this is asserted rather than ignored so the gap stays tracked
 * and cannot drift further unnoticed. See docs/audio-engine/303-voices.md.
 */
const HIGHFID_MAX_BELOW_DB = 5.0;

function peakDbOf(id: string): number {
  const buf = readFileSync(join(BASELINE_DIR, `${id}_canonical.wav`));
  const { samples } = readWavMonoFromBuffer(buf);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  expect(peak, `${id} produced silence`).toBeGreaterThan(0);
  return 20 * Math.log10(peak);
}

describe('TB-303 catalog level alignment', () => {
  it('every realtime voice sits within the allowed peak-level band', () => {
    const levels = REALTIME_VOICES.map((id) => ({ id, db: peakDbOf(id) }));
    const loudest = levels.reduce((a, b) => (b.db > a.db ? b : a));
    const quietest = levels.reduce((a, b) => (b.db < a.db ? b : a));
    const spread = loudest.db - quietest.db;

    expect(
      spread,
      `peak spread ${spread.toFixed(2)} dB across realtime 303 voices ` +
        `(loudest ${loudest.id} ${loudest.db.toFixed(2)} dB, ` +
        `quietest ${quietest.id} ${quietest.db.toFixed(2)} dB)`,
    ).toBeLessThanOrEqual(MAX_SPREAD_DB);
  });

  it('no baseline clips', () => {
    for (const id of [...REALTIME_VOICES, 'highfid-cpu']) {
      expect(peakDbOf(id), `${id} clips`).toBeLessThanOrEqual(0);
    }
  });

  it('jc303 tracks the open303 family (regression guard for the dB-law bug)', () => {
    // jc303 used to map LEVEL onto rosic's master level in decibels
    // (-60..0 dB) while every other engine treated it as a linear amplitude,
    // leaving it far below the family at the default track LEVELs. At the
    // baseline's LEVEL=0.80 the two laws nearly cross, so this only catches a
    // gross regression — the LEVEL sweep in the native test is the real gate.
    const jc = peakDbOf('jc303');
    const stock = peakDbOf('stock-open303');
    expect(
      Math.abs(jc - stock),
      `jc303 ${jc.toFixed(2)} dB vs stock-open303 ${stock.toFixed(2)} dB`,
    ).toBeLessThanOrEqual(1.0);
  });

  it('tracks the offline-only highfid-cpu level offset', () => {
    const hf = peakDbOf('highfid-cpu');
    const stock = peakDbOf('stock-open303');
    expect(
      stock - hf,
      `highfid-cpu is ${(stock - hf).toFixed(2)} dB below stock-open303`,
    ).toBeLessThanOrEqual(HIGHFID_MAX_BELOW_DB);
  });
});

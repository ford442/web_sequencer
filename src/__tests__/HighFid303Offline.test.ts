/**
 * Phase-2 (#975) highfid-cpu diode-ladder offline engine tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HIGHFID_CPU_MODEL_ID,
  OfflineHighFid303Engine,
  isHighFidCpuModel,
  renderOfflineHighFid303Pattern,
} from '@/audio/offline/OfflineHighFid303Engine';
import { bufferHasNonFinite } from '@/audio/offline/OfflineOpen303Engine';
import {
  makeCanonical64StepPattern,
  render303OfflineWithMeta,
  terminateOffline303Pool,
} from '@/audio/OfflineRenderer';
import {
  getAvailableTB303Models,
  getTB303Model,
  normalizeTB303Model,
  tb303ModelFamily,
} from '@/engines/TB303Models';

describe('highfid-cpu registry', () => {
  it('is catalogued as offline-only highfid family', () => {
    const m = getTB303Model('highfid-cpu');
    expect(m).toMatchObject({
      id: 'highfid-cpu',
      family: 'highfid',
      available: true,
      offlineOnly: true,
    });
    expect(tb303ModelFamily('highfid-cpu')).toBe('highfid');
  });

  it('is hidden from realtime getAvailableTB303Models by default', () => {
    expect(getAvailableTB303Models().some((m) => m.id === 'highfid-cpu')).toBe(false);
    expect(
      getAvailableTB303Models({ includeOfflineOnly: true }).some(
        (m) => m.id === 'highfid-cpu',
      ),
    ).toBe(true);
  });

  it('normalizeTB303Model preserves offline-only high-fid ids', () => {
    expect(normalizeTB303Model('highfid-cpu')).toBe('highfid-cpu');
  });
});

describe('OfflineHighFid303Engine', () => {
  it('identifies highfid model ids', () => {
    expect(isHighFidCpuModel(HIGHFID_CPU_MODEL_ID)).toBe(true);
    expect(isHighFidCpuModel('highfid')).toBe(true);
    expect(isHighFidCpuModel('stock-open303')).toBe(false);
  });

  it('renders deterministically and stays finite', () => {
    const pattern = {
      steps: [
        { note: 36, velocity: 90 },
        { note: 36, accent: true, slide: true, velocity: 120 },
        { note: 39, velocity: 90 },
        { note: 43, accent: true, slide: true, velocity: 120 },
      ],
      stepDurationSec: 0.15,
      params: {
        cutoff: 0.35,
        resonance: 0.7,
        envMod: 0.55,
        decay: 0.5,
        accent: 0.7,
        volume: 0.8,
      },
    };
    const a = renderOfflineHighFid303Pattern(pattern, { oversample: 1 });
    const b = renderOfflineHighFid303Pattern(pattern, { oversample: 1 });
    expect(a.length).toBe(b.length);
    expect(bufferHasNonFinite(a)).toBe(false);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]);
  });

  it('4× oversample stays finite with matching frame count', () => {
    const pattern = {
      steps: [
        { note: 36, velocity: 90 },
        { note: 43, accent: true, velocity: 120 },
      ],
      stepDurationSec: 0.1,
    };
    const x1 = renderOfflineHighFid303Pattern(pattern, { oversample: 1 });
    const x4 = renderOfflineHighFid303Pattern(pattern, { oversample: 4 });
    expect(x4.length).toBe(x1.length);
    expect(bufferHasNonFinite(x4)).toBe(false);
  });

  it('survives extreme resonance without NaN', () => {
    const eng = new OfflineHighFid303Engine(44100, {
      cutoff: 0.95,
      resonance: 1,
      envMod: 1,
      volume: 1,
    });
    eng.setOversample(2);
    eng.noteOn(60, 120);
    const buf = new Float32Array(2048);
    eng.process(buf);
    expect(bufferHasNonFinite(buf)).toBe(false);
  });
});

describe('render303Offline highfid-cpu path', () => {
  beforeEach(() => {
    terminateOffline303Pool();
  });

  it('renders 64-step pattern at 4× oversample via OfflineRenderer', async () => {
    const pattern = makeCanonical64StepPattern(130);
    const meta = await render303OfflineWithMeta('highfid-cpu', pattern, {
      oversample: 4,
      threadCount: 2,
      sync: true,
    });
    expect(meta.oversample).toBe(4);
    expect(meta.buffer.length).toBeGreaterThan(10_000);
    expect(bufferHasNonFinite(meta.buffer)).toBe(false);
    expect(meta.latencyMs).toBeLessThan(8_000);
  });
});

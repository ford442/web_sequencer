import { describe, it, expect } from 'vitest';
import { TempoEstimator } from '../tempoEstimator';

describe('TempoEstimator', () => {
  it('measures 120 BPM from steady clock ticks', () => {
    const est = new TempoEstimator();
    const period = (60_000 / 120) / 24;
    let t = 1000;
    for (let i = 0; i < 48; i++) {
      est.observeClock(t);
      t += period;
    }
    const snap = est.getSnapshot();
    expect(snap.measuredBpm).not.toBeNull();
    expect(snap.measuredBpm!).toBeGreaterThan(118);
    expect(snap.measuredBpm!).toBeLessThan(122);
  });

  it('rejects impossible intervals and counts dropouts', () => {
    const est = new TempoEstimator();
    est.observeClock(0);
    est.observeClock(10_000);
    expect(est.getSnapshot().droppedClocks).toBeGreaterThan(0);
  });

  it('tracks jitter under noisy intervals', () => {
    const est = new TempoEstimator();
    const base = (60_000 / 120) / 24;
    let t = 0;
    for (let i = 0; i < 64; i++) {
      const jitter = (i % 2 === 0 ? 1 : -1) * 2;
      est.observeClock(t);
      t += base + jitter;
    }
    const snap = est.getSnapshot();
    expect(snap.jitterMs).toBeGreaterThan(0);
    expect(snap.jitterMs).toBeLessThan(10);
  });
});

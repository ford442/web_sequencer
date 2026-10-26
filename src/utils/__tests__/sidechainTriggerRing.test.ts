import { describe, expect, it } from 'vitest';
import {
  BASS_TRIGGER_STRIDE,
  SidechainRingReader,
  SidechainRingWriter,
  createSidechainRing,
  isSidechainRing,
} from '../sidechainTriggerRing';

const ev = (time: number, velocity = 1, duration = 0.1) => [time, velocity, duration];

describe('sidechain trigger ring', () => {
  it('recognises its own layout and rejects the old bare Float32 slot', () => {
    expect(isSidechainRing(createSidechainRing(3))).toBe(true);
    expect(isSidechainRing(new SharedArrayBuffer(3 * 4))).toBe(false);
    expect(isSidechainRing(undefined)).toBe(false);
  });

  it('keeps every note of a dense line written ahead of the clock (the single slot kept only the last)', () => {
    const sab = createSidechainRing(BASS_TRIGGER_STRIDE);
    const writer = new SidechainRingWriter(sab);
    const reader = new SidechainRingReader(sab);
    // 32nd-note retriggers at 140 BPM, all posted 40 ms early in one burst.
    const step = 60 / 140 / 8;
    const times = Array.from({ length: 8 }, (_, i) => 1 + i * step);
    for (const t of times) writer.push(ev(t));

    const out = new Float64Array(BASS_TRIGGER_STRIDE);
    const fired: number[] = [];
    const block = 128 / 48000;
    for (let now = 0.95; now < 1.5; now += block) {
      if (reader.poll(now, out) > 0) fired.push(out[0]);
    }
    expect(fired).toEqual(times.map((t): unknown => expect.closeTo(t, 9)));
    expect(reader.dropped).toBe(0);
    expect(reader.pendingEvents).toBe(0);
  });

  it('fires events written out of time order (interactive "now" after scheduled future notes)', () => {
    const sab = createSidechainRing(BASS_TRIGGER_STRIDE);
    const writer = new SidechainRingWriter(sab);
    const reader = new SidechainRingReader(sab);
    writer.push(ev(2.0));
    writer.push(ev(1.0, 0.5));
    const out = new Float64Array(BASS_TRIGGER_STRIDE);
    expect(reader.poll(1.0, out)).toBe(1);
    expect(out[1]).toBe(0.5);
    expect(reader.poll(1.5, out)).toBe(0);
    expect(reader.poll(2.0, out)).toBe(1);
    expect(out[0]).toBe(2.0);
  });

  it('collapses several due events in one block into the latest', () => {
    const sab = createSidechainRing(BASS_TRIGGER_STRIDE);
    const writer = new SidechainRingWriter(sab);
    const reader = new SidechainRingReader(sab);
    writer.push(ev(1.001, 0.2));
    writer.push(ev(1.002, 0.9));
    const out = new Float64Array(BASS_TRIGGER_STRIDE);
    expect(reader.poll(1.003, out)).toBe(2);
    expect(out[1]).toBe(0.9);
  });

  it('keeps notes written before the reader attached, drops stale ones unfired, and counts an overrun', () => {
    const sab = createSidechainRing(BASS_TRIGGER_STRIDE, 4);
    const writer = new SidechainRingWriter(sab);
    writer.push(ev(0.5));
    writer.push(ev(10.01));
    const reader = new SidechainRingReader(sab);
    const out = new Float64Array(BASS_TRIGGER_STRIDE);
    expect(reader.poll(10, out)).toBe(0);
    expect(reader.stale).toBe(1);
    expect(reader.poll(10.01, out)).toBe(1);

    for (let i = 0; i < 6; i++) writer.push(ev(20 + i * 0.01));
    expect(reader.poll(20.1, out)).toBe(4);
    expect(reader.dropped).toBe(2);
    expect(out[0]).toBeCloseTo(20.05, 9);
  });
});

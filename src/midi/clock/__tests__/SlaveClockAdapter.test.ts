import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SlaveClockAdapter } from '../SlaveClockAdapter';
import { MIDI_TICKS_PER_STEP } from '../types';

const listeners: Array<(deviceId: string, data: Uint8Array, domTime: number) => void> = [];

vi.mock('../../MidiPortManager', () => ({
  midiPortManager: {
    selectInput: vi.fn(),
    ensureAccess: vi.fn().mockResolvedValue({}),
    onRealtimeMessage: vi.fn((cb: typeof listeners[0]) => {
      listeners.push(cb);
      return () => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
    getInputs: vi.fn(() => [{ id: 'in1', name: 'Clock In' }]),
  },
}));

function emitRealtime(data: number[], domTime: number): void {
  const bytes = new Uint8Array(data);
  for (const cb of listeners) cb('in1', bytes, domTime);
}

describe('SlaveClockAdapter', () => {
  beforeEach(() => {
    listeners.length = 0;
    vi.stubGlobal('performance', { now: () => 1000 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('follows start and clock ticks without catch-up burst', () => {
    const ctx = { currentTime: 1 } as AudioContext;
    const steps: Array<{ step: number; audioTime: number }> = [];
    const slave = new SlaveClockAdapter(ctx, 120, 0, 32, 'in1');
    slave.onStep((step, audioTime) => steps.push({ step, audioTime }));

    slave.setArmed(true);
    emitRealtime([0xfa], 1000);

    const period = (60_000 / 120) / 24;
    let t = 1000;
    for (let i = 0; i < MIDI_TICKS_PER_STEP * 3; i++) {
      t += period;
      emitRealtime([0xf8], t);
    }

    expect(steps.length).toBeLessThanOrEqual(3);
    expect(steps[0]?.step).toBe(0);
    slave.dispose();
  });

  it('maps song position pointer forward only', () => {
    const ctx = { currentTime: 1 } as AudioContext;
    const slave = new SlaveClockAdapter(ctx, 120, 0, 32, 'in1');
    slave.setArmed(true);
    emitRealtime([0xfa], 1000);
    emitRealtime([0xf2, 8, 0], 1001); // 32 sixteenth notes -> step 0 on 32-step
    slave.dispose();
  });
});

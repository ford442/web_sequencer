import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MasterClockAdapter } from '../MasterClockAdapter';
import { midiPortManager } from '../../MidiPortManager';

vi.mock('../../MidiPortManager', () => ({
  midiPortManager: {
    selectOutput: vi.fn(),
    send: vi.fn(() => true),
    sendImmediate: vi.fn(() => true),
    getOutputs: vi.fn(() => [{ id: 'out1', name: 'Loopback' }]),
  },
}));

class FakeWorkletNode {
  port = {
    postMessage: vi.fn(),
    onmessage: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}

describe('MasterClockAdapter', () => {
  let originalWorklet: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    originalWorklet = window.AudioWorkletNode;
    (window as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = FakeWorkletNode;
    vi.stubGlobal('performance', { now: () => 1000 });
  });

  afterEach(() => {
    (window as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode = originalWorklet;
    vi.unstubAllGlobals();
  });

  it('sends Start on start and schedules clock pulses', async () => {
    const ctx = {
      currentTime: 1,
      state: 'running',
      destination: {},
      audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
      resume: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioContext;

    const master = new MasterClockAdapter(ctx, 120, 0, 32, 'out1');
    master.start();

    await new Promise((r) => setTimeout(r, 50));

    expect(midiPortManager.sendImmediate).toHaveBeenCalledWith(0xfa);
    expect(midiPortManager.send).toHaveBeenCalled();
    master.stop();
    expect(midiPortManager.sendImmediate).toHaveBeenCalledWith(0xfc);
    master.dispose();
  });
});

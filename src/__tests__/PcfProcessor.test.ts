// src/__tests__/PcfProcessor.test.ts
//
// Unit tests for PcfProcessor — covers:
//   • Registration under correct name
//   • Bypass when disabled (pass-through)
//   • Filter application when enabled
//   • Pattern-driven modulation triggers on step advance
//   • Parameter messages update internal state
//   • Automation override drives cutoff directly

import { describe, it, expect, vi, beforeAll } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal AudioWorklet global stubs
// ---------------------------------------------------------------------------

class StubMessagePort {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  start = vi.fn();
  close = vi.fn();

  dispatchMessage(data: unknown) {
    if (this.onmessage) {
      this.onmessage({ data } as MessageEvent);
    }
  }
}

class StubAudioWorkletProcessor {
  readonly port: StubMessagePort;
  constructor() {
    this.port = new StubMessagePort();
  }
  process(_inputs: Float32Array[][], _outputs: Float32Array[][], _params: Record<string, Float32Array>): boolean {
    return true;
  }
}

(globalThis as Record<string, unknown>).AudioWorkletProcessor = StubAudioWorkletProcessor;
(globalThis as Record<string, unknown>).sampleRate = 44100;

const registeredProcessors: Map<string, new () => StubAudioWorkletProcessor> = new Map();
(globalThis as Record<string, unknown>).registerProcessor = (
  name: string,
  ctor: new () => StubAudioWorkletProcessor
) => {
  registeredProcessors.set(name, ctor);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStereoInput(len: number, val = 1.0): Float32Array[][] {
  const L = new Float32Array(len).fill(val);
  const R = new Float32Array(len).fill(val);
  return [[L, R]];
}

function makeStereoOutput(len: number): Float32Array[][] {
  return [[new Float32Array(len), new Float32Array(len)]];
}

function getProcessor(): any {
  const Ctor = registeredProcessors.get('pcf-processor');
  if (!Ctor) throw new Error('pcf-processor not registered');
  return new Ctor();
}

// ---------------------------------------------------------------------------
// Import the processor (triggers registration)
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await import('../audio-worklets/pcf-processor');
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PcfProcessor', () => {
  it('registers as "pcf-processor"', () => {
    expect(registeredProcessors.has('pcf-processor')).toBe(true);
  });

  describe('bypass mode (disabled)', () => {
    it('passes audio through unchanged when disabled', () => {
      const proc = getProcessor();
      // Disable the processor
      proc.port.dispatchMessage({ type: 'set-enabled', data: false });

      const blockSize = 128;
      const input = makeStereoInput(blockSize, 0.5);
      const output = makeStereoOutput(blockSize);

      proc.process(input, output, {});

      // Output should exactly match input
      for (let i = 0; i < blockSize; i++) {
        expect(output[0][0][i]).toBeCloseTo(0.5, 5);
        expect(output[0][1][i]).toBeCloseTo(0.5, 5);
      }
    });
  });

  describe('filter application (enabled)', () => {
    it('modifies audio when enabled with default settings', () => {
      const proc = getProcessor();
      // Enable with a lowpass filter
      proc.port.dispatchMessage({ type: 'set-enabled', data: true });
      proc.port.dispatchMessage({
        type: 'set-params',
        data: { filterType: 0, cutoff: 40, resonance: 60, envAmount: 0, decay: 40 }
      });

      const blockSize = 128;
      // Use a mix of frequencies (impulse response)
      const impulse = new Float32Array(blockSize);
      impulse[0] = 1.0;
      const input: Float32Array[][] = [[impulse, new Float32Array(blockSize)]];
      const output = makeStereoOutput(blockSize);

      proc.process(input, output, {});

      // With envAmount=0 and pattern all zeros, cutoff is just baseCutoff.
      // A lowpass filter at cutoff=40 (~300Hz) should spread the impulse.
      // The first sample should NOT be 1.0 (filtered), and later samples should be non-zero.
      expect(output[0][0][0]).not.toBe(0);
      // Energy should be spread: at least some later samples non-zero
      let hasLaterEnergy = false;
      for (let i = 1; i < blockSize; i++) {
        if (Math.abs(output[0][0][i]) > 1e-6) {
          hasLaterEnergy = true;
          break;
        }
      }
      expect(hasLaterEnergy).toBe(true);
    });

    it('applies different filter types', () => {
      // Highpass should attenuate DC-like signals
      const proc = getProcessor();
      proc.port.dispatchMessage({ type: 'set-enabled', data: true });
      proc.port.dispatchMessage({
        type: 'set-params',
        data: { filterType: 2, cutoff: 100, resonance: 20, envAmount: 0, decay: 40 }
      });

      const blockSize = 256;
      // Constant DC signal
      const input = makeStereoInput(blockSize, 1.0);
      const output = makeStereoOutput(blockSize);

      // Process multiple blocks for filter to settle
      for (let b = 0; b < 10; b++) {
        proc.process(input, output, {});
      }

      // After settling, HP filter should attenuate DC towards 0
      const lastSample = output[0][0][blockSize - 1];
      expect(Math.abs(lastSample)).toBeLessThan(0.1);
    });
  });

  describe('pattern modulation', () => {
    it('triggers envelope on step advance', () => {
      const proc = getProcessor();
      proc.port.dispatchMessage({ type: 'set-enabled', data: true });
      proc.port.dispatchMessage({
        type: 'set-params',
        data: { filterType: 0, cutoff: 30, resonance: 40, envAmount: 127, decay: 80 }
      });
      // Set pattern with high value on step 0
      proc.port.dispatchMessage({
        type: 'set-pattern',
        data: [127, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      });
      // Set transport: playing at 120 BPM, starting at step 0
      proc.port.dispatchMessage({
        type: 'set-transport',
        data: { playing: true, bpm: 120, stepIndex: 0 }
      });

      const blockSize = 128;
      const input = makeStereoInput(blockSize, 0.5);
      const output1 = makeStereoOutput(blockSize);

      // Process first block — step 0 triggered with high envelope
      proc.process(input, output1, {});

      // The filter cutoff should be higher due to modulation
      // We can't easily check cutoff directly, but the output should differ from 
      // a version with envAmount=0
      const proc2 = getProcessor();
      proc2.port.dispatchMessage({ type: 'set-enabled', data: true });
      proc2.port.dispatchMessage({
        type: 'set-params',
        data: { filterType: 0, cutoff: 30, resonance: 40, envAmount: 0, decay: 80 }
      });
      proc2.port.dispatchMessage({
        type: 'set-transport',
        data: { playing: true, bpm: 120, stepIndex: 0 }
      });

      const output2 = makeStereoOutput(blockSize);
      proc2.process(makeStereoInput(blockSize, 0.5), output2, {});

      // The modulated version should differ from the non-modulated one
      let differs = false;
      for (let i = 0; i < blockSize; i++) {
        if (Math.abs(output1[0][0][i] - output2[0][0][i]) > 1e-6) {
          differs = true;
          break;
        }
      }
      expect(differs).toBe(true);
    });
  });

  describe('parameter messages', () => {
    it('accepts set-params message without error', () => {
      const proc = getProcessor();
      expect(() => {
        proc.port.dispatchMessage({
          type: 'set-params',
          data: { filterType: 1, cutoff: 100, resonance: 80, envAmount: 50, decay: 60 }
        });
      }).not.toThrow();
    });

    it('clamps out-of-range values', () => {
      const proc = getProcessor();
      // Should not throw with extreme values
      expect(() => {
        proc.port.dispatchMessage({
          type: 'set-params',
          data: { cutoff: 200, resonance: -10 }
        });
      }).not.toThrow();
    });

    it('accepts pattern with varying lengths', () => {
      const proc = getProcessor();
      expect(() => {
        proc.port.dispatchMessage({ type: 'set-pattern', data: [64, 64, 64, 64] });
      }).not.toThrow();
      expect(() => {
        proc.port.dispatchMessage({ type: 'set-pattern', data: new Array(32).fill(80) });
      }).not.toThrow();
    });
  });

  describe('automation override', () => {
    it('uses automation cutoff when set', () => {
      const proc = getProcessor();
      proc.port.dispatchMessage({ type: 'set-enabled', data: true });
      proc.port.dispatchMessage({
        type: 'set-params',
        data: { filterType: 0, cutoff: 20, resonance: 40, envAmount: 0, decay: 40 }
      });

      const blockSize = 128;
      const impulse = new Float32Array(blockSize);
      impulse[0] = 1.0;

      // Process without automation (low cutoff)
      const output1 = makeStereoOutput(blockSize);
      proc.process([[impulse, new Float32Array(blockSize)]], output1, {});

      // Now set automation to high cutoff
      const proc2 = getProcessor();
      proc2.port.dispatchMessage({ type: 'set-enabled', data: true });
      proc2.port.dispatchMessage({
        type: 'set-params',
        data: { filterType: 0, cutoff: 20, resonance: 40, envAmount: 0, decay: 40 }
      });
      proc2.port.dispatchMessage({ type: 'set-automation', data: { cutoffHz: 15000 } });

      const impulse2 = new Float32Array(blockSize);
      impulse2[0] = 1.0;
      const output2 = makeStereoOutput(blockSize);
      proc2.process([[impulse2, new Float32Array(blockSize)]], output2, {});

      // With automation at 15kHz, the impulse should pass through more intact
      // The first sample should be larger with higher cutoff
      expect(Math.abs(output2[0][0][0])).toBeGreaterThan(Math.abs(output1[0][0][0]) * 0.5);
    });
  });

  describe('process() return value', () => {
    it('always returns true (keep-alive)', () => {
      const proc = getProcessor();
      const result = proc.process(makeStereoInput(128), makeStereoOutput(128), {});
      expect(result).toBe(true);
    });

    it('returns true even with empty inputs', () => {
      const proc = getProcessor();
      const result = proc.process([[]], [[new Float32Array(128)]], {});
      expect(result).toBe(true);
    });
  });
});

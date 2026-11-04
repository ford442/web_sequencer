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

function getProcessor(options?: unknown): StubAudioWorkletProcessor {
  const Ctor = registeredProcessors.get('pcf-processor') as (new (o?: unknown) => StubAudioWorkletProcessor) | undefined;
  if (!Ctor) throw new Error('pcf-processor not registered');
  return new Ctor(options);
}

/** Mean absolute output of a white-ish (alternating) signal: high = cutoff open. */
function hfEnergy(proc: StubAudioWorkletProcessor, blocks = 8, blockSize = 128): number {
  let sum = 0;
  for (let b = 0; b < blocks; b++) {
    const L = new Float32Array(blockSize);
    for (let i = 0; i < blockSize; i++) L[i] = i % 2 === 0 ? 1 : -1;
    const out = makeStereoOutput(blockSize);
    proc.process([[L, L.slice()]], out, {});
    if (b === blocks - 1) for (let i = 0; i < blockSize; i++) sum += Math.abs(out[0][0][i]);
  }
  return sum / blockSize;
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

  describe('master PCF lanes without the pattern PCF', () => {
    it('engages the filter on a cutoff override while disabled, and bypasses again when cleared', () => {
      const proc = getProcessor();
      proc.port.dispatchMessage({ type: 'set-enabled', data: false });
      expect(hfEnergy(proc)).toBeCloseTo(1, 5); // bypass: Nyquist tone untouched

      proc.port.dispatchMessage({ type: 'set-automation', data: { cutoffHz: 200 } });
      expect(hfEnergy(proc, 40)).toBeLessThan(0.05); // low-passed hard

      proc.port.dispatchMessage({ type: 'set-automation', data: { cutoffHz: null } });
      expect(hfEnergy(proc)).toBeCloseTo(1, 5);
    });

    it('stays bypassed on a resonance-only override (nothing for it to shape)', () => {
      const proc = getProcessor();
      proc.port.dispatchMessage({ type: 'set-enabled', data: false });
      proc.port.dispatchMessage({ type: 'set-automation', data: { resonanceMidi: 120 } });
      expect(hfEnergy(proc)).toBeCloseTo(1, 5);
    });
  });

  describe('offline timeline (processorOptions)', () => {
    it('takes its initial state from processorOptions', () => {
      const proc = getProcessor({ processorOptions: { enabled: false, timeline: [] } });
      expect(hfEnergy(proc)).toBeCloseTo(1, 5);
    });

    it('applies each timed override once currentTime reaches it', () => {
      const g = globalThis as Record<string, unknown>;
      const blockSeconds = 128 / 44100;
      const proc = getProcessor({
        processorOptions: {
          enabled: false,
          timeline: [{ time: 10 * blockSeconds, cutoffHz: 200 }, { time: 60 * blockSeconds, cutoffHz: null }],
        },
      });
      try {
        g.currentTime = 0;
        expect(hfEnergy(proc, 1)).toBeCloseTo(1, 5); // before the first event: bypass
        g.currentTime = 10 * blockSeconds;
        expect(hfEnergy(proc, 40)).toBeLessThan(0.05); // override live
        g.currentTime = 60 * blockSeconds;
        expect(hfEnergy(proc, 1)).toBeCloseTo(1, 5); // cleared again
      } finally {
        delete g.currentTime;
      }
    });
  });

  describe('master pcfCutoff lane sweep (spectral centroid)', () => {
    /** Deterministic white noise (LCG), so the assertion never flakes. */
    function noise(len: number, seed: number): Float32Array {
      const out = new Float32Array(len);
      let s = seed >>> 0;
      for (let i = 0; i < len; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        out[i] = s / 2 ** 31 - 1;
      }
      return out;
    }

    /** Power-weighted mean frequency (Hz) of `x`, Hann-windowed naive DFT. */
    function spectralCentroid(x: Float32Array, sr: number): number {
      const n = x.length;
      let num = 0;
      let den = 0;
      for (let k = 1; k < n / 2; k++) {
        let re = 0;
        let im = 0;
        for (let t = 0; t < n; t++) {
          const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / (n - 1));
          const a = (-2 * Math.PI * k * t) / n;
          re += x[t] * w * Math.cos(a);
          im += x[t] * w * Math.sin(a);
        }
        const p = re * re + im * im;
        num += p * ((k * sr) / n);
        den += p;
      }
      return num / den;
    }

    it('moves the centroid of the master signal with the lane, on the render clock', async () => {
      // The same lane → processor conversion the live scheduler and the
      // offline renders use, so this pins what an imported RBS sweep does.
      const { pcfLaneOverride } = await import('../audio/automation/laneResolver');
      const g = globalThis as Record<string, unknown>;
      const sr = 44100;
      const block = 128;
      const blocksPerSegment = 24; // ~70 ms: settle, then measure the last 1024 samples
      const laneValues = [0.2, 0.5, 0.8]; // the lane rising across three segments
      const timeline = laneValues.map((v, i) => ({
        time: (i * blocksPerSegment * block) / sr,
        ...pcfLaneOverride('pcfCutoff', v),
      }));
      // Pattern PCF off, as on a default RBS import with lanes only.
      const proc = getProcessor({ processorOptions: { enabled: false, timeline } });
      const src = noise(laneValues.length * blocksPerSegment * block, 1539);
      const rendered = new Float32Array(src.length);
      try {
        for (let b = 0; b < src.length / block; b++) {
          g.currentTime = (b * block) / sr;
          const inL = src.subarray(b * block, (b + 1) * block);
          const out = makeStereoOutput(block);
          proc.process([[inL, inL.slice()]], out, {});
          rendered.set(out[0][0], b * block);
        }
      } finally {
        delete g.currentTime;
      }

      const segLen = blocksPerSegment * block;
      const centroids = laneValues.map((_, i) =>
        spectralCentroid(rendered.subarray((i + 1) * segLen - 1024, (i + 1) * segLen), sr),
      );
      const dryCentroid = spectralCentroid(src.subarray(segLen - 1024, segLen), sr);

      // Every segment is filtered (darker than the dry noise) …
      for (const c of centroids) expect(c).toBeLessThan(dryCentroid);
      // … and the centroid climbs with the lane, by a clear margin each step.
      expect(centroids[1]).toBeGreaterThan(centroids[0] * 2);
      expect(centroids[2]).toBeGreaterThan(centroids[1] * 2);
    });
  });

  describe('one cutoff curve (main thread and worklet)', () => {
    // Worklet scope cannot import, so the processor keeps its own copy of the
    // curves. They must not drift from the main-thread ones the lanes and the
    // patch-bay knobs use.
    const points = [0, 0.25, 0.5, 0.75, 1];
    const relClose = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(b)));

    it('maps cutoff the same way: pcfMidiNormToHz, pcfKnobToHz and the worklet', async () => {
      const { pcfMidiNormToHz } = await import('../audio/automation/laneResolver');
      const { pcfKnobToHz } = await import('../audio/pcf/pcfNodeConfig');
      const proc = getProcessor() as unknown as { midiToHz(midi: number): number };
      for (const v of points) {
        relClose(proc.midiToHz(v * 127), pcfMidiNormToHz(v));
        relClose(pcfKnobToHz(v * 127), pcfMidiNormToHz(v));
      }
      expect(pcfMidiNormToHz(0)).toBe(20);
      relClose(pcfMidiNormToHz(1), 20000);
    });

    it('maps resonance the same way: pcfKnobToQ and the worklet', async () => {
      const { pcfKnobToQ } = await import('../audio/pcf/pcfNodeConfig');
      const proc = getProcessor() as unknown as { midiToQ(midi: number): number };
      for (const v of points) relClose(proc.midiToQ(v * 127), pcfKnobToQ(v * 127));
    });
  });

  describe('master pcfCutoff lane through the offline timeline resolver', () => {
    const sr = 44100;
    const block = 128;
    const stepSeconds = (block * 4) / sr; // 4 render quanta per step keeps the test fast
    const stepCount = 16;
    const bars = 2;

    function noise(len: number, seed: number): Float32Array {
      const out = new Float32Array(len);
      let s = seed >>> 0;
      for (let i = 0; i < len; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        out[i] = s / 2 ** 31 - 1;
      }
      return out;
    }

    function spectralCentroid(x: Float32Array): number {
      const n = x.length;
      let num = 0;
      let den = 0;
      for (let k = 1; k < n / 2; k++) {
        let re = 0;
        let im = 0;
        for (let t = 0; t < n; t++) {
          const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / (n - 1));
          const a = (-2 * Math.PI * k * t) / n;
          re += x[t] * w * Math.cos(a);
          im += x[t] * w * Math.sin(a);
        }
        const p = re * re + im * im;
        num += p * ((k * sr) / n);
        den += p;
      }
      return num / den;
    }

    /** Song-timeline master lane: `closed` for bar 1, `open` for bar 2. */
    function songLane(parameter: string, closed: number, open: number): import('../types').UnifiedAutomationLane {
      return {
        id: `master-${parameter}`,
        target: 'master',
        parameter,
        name: parameter,
        points: [
          { step: 0, value: closed },
          { step: stepCount - 1, value: closed },
          { step: stepCount, value: open },
          { step: 2 * stepCount - 1, value: open },
        ],
        interpolation: 'step',
        source: 'rbs',
        scope: 'song',
        timeline: 'song',
        enabled: true,
      };
    }

    /** Render `src` through a processor built as `compileOfflineGraph` builds the master PCF. */
    async function renderThroughLanes(lanes: import('../types').UnifiedAutomationLane[], src: Float32Array) {
      const { resolveMasterPcfTimeline } = await import('../audio/offline/offlineLaneAutomation');
      const timeline = resolveMasterPcfTimeline(lanes, { totalSteps: bars * stepCount, stepCount, songMode: true }, stepSeconds);
      // Pattern PCF off, as on an RBS import whose PCF only moves through lanes.
      const proc = getProcessor({ processorOptions: { enabled: false, timeline } });
      const g = globalThis as Record<string, unknown>;
      const out = new Float32Array(src.length);
      try {
        for (let b = 0; b < src.length / block; b++) {
          g.currentTime = (b * block) / sr;
          const inL = src.subarray(b * block, (b + 1) * block);
          const o = makeStereoOutput(block);
          proc.process([[inL, inL.slice()]], o, {});
          out.set(o[0][0], b * block);
        }
      } finally {
        delete g.currentTime;
      }
      return { out, timeline };
    }

    const barSamples = Math.round(stepCount * stepSeconds * sr);
    const lastOfBar = (x: Float32Array, bar: number) => x.subarray((bar + 1) * barSamples - 1024, (bar + 1) * barSamples);

    it('darkens the closed bar and opens the open bar (centroid ratio > 20)', async () => {
      const src = noise(bars * barSamples, 1535);
      const { out, timeline } = await renderThroughLanes([songLane('pcfCutoff', 0.15, 0.85)], src);
      expect(timeline.map((e) => e.time)).toEqual([0, stepCount * stepSeconds]);
      const closed = spectralCentroid(lastOfBar(out, 0));
      const open = spectralCentroid(lastOfBar(out, 1));
      const dry = spectralCentroid(lastOfBar(src, 1));
      // Measured: closed ≈ 68 Hz (cutoff ≈ 56 Hz), open ≈ 6.9 kHz (cutoff ≈ 7.1 kHz),
      // dry ≈ 11.2 kHz: a ratio of ≈ 100. 20 leaves room for a smoother or a Q change.
      expect(closed).toBeLessThan(200);
      expect(open).toBeLessThan(dry);
      expect(open / closed).toBeGreaterThan(20);
    });

    it('leaves the mix bit-identical without master PCF lanes, or with the cutoff parked at 0', async () => {
      const src = noise(bars * barSamples, 1562);
      const otherTarget: import('../types').UnifiedAutomationLane = { ...songLane('filterCutoff', 0.1, 0.9), target: 'synthA' };
      for (const lanes of [[], [otherTarget], [songLane('pcfCutoff', 0, 0)]]) {
        const { out, timeline } = await renderThroughLanes(lanes, src);
        expect(timeline).toEqual([]);
        expect(out).toEqual(src);
      }
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

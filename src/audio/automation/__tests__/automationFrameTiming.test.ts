/**
 * Worklet-param automation on the frame clock (#1497 follow-up P1).
 *
 * The whole live path for a master `pcfCutoff` lane: AutomationScheduler →
 * PcfEffect → its EventBus route (batched records, as on a page without
 * shared memory) → the real pcf-processor, rendered block by block. The
 * rendering is the way an OfflineAudioContext runs: the scheduler sends the
 * window ahead, then the blocks render with no wall clock in between.
 *
 * It used to go through `setTimeout(delayMs)` and a `set-automation` port
 * message, which lands on whatever block renders when the timer fires: in an
 * offline render the timer has not fired by the time the step renders (the
 * render outruns the main thread), and live it fires the lookahead early
 * against an output clock it does not know. The record carries its frame.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AutomationScheduler } from '../AutomationScheduler';
import { PcfEffect } from '../../../engines/PcfEffect';
import { engineEventBus } from '../../controlPlane/EventBus';
import type { UnifiedAutomationLane } from '../../../types';

const SAMPLE_RATE = 44100;
const QUANTUM = 128;

// ── An AudioWorkletGlobalScope just big enough for pcf-processor ─────────────

class WorkletPort {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  postMessage(): void {}
}

interface Processor {
  readonly port: WorkletPort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean;
}

type ProcessorCtor = new (options?: unknown) => Processor;
const registered = new Map<string, ProcessorCtor>();
const g = globalThis as Record<string, unknown>;

beforeAll(async () => {
  g.AudioWorkletProcessor = class {
    readonly port = new WorkletPort();
  };
  g.registerProcessor = (name: string, ctor: ProcessorCtor) => registered.set(name, ctor);
  g.sampleRate = SAMPLE_RATE;
  await import('../../../audio-worklets/pcf-processor');
});

/** The processor behind the one AudioWorkletNode PcfEffect makes. */
let processor: Processor | null = null;

function stubWorkletNode(): void {
  processor = null;
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      readonly port: { postMessage(message: unknown): void };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor(_context: unknown, name: string, options: unknown) {
        const proc = new (registered.get(name)!)(options);
        processor = proc;
        // Port messages reach the processor in order, as structured clones would.
        this.port = { postMessage: (data: unknown) => proc.port.onmessage?.({ data } as MessageEvent) };
      }
    },
  );
}

function fakeContext(): AudioContext & { currentTime: number } {
  const gain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() });
  return {
    currentTime: 0,
    sampleRate: SAMPLE_RATE,
    createGain: gain,
    audioWorklet: { addModule: () => Promise.resolve() },
  } as unknown as AudioContext & { currentTime: number };
}

/** Render `frames` of a Nyquist-rate square and return the first frame the PCF changed. */
function firstFilteredFrame(proc: Processor, frames: number): number {
  for (let start = 0; start < frames; start += QUANTUM) {
    const input = new Float32Array(QUANTUM);
    for (let i = 0; i < QUANTUM; i++) input[i] = (start + i) % 2 === 0 ? 0.5 : -0.5;
    const out = [[new Float32Array(QUANTUM), new Float32Array(QUANTUM)]];
    proc.process([[input, input.slice()]], out, {});
    for (let i = 0; i < QUANTUM; i++) if (out[0][0][i] !== input[i]) return start + i;
  }
  return -1;
}

function cutoffLane(points: UnifiedAutomationLane['points']): UnifiedAutomationLane {
  return {
    id: 'pcf-cutoff',
    target: 'master',
    parameter: 'pcfCutoff',
    name: 'PCF cutoff',
    points,
    interpolation: 'step',
    source: 'recorded',
    scope: 'pattern',
    patternIndex: 0,
    enabled: true,
  } as UnifiedAutomationLane;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('worklet-param automation lands on its frame (#1497 follow-up P1)', () => {
  it('a PCF cutoff point at step 4 lands within one render quantum of step 4’s frame', async () => {
    vi.useFakeTimers();
    stubWorkletNode();
    const ctx = fakeContext();
    const pcf = new PcfEffect(ctx);
    await pcf.init(); // pattern PCF off: the master insert is transparent until a lane engages it
    const scheduler = new AutomationScheduler(ctx);
    scheduler.setPcfEffect(pcf);

    // 120 BPM sixteenths. The step handler sends step 4 when it enters the
    // lookahead window, well before the render reaches it.
    const stepTime = 60 / 120 / 4;
    const step4 = 4 * stepTime;
    scheduler.scheduleFromLanes([cutoffLane([{ step: 4, value: 0.6 }])], 4, 1, stepTime, step4);
    engineEventBus.flushAll(); // the bus's microtask flush, run now

    const expected = Math.round(step4 * SAMPLE_RATE);
    const landed = firstFilteredFrame(processor!, expected + 8 * QUANTUM);
    expect(landed).toBeGreaterThanOrEqual(0);
    expect(Math.abs(landed - expected)).toBeLessThan(QUANTUM);
    // The block is split on the record's frame: it is exact, not just within a quantum.
    expect(landed).toBe(expected);
    // And nothing waited on a main-thread timer to get there.
    expect(vi.getTimerCount()).toBe(0);

    pcf.dispose();
  });

  it('a transport stop drops the values the lookahead sent for steps that will not play', async () => {
    stubWorkletNode();
    const ctx = fakeContext();
    const pcf = new PcfEffect(ctx);
    await pcf.init();
    const scheduler = new AutomationScheduler(ctx);
    scheduler.setPcfEffect(pcf);

    const stepTime = 60 / 120 / 4;
    scheduler.scheduleFromLanes([cutoffLane([{ step: 4, value: 0.6 }])], 4, 1, stepTime, 4 * stepTime);
    scheduler.cancelAll();
    engineEventBus.flushAll();

    expect(firstFilteredFrame(processor!, Math.round(8 * stepTime * SAMPLE_RATE))).toBe(-1);
    pcf.dispose();
  });
});

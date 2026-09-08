import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logEngineFallback } = vi.hoisted(() => ({ logEngineFallback: vi.fn() }));

vi.mock('../../utils/engineTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/engineTelemetry')>();
  return { ...actual, logEngineFallback };
});

import { Open303Oscillator } from '../Open303Oscillator';
import { FallbackBassSynth } from '../FallbackBassSynth';

/**
 * Readiness contract for the 303 voice.
 *
 * `Open303Oscillator.isReady` only flips true once the worklet reports ready OR
 * the JS fallback is activated — and the fallback is only reached after the
 * worklet init has failed (up to a multi-second timeout). Any note the sequencer
 * fires in that window used to hit `if (!this.isReady) return;` and vanish with
 * no queue, no error and no telemetry: the playhead advanced, the step handler
 * dispatched, and the note was simply gone.
 *
 * A trigger arriving before the engine is up must therefore be either QUEUED and
 * delivered once the engine is up, or REFUSED visibly. Never dropped in silence.
 */

/** Minimal AudioContext with no `audioWorklet`, so init() takes the fallback path. */
function makeContext(): AudioContext {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  return {
    currentTime: 0,
    sampleRate: 48000,
    createGain: vi.fn(() => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() })),
    createBiquadFilter: vi.fn(() => ({
      type: 'lowpass', frequency: param(), Q: param(), gain: param(),
      connect: vi.fn(), disconnect: vi.fn(),
    })),
    createOscillator: vi.fn(() => ({
      type: 'sawtooth', frequency: param(),
      start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
    })),
    destination: {},
  } as unknown as AudioContext;
}

describe('Open303Oscillator readiness contract', () => {
  beforeEach(() => {
    logEngineFallback.mockClear();
  });

  it('does not silently swallow a note fired before the engine is ready', async () => {
    const noteOnSpy = vi.spyOn(FallbackBassSynth.prototype, 'noteOn');
    const osc = new Open303Oscillator();
    expect(osc.isReady).toBe(false);

    // The sequencer fires while the engine is still coming up.
    osc.noteOn(60, 100);

    // Engine finishes coming up (no audioWorklet → JS fallback path).
    await osc.init(makeContext());
    expect(osc.isReady).toBe(true);

    // The note must have been delivered, not dropped.
    const delivered = noteOnSpy.mock.calls.some(([note]) => note === 60);
    const refusedVisibly = logEngineFallback.mock.calls.some(([, , reason]) =>
      typeof reason === 'string' && /note|trigger/i.test(reason),
    );

    expect(
      delivered || refusedVisibly,
      'note fired before isReady was neither queued-and-delivered nor visibly refused',
    ).toBe(true);
    expect(delivered).toBe(true);

    noteOnSpy.mockRestore();
  });

  it('surfaces an explicit refusal rather than dropping when the queue overflows', async () => {
    const osc = new Open303Oscillator();

    // Far more pre-ready notes than any sane queue bound.
    for (let i = 0; i < 512; i++) osc.noteOn(48 + (i % 12), 100);

    const refusal = logEngineFallback.mock.calls.some(([, , reason]) =>
      typeof reason === 'string' && /queue|overflow|dropp/i.test(reason),
    );
    expect(refusal, 'overflowing the pre-ready note queue must be reported, not silent').toBe(true);

    await osc.init(makeContext());
  });
});

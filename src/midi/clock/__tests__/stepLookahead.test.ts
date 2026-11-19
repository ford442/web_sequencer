import { describe, it, expect, vi, afterEach } from 'vitest';
import { deriveStepLookaheadMs } from '../stepLookahead';
import { InternalClockAdapter } from '../InternalClockAdapter';
import { STEP_LOOKAHEAD_MARGIN_MS, STEP_LOOKAHEAD_MAX_MS, STEP_LOOKAHEAD_MS } from '../types';

const fake = (baseLatency: number, outputLatency: number, extra: Record<string, unknown> = {}) =>
  ({ sampleRate: 48000, baseLatency, outputLatency, ...extra });

describe('deriveStepLookaheadMs', () => {
  it('goes above the 40 ms floor when the context reports 120 ms of latency', () => {
    const ms = deriveStepLookaheadMs(fake(0.08, 0.04), null);
    expect(ms).toBeGreaterThan(STEP_LOOKAHEAD_MS);
    expect(ms).toBe(Math.min(STEP_LOOKAHEAD_MAX_MS, 120 + STEP_LOOKAHEAD_MARGIN_MS));
  });

  it('stays at the floor, not zero, when latency is near zero', () => {
    expect(deriveStepLookaheadMs(fake(0.001, 0), null)).toBe(STEP_LOOKAHEAD_MS);
    expect(deriveStepLookaheadMs({ sampleRate: 48000 }, null)).toBe(STEP_LOOKAHEAD_MS);
  });

  it('is capped at the ceiling', () => {
    expect(deriveStepLookaheadMs(fake(0.3, 0.3), null)).toBe(STEP_LOOKAHEAD_MAX_MS);
  });

  it('covers one render quantum plus the margin when the quantum is exposed', () => {
    // 4096 frames at 48 kHz ≈ 85.3 ms.
    const ms = deriveStepLookaheadMs(fake(0, 0), 4096);
    expect(ms).toBeCloseTo((4096 / 48000) * 1000 + STEP_LOOKAHEAD_MARGIN_MS, 6);
  });
});

describe('InternalClockAdapter lookahead', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubNodes() {
    const posted: unknown[][] = [];
    vi.stubGlobal('AudioWorkletNode', class {
      port = { onmessage: null, postMessage: vi.fn((m: unknown) => posted[posted.length - 1].push(m)), addEventListener: vi.fn(), removeEventListener: vi.fn() };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() { posted.push([]); }
    });
    return posted;
  }

  const ctxFor = (baseLatency: number, outputLatency: number) => ({
    state: 'running',
    currentTime: 0,
    sampleRate: 48000,
    baseLatency,
    outputLatency,
    resume: vi.fn(),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    destination: {},
  }) as unknown as AudioContext;

  const lookaheadPosted = (msgs: unknown[]) =>
    (msgs.find((m) => (m as { type: string }).type === 'setLookahead') as { lookahead: number }).lookahead;

  it('gives the clock worklet a different lookahead for a different latency mode', async () => {
    const posted = stubNodes();
    // interactive-like context vs playback-like context (the HUD Apply path builds a new one).
    const a = new InternalClockAdapter(ctxFor(0.005, 0.01), 120, 0, 16);
    await a.ensureStarted();
    const b = new InternalClockAdapter(ctxFor(0.08, 0.04), 120, 0, 16);
    await b.ensureStarted();
    expect(lookaheadPosted(posted[0])).toBeCloseTo(STEP_LOOKAHEAD_MS / 1000, 9);
    expect(lookaheadPosted(posted[1])).toBeCloseTo((120 + STEP_LOOKAHEAD_MARGIN_MS) / 1000, 9);
    a.dispose();
    b.dispose();
  });

  it('re-posts setLookahead when outputLatency changes', async () => {
    const posted = stubNodes();
    const ctx = ctxFor(0.005, 0.01) as unknown as { outputLatency: number };
    const a = new InternalClockAdapter(ctx as unknown as AudioContext, 120, 0, 16);
    await a.ensureStarted();
    ctx.outputLatency = 0.1;
    a.refreshLookahead();
    const msgs = posted[0].filter((m) => (m as { type: string }).type === 'setLookahead') as Array<{ lookahead: number }>;
    expect(msgs).toHaveLength(2);
    expect(msgs[1].lookahead).toBeCloseTo((105 + STEP_LOOKAHEAD_MARGIN_MS) / 1000, 9);
    a.dispose();
  });
});

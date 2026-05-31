/**
 * AutomationScheduler.test.ts
 *
 * Unit tests for the AutomationScheduler class and its helper functions.
 *
 * Tests cover:
 *  - resolveTrakDeltas()  — delta-tick → absolute-tick conversion
 *  - normaliseTrakValue() — raw 0–127 → normalised 0–1 mapping
 *  - trakCtrlToTargetParam() (via scheduleFromTrakEvents integration)
 *  - scheduleFromLanes()  — step-indexed lane scheduling
 *  - scheduleFromTrakEvents() — tick-indexed TRAK event scheduling
 *  - cancelAll()          — clears pending setTimeout handles
 *
 * @see Issue #669 — automation foundation
 * @see Issue #671 — RBS TRAK events
 * @see Issue #(this) — AutomationScheduler + Open303 wiring
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AutomationScheduler,
  resolveTrakDeltas,
  normaliseTrakValue,
} from '../audio/automation/AutomationScheduler';
import { automationStore, generateLaneId, resetLaneIdCounter } from '../stores/automationStore';
import type { UnifiedAutomationLane } from '../types';

// ---------------------------------------------------------------------------
// Minimal AudioContext mock
// ---------------------------------------------------------------------------

function makeAudioContext(currentTime = 0): AudioContext {
  return { currentTime } as unknown as AudioContext;
}

// ---------------------------------------------------------------------------
// Minimal Open303Manager mock
// ---------------------------------------------------------------------------

function makeOpen303Manager() {
  return {
    isBass1Ready: vi.fn(() => true),
    isBass2Ready: vi.fn(() => true),
    isLead303Ready: vi.fn(() => true),
    scheduleParamAtTime: vi.fn(),
    scheduleParamRamp: vi.fn(),
    scheduleSlideAtTime: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Lane factory (mirrors automationStore.test.ts style)
// ---------------------------------------------------------------------------

function makeLane(overrides?: Partial<UnifiedAutomationLane>): UnifiedAutomationLane {
  return {
    id: generateLaneId(),
    target: 'synthA',
    parameter: 'filterCutoff',
    name: 'Test Lane',
    points: [{ step: 0, value: 0.5 }],
    interpolation: 'linear',
    source: 'recorded',
    scope: 'pattern',
    patternIndex: 0,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  automationStore.reset();
  resetLaneIdCounter();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helper: resolveTrakDeltas
// ---------------------------------------------------------------------------

describe('resolveTrakDeltas', () => {
  it('converts an empty array to an empty array', () => {
    expect(resolveTrakDeltas([])).toEqual([]);
  });

  it('accumulates delta ticks into absolute ticks', () => {
    const deltas = [
      { deltaTick: 0, ctrlId: 2, value: 64 },
      { deltaTick: 6, ctrlId: 2, value: 80 },
      { deltaTick: 6, ctrlId: 2, value: 100 },
    ];
    const resolved = resolveTrakDeltas(deltas);
    expect(resolved).toEqual([
      { tick: 0, ctrlId: 2, value: 64 },
      { tick: 6, ctrlId: 2, value: 80 },
      { tick: 12, ctrlId: 2, value: 100 },
    ]);
  });

  it('handles a single event at tick 0', () => {
    const resolved = resolveTrakDeltas([{ deltaTick: 0, ctrlId: 5, value: 127 }]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].tick).toBe(0);
  });

  it('preserves ctrlId and value unchanged', () => {
    const resolved = resolveTrakDeltas([{ deltaTick: 24, ctrlId: 0x02, value: 99 }]);
    expect(resolved[0].ctrlId).toBe(0x02);
    expect(resolved[0].value).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Helper: normaliseTrakValue
// ---------------------------------------------------------------------------

describe('normaliseTrakValue', () => {
  const CUTOFF_CTRL = 0x02;  // tb303Acutoff in AUTOMATION_PARAMETER_MAP
  const UNKNOWN_CTRL = 0xff;

  it('maps 0 to 0', () => {
    expect(normaliseTrakValue(CUTOFF_CTRL, 0)).toBe(0);
  });

  it('maps 127 to 1', () => {
    expect(normaliseTrakValue(CUTOFF_CTRL, 127)).toBeCloseTo(1, 5);
  });

  it('maps 64 to approximately 0.5', () => {
    expect(normaliseTrakValue(CUTOFF_CTRL, 64)).toBeCloseTo(64 / 127, 5);
  });

  it('clamps above 127 to 1 for known params', () => {
    expect(normaliseTrakValue(CUTOFF_CTRL, 255)).toBe(1);
  });

  it('applies identity mapping (0–127) for unknown ctrl IDs', () => {
    expect(normaliseTrakValue(UNKNOWN_CTRL, 63)).toBeCloseTo(63 / 127, 5);
  });
});

// ---------------------------------------------------------------------------
// AutomationScheduler: construction
// ---------------------------------------------------------------------------

describe('AutomationScheduler — construction', () => {
  it('constructs without error with no manager', () => {
    const ctx = makeAudioContext();
    expect(() => new AutomationScheduler(ctx)).not.toThrow();
  });

  it('accepts a manager and config', () => {
    const ctx = makeAudioContext();
    const mgr = makeOpen303Manager();
    expect(() =>
      new AutomationScheduler(ctx, mgr as any, { lookaheadSeconds: 0.2, rampDuration: 0.1, ppq: 24 })
    ).not.toThrow();
  });

  it('setOpen303Manager replaces the manager', () => {
    const ctx = makeAudioContext();
    const scheduler = new AutomationScheduler(ctx, null);
    const mgr = makeOpen303Manager();
    expect(() => scheduler.setOpen303Manager(mgr as any)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AutomationScheduler: cancelAll
// ---------------------------------------------------------------------------

describe('AutomationScheduler.cancelAll', () => {
  it('cancels pending timeouts so they do not fire', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    // Make a lane for synthA / filterCutoff — schedule at 0.1s audio time
    const lane = makeLane({ points: [{ step: 0, value: 0.5 }] });
    automationStore.addLane(lane);

    // schedule 1 step ahead of audio time 0.1s (means setTimeout fires ~100ms away)
    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0.1);

    // cancel before timers fire
    scheduler.cancelAll();

    // advance timers — no calls should have been made
    vi.runAllTimers();
    expect(mgr.scheduleParamAtTime).not.toHaveBeenCalled();
  });

  it('can be called multiple times without error', () => {
    const ctx = makeAudioContext();
    const scheduler = new AutomationScheduler(ctx);
    expect(() => {
      scheduler.cancelAll();
      scheduler.cancelAll();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AutomationScheduler: scheduleFromLanes
// ---------------------------------------------------------------------------

describe('AutomationScheduler.scheduleFromLanes', () => {
  it('does nothing when passed an empty lanes array', () => {
    const ctx = makeAudioContext();
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);
    expect(() => scheduler.scheduleFromLanes([], 0, 1, 0.5, 0)).not.toThrow();
    vi.runAllTimers();
    expect(mgr.scheduleParamAtTime).not.toHaveBeenCalled();
  });

  it('does nothing for a disabled lane', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const lane = makeLane({ enabled: false, points: [{ step: 0, value: 0.7 }] });

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();
    expect(mgr.scheduleParamAtTime).not.toHaveBeenCalled();
  });

  it('schedules a synthA cutoff value via setTimeout-based worklet path', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const lane = makeLane({ target: 'synthA', parameter: 'filterCutoff', points: [{ step: 0, value: 0.75 }] });

    // schedule at audio time 0 (immediate) so setTimeout fires at 0 ms delay
    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();
    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith('lead303', 'setCutoff', expect.any(Number), expect.any(Number));
  });

  it('schedules a synthB resonance for the bass1 voice', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const lane = makeLane({ target: 'synthB', parameter: 'filterResonance', points: [{ step: 0, value: 0.4 }] });

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();
    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith('bass1', 'setResonance', expect.any(Number), expect.any(Number));
  });

  it('schedules a bass2 decay for the bass2 voice', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const lane = makeLane({ target: 'bass2', parameter: 'decay', points: [{ step: 0, value: 0.6 }] });

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();
    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith('bass2', 'setDecay', expect.any(Number), expect.any(Number));
  });

  it('uses originalRange to denormalise value before scheduling', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const lane = makeLane({
      target: 'synthA',
      parameter: 'filterCutoff',
      points: [{ step: 0, value: 0.5 }],
      originalRange: [0, 2],
      source: 'rbs',
    });

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();
    // denormalised = 0 + 0.5 * (2 - 0) = 1.0 → clamped to 1.0
    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith('lead303', 'setCutoff', 1, expect.any(Number));
  });

  it('does not schedule when no manager is attached', () => {
    const ctx = makeAudioContext(0);
    const scheduler = new AutomationScheduler(ctx, null);

    const lane = makeLane({ target: 'synthA', parameter: 'filterCutoff', points: [{ step: 0, value: 0.5 }] });

    expect(() => scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0)).not.toThrow();
    vi.runAllTimers();
    // No-op: no manager → no calls
  });

  it('calls scheduleParamAtTime with setAccent for an accent lane', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const lane = makeLane({
      target: 'synthA',
      parameter: 'accent',
      points: [{ step: 0, value: 0.8 }],
    });
    automationStore.addLane(lane);

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();

    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith(
      'lead303', 'setAccent', expect.closeTo(0.8, 3), expect.any(Number)
    );
  });

  it('calls scheduleSlideAtTime with enabled=true when slide lane value >= 0.5', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const lane = makeLane({
      target: 'synthA',
      parameter: 'slide',
      points: [{ step: 0, value: 1.0 }],
    });
    automationStore.addLane(lane);

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();

    expect(mgr.scheduleSlideAtTime).toHaveBeenCalledWith('lead303', true, expect.any(Number));
  });

  it('calls scheduleSlideAtTime with enabled=false when slide lane value < 0.5', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const lane = makeLane({
      target: 'synthA',
      parameter: 'slide',
      points: [{ step: 0, value: 0.0 }],
    });
    automationStore.addLane(lane);

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();

    expect(mgr.scheduleSlideAtTime).toHaveBeenCalledWith('lead303', false, expect.any(Number));
  });
});

// ---------------------------------------------------------------------------
// AutomationScheduler: scheduleFromTrakEvents
// ---------------------------------------------------------------------------

describe('AutomationScheduler.scheduleFromTrakEvents', () => {
  it('does nothing with an empty events array', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);
    expect(() => scheduler.scheduleFromTrakEvents([], 120, 0, 0, 96)).not.toThrow();
    vi.runAllTimers();
    expect(mgr.scheduleParamAtTime).not.toHaveBeenCalled();
  });

  it('skips events outside the fromTick–toTick window', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const CUTOFF_CTRL = 0x02;
    const events = [
      { tick: 0, ctrlId: CUTOFF_CTRL, value: 64 },   // before window
      { tick: 200, ctrlId: CUTOFF_CTRL, value: 100 }, // after window
    ];

    scheduler.scheduleFromTrakEvents(events, 120, 0, 96, 192);
    vi.runAllTimers();
    expect(mgr.scheduleParamAtTime).not.toHaveBeenCalled();
  });

  it('schedules a tb303Acutoff event at the correct audio time', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });

    // tb303Acutoff ctrl ID — matches AUTOMATION_PARAMETER_MAP[0x02]
    const CUTOFF_CTRL = 0x02;
    const tempo = 120; // BPM → tickSeconds = 60 / (120 * 24) ≈ 0.020833 s
    const events = [{ tick: 24, ctrlId: CUTOFF_CTRL, value: 64 }]; // at quarter-note

    // window [0, 96) at baseAudioTime = 0
    scheduler.scheduleFromTrakEvents(events, tempo, 0, 0, 96);
    vi.runAllTimers();

    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith(
      'lead303',
      'setCutoff',
      expect.closeTo(64 / 127, 3),
      expect.any(Number)
    );
  });

  it('schedules a tb303Bcutoff event for bass1 voice', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });

    // tb303Bcutoff ctrl ID — matches AUTOMATION_PARAMETER_MAP
    const CUTOFF_CTRL_B = 0x03;
    const events = [{ tick: 6, ctrlId: CUTOFF_CTRL_B, value: 100 }];

    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith('bass1', 'setCutoff', expect.any(Number), expect.any(Number));
  });

  it('ignores events whose ctrlId has no mapping', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const UNKNOWN_CTRL = 0xff;
    const events = [{ tick: 10, ctrlId: UNKNOWN_CTRL, value: 64 }];

    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();
    expect(mgr.scheduleParamAtTime).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AutomationScheduler: PCF parameter automation
// ---------------------------------------------------------------------------

function makePcfEffect() {
  return {
    setAutomationCutoff: vi.fn(),
    setAutomationResonance: vi.fn(),
    setAutomationEnvAmount: vi.fn(),
  };
}

describe('AutomationScheduler PCF automation via scheduleFromLanes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    automationStore.clearAll?.();
    resetLaneIdCounter();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls setAutomationCutoff on pcfEffect for a master pcfCutoff lane', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any);
    scheduler.setPcfEffect(pcf as any);

    const lane = makeLane({
      target: 'master' as any,
      parameter: 'pcfCutoff',
      points: [{ step: 0, value: 0.5 }],
    });
    automationStore.addLane(lane);

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();

    // value 0.5 → pcfMidiNormToHz(0.5) = 20 * 1000^0.5 ≈ 632 Hz
    expect(pcf.setAutomationCutoff).toHaveBeenCalledWith(expect.any(Number));
    const actualHz = (pcf.setAutomationCutoff as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
    expect(actualHz).toBeCloseTo(20 * Math.pow(1000, 0.5), 1); // ≈ 632 Hz
  });

  it('calls setAutomationResonance on pcfEffect for a master pcfResonance lane', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any);
    scheduler.setPcfEffect(pcf as any);

    const lane = makeLane({
      target: 'master' as any,
      parameter: 'pcfResonance',
      points: [{ step: 0, value: 1.0 }],
    });
    automationStore.addLane(lane);

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();

    expect(pcf.setAutomationResonance).toHaveBeenCalledWith(
      expect.closeTo(127, 1)
    );
  });

  it('calls setAutomationEnvAmount on pcfEffect for a master pcfEnvAmount lane', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any);
    scheduler.setPcfEffect(pcf as any);

    const lane = makeLane({
      target: 'master' as any,
      parameter: 'pcfEnvAmount',
      points: [{ step: 0, value: 0.75 }],
    });
    automationStore.addLane(lane);

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();

    expect(pcf.setAutomationEnvAmount).toHaveBeenCalledWith(
      expect.closeTo(0.75, 3)
    );
  });

  it('does not call PCF methods when no pcfEffect is attached', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any);
    // intentionally NOT calling setPcfEffect

    const lane = makeLane({
      target: 'master' as any,
      parameter: 'pcfCutoff',
      points: [{ step: 0, value: 0.5 }],
    });
    automationStore.addLane(lane);

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    vi.runAllTimers();

    expect(pcf.setAutomationCutoff).not.toHaveBeenCalled();
  });
});

describe('AutomationScheduler PCF automation via scheduleFromTrakEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    automationStore.clearAll?.();
    resetLaneIdCounter();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes pcfCutoff TRAK event (0x04) to setAutomationCutoff', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });
    scheduler.setPcfEffect(pcf as any);

    // ctrl ID 0x04 = pcfCutoff
    const events = [{ tick: 24, ctrlId: 0x04, value: 64 }];
    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    // ctrl=0x04 value=64 → norm=64/127 → pcfMidiNormToHz(64/127) ≈ 635 Hz
    expect(pcf.setAutomationCutoff).toHaveBeenCalledWith(expect.any(Number));
    const actualHz = (pcf.setAutomationCutoff as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
    expect(actualHz).toBeCloseTo(20 * Math.pow(1000, 64 / 127), 1);
  });

  it('routes pcfResonance TRAK event (0x0A) to setAutomationResonance', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });
    scheduler.setPcfEffect(pcf as any);

    // ctrl ID 0x0A = pcfResonance
    const events = [{ tick: 12, ctrlId: 0x0A, value: 100 }];
    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    // 100/127 normalised → 100/127 * 127 = 100
    expect(pcf.setAutomationResonance).toHaveBeenCalledWith(expect.closeTo(100, 0));
  });

  it('routes pcfEnvAmount TRAK event (0x0B) to setAutomationEnvAmount', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });
    scheduler.setPcfEffect(pcf as any);

    // ctrl ID 0x0B = pcfEnvAmount
    const events = [{ tick: 6, ctrlId: 0x0B, value: 64 }];
    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    expect(pcf.setAutomationEnvAmount).toHaveBeenCalledWith(expect.closeTo(64 / 127, 3));
  });

  it('does not call PCF methods when pcfEffect is null', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });
    scheduler.setPcfEffect(null); // explicitly null

    const events = [{ tick: 6, ctrlId: 0x04, value: 64 }];
    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    expect(pcf.setAutomationCutoff).not.toHaveBeenCalled();
  });

  it('does not break 303 scheduling when PCF events are present alongside 303 events', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });
    scheduler.setPcfEffect(pcf as any);

    const events = [
      { tick: 6,  ctrlId: 0x02, value: 80 },  // tb303Acutoff
      { tick: 12, ctrlId: 0x04, value: 64 },  // pcfCutoff
    ];
    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith(
      'lead303', 'setCutoff', expect.any(Number), expect.any(Number)
    );
    expect(pcf.setAutomationCutoff).toHaveBeenCalledOnce();
  });
});

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
import {
  TB303_TRAK_CONTROLLER,
  PCF_TRAK_CONTROLLER,
} from '../importers/rbs/trakControllers';
import { TRAK_TRACK_INDEX } from '../importers/rbs/types';

const TB303_1 = TRAK_TRACK_INDEX.TB303_1;
const TB303_2 = TRAK_TRACK_INDEX.TB303_2;
const PCF_TRACK = TRAK_TRACK_INDEX.PCF;
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

function makePcfEffect() {
  return {
    setAutomationCutoff: vi.fn(),
    setAutomationResonance: vi.fn(),
    setAutomationEnvAmount: vi.fn(),
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
      { deltaTick: 0, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 64 },
      { deltaTick: 6, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 80 },
      { deltaTick: 6, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 100 },
    ];
    const resolved = resolveTrakDeltas(deltas);
    expect(resolved).toEqual([
      { tick: 0, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 64, eventKind: undefined },
      { tick: 6, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 80, eventKind: undefined },
      { tick: 12, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 100, eventKind: undefined },
    ]);
  });

  it('handles a single event at tick 0', () => {
    const resolved = resolveTrakDeltas([{ deltaTick: 0, trackIndex: TB303_1, ctrlId: 5, value: 127 }]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].tick).toBe(0);
  });

  it('preserves trackIndex, ctrlId and value unchanged', () => {
    const resolved = resolveTrakDeltas([
      { deltaTick: 24, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 99 },
    ]);
    expect(resolved[0].trackIndex).toBe(TB303_1);
    expect(resolved[0].ctrlId).toBe(TB303_TRAK_CONTROLLER.CUTOFF);
    expect(resolved[0].value).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Helper: normaliseTrakValue
// ---------------------------------------------------------------------------

describe('normaliseTrakValue', () => {
  const CUTOFF_CTRL = TB303_TRAK_CONTROLLER.CUTOFF;
  const UNKNOWN_CTRL = 0xff;

  it('maps 0 to 0', () => {
    expect(normaliseTrakValue(TB303_1, CUTOFF_CTRL, 0)).toBe(0);
  });

  it('maps 127 to 1', () => {
    expect(normaliseTrakValue(TB303_1, CUTOFF_CTRL, 127)).toBeCloseTo(1, 5);
  });

  it('maps 64 to approximately 0.5', () => {
    expect(normaliseTrakValue(TB303_1, CUTOFF_CTRL, 64)).toBeCloseTo(64 / 127, 5);
  });

  it('clamps above 127 to 1 for known params', () => {
    expect(normaliseTrakValue(TB303_1, CUTOFF_CTRL, 255)).toBe(1);
  });

  it('applies identity mapping (0–127) for unknown ctrl IDs', () => {
    expect(normaliseTrakValue(TB303_1, UNKNOWN_CTRL, 63)).toBeCloseTo(63 / 127, 5);
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
  it('cancels pending PCF timeouts so they do not fire', () => {
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

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0.1);
    scheduler.cancelAll();
    vi.runAllTimers();
    expect(pcf.setAutomationCutoff).not.toHaveBeenCalled();
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

  it('schedules a synthA cutoff value directly on the Open303 audio clock', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const lane = makeLane({ target: 'synthA', parameter: 'filterCutoff', points: [{ step: 0, value: 0.75 }] });

    scheduler.scheduleFromLanes([lane], 0, 1, 0.5, 0);
    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith(
      'lead303',
      'setCutoff',
      expect.any(Number),
      0,
    );
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

    const events = [
      { tick: 0, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 64 },
      { tick: 200, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 100 },
    ];

    scheduler.scheduleFromTrakEvents(events, 120, 0, 96, 192);
    vi.runAllTimers();
    expect(mgr.scheduleParamAtTime).not.toHaveBeenCalled();
  });

  it('schedules a TB-303 #1 cutoff event at the correct audio time', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });

    const tempo = 120;
    const events = [{ tick: 24, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 64 }];

    scheduler.scheduleFromTrakEvents(events, tempo, 0, 0, 96);
    vi.runAllTimers();

    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith(
      'lead303',
      'setCutoff',
      expect.closeTo(64 / 127, 3),
      expect.any(Number)
    );
  });

  it('schedules a TB-303 #2 cutoff event for bass1 voice', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });

    const events = [{ tick: 6, trackIndex: TB303_2, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 100 }];

    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith('bass1', 'setCutoff', expect.any(Number), expect.any(Number));
  });

  it('ignores pattern-select events (does not call setCutoff with pattern index)', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });

    const events = [
      { tick: 0, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.PATTERN_SELECT, value: 3 },
      { tick: 48, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 90 },
    ];

    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    expect(mgr.scheduleParamAtTime).toHaveBeenCalledTimes(1);
    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith(
      'lead303',
      'setCutoff',
      expect.closeTo(90 / 127, 3),
      expect.any(Number),
    );
  });

  it('ignores events whose ctrlId has no mapping on that track', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const UNKNOWN_CTRL = 0xff;
    const events = [{ tick: 10, trackIndex: TB303_1, ctrlId: UNKNOWN_CTRL, value: 64 }];

    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();
    expect(mgr.scheduleParamAtTime).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AutomationScheduler: PCF parameter automation
// ---------------------------------------------------------------------------

/** Mirror of AutomationScheduler.pcfMidiNormToHz for test assertions. */
const testPcfMidiNormToHz = (norm: number) => 20 * Math.pow(1000, norm);

describe('AutomationScheduler PCF automation via scheduleFromLanes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    automationStore.clearAllLanes?.();
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

    // value 0.5 → pcfMidiNormToHz(0.5) ≈ 632 Hz
    expect(pcf.setAutomationCutoff).toHaveBeenCalledWith(expect.any(Number));
    const actualHz = (pcf.setAutomationCutoff as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
    expect(actualHz).toBeCloseTo(testPcfMidiNormToHz(0.5), 1);
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
    automationStore.clearAllLanes?.();
    resetLaneIdCounter();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes PCF frequency TRAK event on PCF track to setAutomationCutoff', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });
    scheduler.setPcfEffect(pcf as any);

    const events = [{ tick: 24, trackIndex: PCF_TRACK, ctrlId: PCF_TRAK_CONTROLLER.FREQUENCY, value: 64 }];
    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    expect(pcf.setAutomationCutoff).toHaveBeenCalledWith(expect.any(Number));
    const actualHz = (pcf.setAutomationCutoff as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
    expect(actualHz).toBeCloseTo(testPcfMidiNormToHz(64 / 127), 1);
  });

  it('routes PCF resonance TRAK event on PCF track to setAutomationResonance', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });
    scheduler.setPcfEffect(pcf as any);

    const events = [{ tick: 12, trackIndex: PCF_TRACK, ctrlId: PCF_TRAK_CONTROLLER.RESONANCE, value: 100 }];
    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    expect(pcf.setAutomationResonance).toHaveBeenCalledWith(expect.closeTo(100, 0));
  });

  it('routes PCF amount TRAK event on PCF track to setAutomationEnvAmount', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });
    scheduler.setPcfEffect(pcf as any);

    const events = [{ tick: 6, trackIndex: PCF_TRACK, ctrlId: PCF_TRAK_CONTROLLER.AMOUNT, value: 64 }];
    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    expect(pcf.setAutomationEnvAmount).toHaveBeenCalledWith(expect.closeTo(64 / 127, 3));
  });

  it('does not call PCF methods when pcfEffect is null', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const pcf = makePcfEffect();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });
    scheduler.setPcfEffect(null);

    const events = [{ tick: 6, trackIndex: PCF_TRACK, ctrlId: PCF_TRAK_CONTROLLER.FREQUENCY, value: 64 }];
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
      { tick: 6, trackIndex: TB303_1, ctrlId: TB303_TRAK_CONTROLLER.CUTOFF, value: 80 },
      { tick: 12, trackIndex: PCF_TRACK, ctrlId: PCF_TRAK_CONTROLLER.FREQUENCY, value: 64 },
    ];
    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 96);
    vi.runAllTimers();

    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith(
      'lead303', 'setCutoff', expect.any(Number), expect.any(Number)
    );
    expect(pcf.setAutomationCutoff).toHaveBeenCalledOnce();
  });
});

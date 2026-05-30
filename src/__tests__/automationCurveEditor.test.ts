/**
 * Tests for automation enhancements:
 * - Sub-step resolution (fractional step positions)
 * - Accent/slide flags on AutomationLanePoint
 * - Per-bank sampler targeting
 * - New store methods (updateLaneInterpolation, updateLaneName, getLanesForSamplerBank)
 *
 * @see Issue #669 — Automation Curve Editor UI, Lane List, Per-Bank Sampler Targeting
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  automationStore,
  generateLaneId,
  resetLaneIdCounter,
} from '../stores/automationStore';
import type {
  UnifiedAutomationLane,
  AutomationLanePoint,
} from '../types';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  automationStore.reset();
  resetLaneIdCounter();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLane(overrides?: Partial<UnifiedAutomationLane>): UnifiedAutomationLane {
  return {
    id: generateLaneId(),
    target: 'synthA',
    parameter: 'cutoff',
    name: 'Synth A Cutoff',
    points: [
      { step: 0, value: 0.2 },
      { step: 8, value: 0.8 },
      { step: 16, value: 0.5 },
    ],
    interpolation: 'linear',
    source: 'recorded',
    scope: 'pattern',
    patternIndex: 0,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sub-step Resolution
// ---------------------------------------------------------------------------

describe('Sub-step Resolution (fractional step positions)', () => {
  it('supports fractional step values in points', () => {
    const lane = makeLane({
      points: [
        { step: 0, value: 0.0 },
        { step: 2.5, value: 0.5 },
        { step: 4.833, value: 1.0 },
      ],
    });
    automationStore.addLane(lane);
    const stored = automationStore.getState().lanes[0];
    expect(stored.points[1].step).toBe(2.5);
    expect(stored.points[2].step).toBeCloseTo(4.833, 3);
  });

  it('interpolates between fractional step positions', () => {
    const lane = makeLane({
      points: [
        { step: 0, value: 0.0 },
        { step: 6, value: 1.0 }, // 6 ticks = 1 sixteenth note at 24PPQ
      ],
      interpolation: 'linear',
    });
    // Value at step 3 (half of 6 ticks)
    const val = automationStore.getValueAtStep(lane, 3);
    expect(val).toBeCloseTo(0.5, 5);
  });

  it('sorts sub-step points correctly', () => {
    const lane = makeLane();
    automationStore.addLane(lane);
    const subStepPoints: AutomationLanePoint[] = [
      { step: 4.5, value: 0.7 },
      { step: 2.333, value: 0.3 },
      { step: 4.0, value: 0.6 },
      { step: 0, value: 0.0 },
    ];
    automationStore.updateLanePoints(lane.id, subStepPoints);
    const updated = automationStore.getState().lanes[0];
    expect(updated.points[0].step).toBe(0);
    expect(updated.points[1].step).toBeCloseTo(2.333);
    expect(updated.points[2].step).toBe(4.0);
    expect(updated.points[3].step).toBe(4.5);
  });

  it('getValueAtStep works at sub-step positions', () => {
    const lane = makeLane({
      points: [
        { step: 0, value: 0.0 },
        { step: 4, value: 1.0 },
      ],
      interpolation: 'linear',
    });
    // Query at sub-step position
    const val = automationStore.getValueAtStep(lane, 2.5);
    expect(val).toBeCloseTo(0.625, 5);
  });
});

// ---------------------------------------------------------------------------
// Accent / Slide Flags
// ---------------------------------------------------------------------------

describe('Accent and Slide flags', () => {
  it('stores accent flag on points', () => {
    const lane = makeLane({
      points: [
        { step: 0, value: 0.8, accent: true },
        { step: 4, value: 0.5, accent: false },
        { step: 8, value: 0.9, accent: true },
      ],
    });
    automationStore.addLane(lane);
    const stored = automationStore.getState().lanes[0];
    expect(stored.points[0].accent).toBe(true);
    expect(stored.points[1].accent).toBe(false);
    expect(stored.points[2].accent).toBe(true);
  });

  it('stores slide flag on points', () => {
    const lane = makeLane({
      points: [
        { step: 0, value: 0.5, slide: false },
        { step: 4, value: 0.7, slide: true },
        { step: 8, value: 0.3, slide: true },
      ],
    });
    automationStore.addLane(lane);
    const stored = automationStore.getState().lanes[0];
    expect(stored.points[0].slide).toBe(false);
    expect(stored.points[1].slide).toBe(true);
    expect(stored.points[2].slide).toBe(true);
  });

  it('accent and slide flags are optional (undefined by default)', () => {
    const lane = makeLane({
      points: [{ step: 0, value: 0.5 }],
    });
    automationStore.addLane(lane);
    const stored = automationStore.getState().lanes[0];
    expect(stored.points[0].accent).toBeUndefined();
    expect(stored.points[0].slide).toBeUndefined();
  });

  it('preserves accent/slide during updateLanePoints', () => {
    const lane = makeLane();
    automationStore.addLane(lane);
    const newPoints: AutomationLanePoint[] = [
      { step: 0, value: 0.0, accent: true, slide: false },
      { step: 8, value: 1.0, accent: false, slide: true },
    ];
    automationStore.updateLanePoints(lane.id, newPoints);
    const updated = automationStore.getState().lanes[0];
    expect(updated.points[0].accent).toBe(true);
    expect(updated.points[1].slide).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-Bank Sampler Targeting
// ---------------------------------------------------------------------------

describe('Per-Bank Sampler Targeting', () => {
  it('supports sampler0-sampler7 targets', () => {
    const lane = makeLane({
      target: 'sampler3',
      parameter: 'filterCutoff',
      name: 'Bank 4 Filter',
    });
    automationStore.addLane(lane);
    const stored = automationStore.getState().lanes[0];
    expect(stored.target).toBe('sampler3');
  });

  it('getLanesForSamplerBank finds lanes by bank-specific target', () => {
    automationStore.addLanes([
      makeLane({ target: 'sampler0', parameter: 'volume', name: 'Bank 1 Vol' }),
      makeLane({ target: 'sampler2', parameter: 'filterCutoff', name: 'Bank 3 Filter', id: generateLaneId() }),
      makeLane({ target: 'sampler0', parameter: 'filterCutoff', name: 'Bank 1 Filter', id: generateLaneId() }),
    ]);
    const bank0 = automationStore.getLanesForSamplerBank(0);
    expect(bank0).toHaveLength(2);
    const bank2 = automationStore.getLanesForSamplerBank(2);
    expect(bank2).toHaveLength(1);
    expect(bank2[0].name).toBe('Bank 3 Filter');
  });

  it('getLanesForSamplerBank matches legacy sampler target with samplerBank field', () => {
    const lane = makeLane({
      target: 'sampler',
      parameter: 'volume',
      name: 'Legacy Bank 5',
      samplerBank: 5,
    });
    automationStore.addLane(lane);
    const result = automationStore.getLanesForSamplerBank(5);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Legacy Bank 5');
  });

  it('getLanesForSamplerBank filters by parameter when provided', () => {
    automationStore.addLanes([
      makeLane({ target: 'sampler1', parameter: 'volume', name: 'Vol', id: generateLaneId() }),
      makeLane({ target: 'sampler1', parameter: 'filterCutoff', name: 'Filter', id: generateLaneId() }),
    ]);
    const result = automationStore.getLanesForSamplerBank(1, 'volume');
    expect(result).toHaveLength(1);
    expect(result[0].parameter).toBe('volume');
  });

  it('getLanesForSamplerBank returns empty for unmatched bank', () => {
    automationStore.addLane(makeLane({ target: 'sampler0' }));
    const result = automationStore.getLanesForSamplerBank(7);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// New Store Methods
// ---------------------------------------------------------------------------

describe('AutomationStore — updateLaneInterpolation', () => {
  it('changes interpolation mode for a lane', () => {
    const lane = makeLane({ interpolation: 'linear' });
    automationStore.addLane(lane);
    automationStore.updateLaneInterpolation(lane.id, 'smooth');
    const updated = automationStore.getState().lanes[0];
    expect(updated.interpolation).toBe('smooth');
  });

  it('does not affect other lanes', () => {
    const lane1 = makeLane({ interpolation: 'linear' });
    const lane2 = makeLane({ interpolation: 'step', id: generateLaneId() });
    automationStore.addLanes([lane1, lane2]);
    automationStore.updateLaneInterpolation(lane1.id, 'smooth');
    expect(automationStore.getState().lanes[1].interpolation).toBe('step');
  });
});

describe('AutomationStore — updateLaneName', () => {
  it('renames a lane', () => {
    const lane = makeLane({ name: 'Original' });
    automationStore.addLane(lane);
    automationStore.updateLaneName(lane.id, 'Renamed Lane');
    expect(automationStore.getState().lanes[0].name).toBe('Renamed Lane');
  });
});

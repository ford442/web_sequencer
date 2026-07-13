/**
 * automationStore.test.ts
 *
 * Unit tests for the automation store — lane management, record-arm,
 * recording buffers, interpolation, and serialization.
 *
 * @see Issue #652 — Core data model, store, and types for automation lanes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  automationStore,
  generateLaneId,
  resetLaneIdCounter,
  convertHyphonLane,
  convertHyphonLanes,
} from '../stores/automationStore';
import type {
  UnifiedAutomationLane,
  AutomationLanePoint,
} from '../types';
import type { HyphonAutomationLane } from '../importers/rbs/types';

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

function makeHyphonLane(overrides?: Partial<HyphonAutomationLane>): HyphonAutomationLane {
  return {
    target: 'synthA',
    parameter: 'cutoff',
    name: 'TB-303A Cutoff',
    points: [[0, 0.3], [16, 0.9]],
    interpolation: 'linear',
    originalRange: [0, 127],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lane Management
// ---------------------------------------------------------------------------

describe('AutomationStore — Lane Management', () => {
  it('starts with empty lanes', () => {
    const state = automationStore.getState();
    expect(state.lanes).toEqual([]);
    expect(state.playbackEnabled).toBe(true);
  });

  it('addLane adds a single lane', () => {
    const lane = makeLane();
    automationStore.addLane(lane);
    const state = automationStore.getState();
    expect(state.lanes).toHaveLength(1);
    expect(state.lanes[0].parameter).toBe('cutoff');
  });

  it('addLanes adds multiple lanes', () => {
    const lanes = [
      makeLane({ parameter: 'cutoff' }),
      makeLane({ parameter: 'resonance', id: generateLaneId() }),
    ];
    automationStore.addLanes(lanes);
    expect(automationStore.getState().lanes).toHaveLength(2);
  });

  it('addLanes with empty array is a no-op', () => {
    automationStore.addLanes([]);
    expect(automationStore.getState().lanes).toHaveLength(0);
  });

  it('removeLane removes by ID', () => {
    const lane = makeLane();
    automationStore.addLane(lane);
    automationStore.removeLane(lane.id);
    expect(automationStore.getState().lanes).toHaveLength(0);
  });

  it('updateLanePoints replaces and sorts points', () => {
    const lane = makeLane();
    automationStore.addLane(lane);
    const newPoints: AutomationLanePoint[] = [
      { step: 16, value: 1.0 },
      { step: 4, value: 0.5 },
      { step: 0, value: 0.0 },
    ];
    automationStore.updateLanePoints(lane.id, newPoints);
    const updated = automationStore.getState().lanes[0];
    expect(updated.points[0].step).toBe(0);
    expect(updated.points[1].step).toBe(4);
    expect(updated.points[2].step).toBe(16);
  });

  it('toggleLaneEnabled flips enabled state', () => {
    const lane = makeLane({ enabled: true });
    automationStore.addLane(lane);
    automationStore.toggleLaneEnabled(lane.id);
    expect(automationStore.getState().lanes[0].enabled).toBe(false);
    automationStore.toggleLaneEnabled(lane.id);
    expect(automationStore.getState().lanes[0].enabled).toBe(true);
  });

  it('getLanesForParam filters correctly', () => {
    automationStore.addLanes([
      makeLane({ target: 'synthA', parameter: 'cutoff' }),
      makeLane({ target: 'synthA', parameter: 'resonance', id: generateLaneId() }),
      makeLane({ target: 'synthB', parameter: 'cutoff', id: generateLaneId() }),
    ]);
    const result = automationStore.getLanesForParam('synthA', 'cutoff');
    expect(result).toHaveLength(1);
    expect(result[0].target).toBe('synthA');
    expect(result[0].parameter).toBe('cutoff');
  });

  it('getActiveLanesForPattern returns pattern-specific + song-scoped lanes', () => {
    automationStore.addLanes([
      makeLane({ scope: 'pattern', patternIndex: 0 }),
      makeLane({ scope: 'pattern', patternIndex: 1, id: generateLaneId() }),
      makeLane({ scope: 'song', id: generateLaneId() }),
      makeLane({ scope: 'pattern', patternIndex: 0, enabled: false, id: generateLaneId() }),
    ]);
    const active = automationStore.getActiveLanesForPattern(0);
    expect(active).toHaveLength(2); // pattern 0 enabled + song-scoped
  });

  it('clearAllLanes removes everything', () => {
    automationStore.addLanes([makeLane(), makeLane({ id: generateLaneId() })]);
    automationStore.clearAllLanes();
    expect(automationStore.getState().lanes).toHaveLength(0);
  });

  it('clearLanesBySource removes only matching source', () => {
    automationStore.addLanes([
      makeLane({ source: 'rbs' }),
      makeLane({ source: 'recorded', id: generateLaneId() }),
      makeLane({ source: 'rbs', id: generateLaneId() }),
    ]);
    automationStore.clearLanesBySource('rbs');
    const remaining = automationStore.getState().lanes;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].source).toBe('recorded');
  });
});

// ---------------------------------------------------------------------------
// Record-Arm
// ---------------------------------------------------------------------------

describe('AutomationStore — Record-Arm', () => {
  it('armParameter arms a parameter', () => {
    automationStore.armParameter('synthA', 'cutoff');
    expect(automationStore.isParameterArmed('synthA', 'cutoff')).toBe(true);
  });

  it('armParameter is idempotent', () => {
    automationStore.armParameter('synthA', 'cutoff');
    automationStore.armParameter('synthA', 'cutoff');
    expect(automationStore.getState().recordArms.filter(
      (a) => a.target === 'synthA' && a.parameter === 'cutoff'
    )).toHaveLength(1);
  });

  it('disarmParameter disarms', () => {
    automationStore.armParameter('synthA', 'cutoff');
    automationStore.disarmParameter('synthA', 'cutoff');
    expect(automationStore.isParameterArmed('synthA', 'cutoff')).toBe(false);
  });

  it('disarmAll disarms everything', () => {
    automationStore.armParameter('synthA', 'cutoff');
    automationStore.armParameter('synthB', 'resonance');
    automationStore.disarmAll();
    expect(automationStore.isParameterArmed('synthA', 'cutoff')).toBe(false);
    expect(automationStore.isParameterArmed('synthB', 'resonance')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Recording Buffers
// ---------------------------------------------------------------------------

describe('AutomationStore — Recording', () => {
  it('startRecording creates a buffer', () => {
    automationStore.startRecording('synthA', 'cutoff');
    const state = automationStore.getState();
    expect(state.recordingBuffers).toHaveLength(1);
    expect(state.recordingBuffers[0].isRecording).toBe(true);
  });

  it('recordPoint appends to buffer', () => {
    automationStore.startRecording('synthA', 'cutoff');
    automationStore.recordPoint('synthA', 'cutoff', { step: 0, value: 0.5 });
    automationStore.recordPoint('synthA', 'cutoff', { step: 1, value: 0.7 });
    const state = automationStore.getState();
    expect(state.recordingBuffers[0].points).toHaveLength(2);
  });

  it('stopRecording commits buffer to a new lane', () => {
    automationStore.startRecording('synthA', 'cutoff');
    automationStore.recordPoint('synthA', 'cutoff', { step: 0, value: 0.3 });
    automationStore.recordPoint('synthA', 'cutoff', { step: 4, value: 0.9 });
    const lane = automationStore.stopRecording('synthA', 'cutoff', {
      name: 'Test Recording',
      patternIndex: 0,
    });
    expect(lane).not.toBeNull();
    expect(lane!.source).toBe('recorded');
    expect(lane!.points).toHaveLength(2);
    expect(automationStore.getState().lanes).toHaveLength(1);
    expect(automationStore.getState().recordingBuffers).toHaveLength(0);
  });

  it('stopRecording with empty buffer returns null', () => {
    automationStore.startRecording('synthA', 'cutoff');
    const lane = automationStore.stopRecording('synthA', 'cutoff');
    expect(lane).toBeNull();
    expect(automationStore.getState().lanes).toHaveLength(0);
  });

  it('cancelRecording removes buffer without creating lane', () => {
    automationStore.startRecording('synthA', 'cutoff');
    automationStore.recordPoint('synthA', 'cutoff', { step: 0, value: 0.5 });
    automationStore.cancelRecording('synthA', 'cutoff');
    expect(automationStore.getState().recordingBuffers).toHaveLength(0);
    expect(automationStore.getState().lanes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

describe('AutomationStore — Interpolation (getValueAtStep)', () => {
  it('returns exact value for matching step', () => {
    const lane = makeLane({
      points: [
        { step: 0, value: 0.0 },
        { step: 16, value: 1.0 },
      ],
      interpolation: 'linear',
    });
    expect(automationStore.getValueAtStep(lane, 0)).toBe(0.0);
    expect(automationStore.getValueAtStep(lane, 16)).toBe(1.0);
  });

  it('linear interpolation between points', () => {
    const lane = makeLane({
      points: [
        { step: 0, value: 0.0 },
        { step: 16, value: 1.0 },
      ],
      interpolation: 'linear',
    });
    const val = automationStore.getValueAtStep(lane, 8);
    expect(val).toBeCloseTo(0.5, 5);
  });

  it('step interpolation holds previous value', () => {
    const lane = makeLane({
      points: [
        { step: 0, value: 0.2 },
        { step: 16, value: 0.8 },
      ],
      interpolation: 'step',
    });
    expect(automationStore.getValueAtStep(lane, 8)).toBe(0.2);
    expect(automationStore.getValueAtStep(lane, 15)).toBe(0.2);
  });

  it('smooth interpolation is between linear endpoints', () => {
    const lane = makeLane({
      points: [
        { step: 0, value: 0.0 },
        { step: 16, value: 1.0 },
      ],
      interpolation: 'smooth',
    });
    const val = automationStore.getValueAtStep(lane, 8)!;
    // Smooth at midpoint should equal 0.5 (cubic ease-in-out is symmetric)
    expect(val).toBeCloseTo(0.5, 5);
  });

  it('returns null for empty points', () => {
    const lane = makeLane({ points: [] });
    expect(automationStore.getValueAtStep(lane, 0)).toBeNull();
  });

  it('before first point returns first value', () => {
    const lane = makeLane({
      points: [
        { step: 4, value: 0.5 },
        { step: 16, value: 1.0 },
      ],
      interpolation: 'linear',
    });
    expect(automationStore.getValueAtStep(lane, 0)).toBe(0.5);
  });

  it('after last point holds last value', () => {
    const lane = makeLane({
      points: [
        { step: 0, value: 0.2 },
        { step: 8, value: 0.8 },
      ],
      interpolation: 'linear',
    });
    expect(automationStore.getValueAtStep(lane, 16)).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// Conversion from HyphonAutomationLane
// ---------------------------------------------------------------------------

describe('convertHyphonLane', () => {
  it('converts a HyphonAutomationLane to UnifiedAutomationLane', () => {
    const hyphon = makeHyphonLane();
    const unified = convertHyphonLane(hyphon, 0);
    expect(unified.target).toBe('synthA');
    expect(unified.parameter).toBe('cutoff');
    expect(unified.source).toBe('rbs');
    expect(unified.scope).toBe('pattern');
    expect(unified.patternIndex).toBe(0);
    expect(unified.points).toHaveLength(2);
    expect(unified.points[0]).toEqual({ step: 0, value: 0.3 });
    expect(unified.originalRange).toEqual([0, 127]);
    expect(unified.enabled).toBe(true);
  });

  it('scope is song when no patternIndex given', () => {
    const hyphon = makeHyphonLane();
    const unified = convertHyphonLane(hyphon);
    expect(unified.scope).toBe('song');
    expect(unified.patternIndex).toBeUndefined();
  });
});

describe('convertHyphonLanes', () => {
  it('converts multiple lanes', () => {
    const lanes = [
      makeHyphonLane({ parameter: 'cutoff' }),
      makeHyphonLane({ parameter: 'resonance', target: 'synthB' }),
    ];
    const unified = convertHyphonLanes(lanes, 2);
    expect(unified).toHaveLength(2);
    expect(unified[0].parameter).toBe('cutoff');
    expect(unified[1].parameter).toBe('resonance');
    expect(unified[1].target).toBe('synthB');
    expect(unified[0].patternIndex).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe('AutomationStore — Serialization', () => {
  it('exportLanes returns deep copies', () => {
    const lane = makeLane();
    automationStore.addLane(lane);
    const exported = automationStore.exportLanes();
    expect(exported).toHaveLength(1);
    exported[0].parameter = 'modified';
    expect(automationStore.getState().lanes[0].parameter).toBe('cutoff');
  });

  it('importLanes replaces all lanes', () => {
    automationStore.addLane(makeLane({ parameter: 'old' }));
    const newLanes = [makeLane({ parameter: 'new1' }), makeLane({ parameter: 'new2', id: generateLaneId() })];
    automationStore.importLanes(newLanes);
    const state = automationStore.getState();
    expect(state.lanes).toHaveLength(2);
    expect(state.lanes[0].parameter).toBe('new1');
  });

  it('importFromRbs converts and adds hyphon lanes', () => {
    const hyphonLanes: HyphonAutomationLane[] = [
      makeHyphonLane({ parameter: 'cutoff' }),
      makeHyphonLane({ parameter: 'resonance', target: 'synthB' }),
    ];
    automationStore.importFromRbs(hyphonLanes, 0);
    const state = automationStore.getState();
    expect(state.lanes).toHaveLength(2);
    expect(state.lanes[0].source).toBe('rbs');
  });

  it('lanes survive JSON round-trip', () => {
    const lane = makeLane();
    automationStore.addLane(lane);
    const exported = automationStore.exportLanes();
    const json = JSON.stringify(exported);
    const restored = JSON.parse(json) as UnifiedAutomationLane[];
    expect(restored[0].id).toBe(lane.id);
    expect(restored[0].points).toEqual(lane.points);
    expect(restored[0].interpolation).toBe('linear');
  });
});

// ---------------------------------------------------------------------------
// Playback State
// ---------------------------------------------------------------------------

describe('AutomationStore — Playback', () => {
  it('setPlaybackStep updates step', () => {
    automationStore.setPlaybackStep(8);
    expect(automationStore.getState().playbackStep).toBe(8);
  });

  it('setPlaybackEnabled toggles playback', () => {
    automationStore.setPlaybackEnabled(false);
    expect(automationStore.getState().playbackEnabled).toBe(false);
    automationStore.setPlaybackEnabled(true);
    expect(automationStore.getState().playbackEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

describe('AutomationStore — Subscription', () => {
  it('notifies subscribers on lane change', () => {
    let notified = false;
    const unsub = automationStore.subscribe(() => {
      notified = true;
    });
    // Subscribe calls listener immediately
    notified = false;
    automationStore.addLane(makeLane());
    expect(notified).toBe(true);
    unsub();
  });

  it('unsubscribe stops notifications', () => {
    let count = 0;
    const unsub = automationStore.subscribe(() => { count++; });
    count = 0; // reset from initial call
    unsub();
    automationStore.addLane(makeLane());
    expect(count).toBe(0);
  });
});

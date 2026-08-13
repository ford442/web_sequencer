/**
 * Stress tests for song-mode + automation playback stability.
 * @see docs/audio-engine/PLAYBACK_STABILITY.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AutomationScheduler,
} from '../audio/automation/AutomationScheduler';
import { automationStore, generateLaneId, resetLaneIdCounter } from '../stores/automationStore';
import {
  playbackHealthMonitor,
  PLAYBACK_THRESHOLDS,
} from '../audio/playback/PlaybackHealthMonitor';
import { VoiceManager } from '../engines/VoiceManager';
import { SingingVoiceManager } from '../engines/SingingVoiceManager';
import type { UnifiedAutomationLane, SynthParams } from '../types';

function makeAudioContext(currentTime = 0): AudioContext {
  return { currentTime } as unknown as AudioContext;
}

function makeOpen303Manager() {
  return {
    isBass1Ready: vi.fn(() => true),
    isBass2Ready: vi.fn(() => true),
    isLead303Ready: vi.fn(() => true),
    scheduleParamAtTime: vi.fn(),
    scheduleSlideAtTime: vi.fn(),
  };
}

function makeProphecyManager() {
  return {
    scheduleParamAtTime: vi.fn(),
  };
}

function makeLane(overrides?: Partial<UnifiedAutomationLane>): UnifiedAutomationLane {
  return {
    id: generateLaneId(),
    target: 'synthA',
    parameter: 'filterCutoff',
    name: 'Stress Lane',
    points: [{ step: 0, value: 0.5 }],
    interpolation: 'linear',
    source: 'recorded',
    scope: 'pattern',
    patternIndex: 0,
    enabled: true,
    ...overrides,
  };
}

function makeMinimalSynthParams(): SynthParams {
  return {
    waveform: 'sawtooth',
    pitch: 0,
    filterCutoff: 8000,
    filterResonance: 1,
    filterMode: 0,
    attack: 0.01,
    decay: 0.2,
    sustain: 0.5,
    release: 0.1,
    length: 0.25,
    volume: 0.8,
    delayTime: 0,
    delayFeedback: 0,
    delayMix: 0,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  automationStore.reset();
  resetLaneIdCounter();
  playbackHealthMonitor.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('playback stress — AutomationScheduler', () => {
  it('schedules 32 steps × 8 lanes without exceeding back-pressure cap', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);

    const lanes = Array.from({ length: 8 }, (_, i) =>
      makeLane({
        target: (['synthA', 'synthB', 'bass2', 'master'] as const)[i % 4],
        parameter: i % 2 === 0 ? 'filterCutoff' : 'filterResonance',
        points: Array.from({ length: 32 }, (_, step) => ({
          step,
          value: (step + i) / 32,
        })),
      }),
    );

    const stepTime = 60 / 120 / 4;
    for (let step = 0; step < 32; step++) {
      scheduler.scheduleFromLanes(lanes, step, 1, stepTime, step * stepTime);
    }

    const snap = playbackHealthMonitor.getSnapshot();
    expect(snap.backpressureEvents).toBe(0);
    expect(mgr.scheduleParamAtTime.mock.calls.length).toBeGreaterThan(0);
  });

  it('passes step audioTime through to Open303 (not currentTime at apply)', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);
    const lane = makeLane({ points: [{ step: 0, value: 0.5 }] });

    const targetAudioTime = 0.25;
    scheduler.scheduleFromLanes([lane], 0, 1, 0.125, targetAudioTime);

    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith(
      'lead303',
      'setCutoff',
      expect.any(Number),
      targetAudioTime,
    );
  });

  it('coalesces duplicate lane events in the same 1 ms audio-time bucket', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });
    const lane = makeLane({ points: [{ step: 0, value: 0.5 }] });

    scheduler.scheduleFromLanes([lane], 0, 1, 0.125, 0);
    scheduler.scheduleFromLanes([lane], 0, 1, 0.125, 0);

    expect(mgr.scheduleParamAtTime).toHaveBeenCalledTimes(1);
  });

  it('routes prophecy vowel automation via audio-clock scheduling', () => {
    const ctx = makeAudioContext(0);
    const mgr = makeOpen303Manager();
    const prophecy = makeProphecyManager();
    const scheduler = new AutomationScheduler(ctx, mgr as any);
    scheduler.setProphecyManager(prophecy as any);

    const lane = makeLane({
      target: 'synthA',
      parameter: 'vowel',
      points: [{ step: 0, value: 0.75 }],
    });

    scheduler.scheduleFromLanes([lane], 0, 1, 0.125, 0.5);
    expect(prophecy.scheduleParamAtTime).toHaveBeenCalledWith(
      'partA',
      'vowel',
      0.75,
      0.5,
    );
    expect(mgr.scheduleParamAtTime).not.toHaveBeenCalled();
  });
});

describe('playback stress — voice allocation', () => {
  it('steals and stops a voice when polyphony is saturated', () => {
    const ctx = new AudioContext();
    const dest = ctx.createGain();
    const vm = new VoiceManager(ctx, dest, 4, false);
    const params = makeMinimalSynthParams();

    vm.noteOn(params, 'C4', 0);
    vm.noteOn(params, 'D4', 0);
    vm.noteOn(params, 'E4', 0);
    vm.noteOn(params, 'F4', 0);
    playbackHealthMonitor.reset();

    vm.noteOn(params, 'G4', 0);
    expect(playbackHealthMonitor.getSnapshot().voiceSteals).toBe(1);
  });

  it('stops stolen sampler voice when both voices are busy', () => {
    const ctx = new AudioContext();
    const mgr = new SingingVoiceManager(ctx, 2);
    const noteOff = vi.fn();
    (mgr as unknown as { voices: Array<{ noteOff: typeof noteOff, isActive: boolean }> }).voices = [
      { noteOff, isActive: true },
      { noteOff: vi.fn(), isActive: true },
    ];

    mgr.acquireVoiceForBank("bank-a", 0);
    mgr.acquireVoiceForBank("bank-a", 1);
    playbackHealthMonitor.reset();
    mgr.acquireVoiceForBank('bank-b');

    expect(noteOff).toHaveBeenCalled();
    expect(playbackHealthMonitor.getSnapshot().voiceSteals).toBeGreaterThanOrEqual(1);
  });
});

describe('PLAYBACK_THRESHOLDS', () => {
  it('documents stable jitter bounds', () => {
    expect(PLAYBACK_THRESHOLDS.schedulerLagWarnMs).toBeLessThanOrEqual(
      PLAYBACK_THRESHOLDS.schedulerLagDropMs,
    );
    expect(PLAYBACK_THRESHOLDS.maxPendingAutomation).toBeGreaterThan(64);
  });
});

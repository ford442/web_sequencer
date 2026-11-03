/**
 * The one lane → value resolver (#1384): the live scheduler and the offline
 * renders read lanes through it, so the value a bounce plays on a step is the
 * value the scheduler sends the worklet on that step.
 */
import { describe, expect, it, vi } from 'vitest';
import fullSong from '../../test-fixtures/ai-song/full.json';
import { convertAISong, type AISongData } from '../importers/ai-song';
import { AutomationScheduler } from '../audio/automation/AutomationScheduler';
import {
  isLaneActive,
  laneDispatchGap,
  lanePositionAt,
  resolveLaneTimeline,
  resolveLaneValuesAtStep,
  resolveOpen303ParamSteps,
  resolveParamAtStep,
} from '../audio/automation/laneResolver';
import {
  resolveMasterPcfTimeline,
  resolveOffline303Automation,
  resolveSynthLaneAutomation,
  withMasterPcfNotRendered,
} from '../audio/offline/offlineLaneAutomation';
import { pcfLaneOverride, pcfMidiNormToHz } from '../audio/automation/laneResolver';
import type { Open303Manager } from '../engines/Open303Manager';
import type { UnifiedAutomationLane } from '../types';

function lane(overrides: Partial<UnifiedAutomationLane> = {}): UnifiedAutomationLane {
  return {
    id: 'l',
    target: 'synthA',
    parameter: 'filterCutoff',
    name: 'lane',
    points: [{ step: 0, value: 0 }, { step: 15, value: 1 }],
    interpolation: 'linear',
    source: 'manual',
    scope: 'song',
    enabled: true,
    ...overrides,
  };
}

function fixtureLanes(): UnifiedAutomationLane[] {
  const converted = convertAISong(fullSong as unknown as AISongData);
  if (!converted.success || !converted.song) throw new Error('fixture failed to convert');
  return converted.song.automationLanes ?? [];
}

/** What the live scheduler sends Open303Manager, per step, for one voice. */
function scheduledLive(lanes: UnifiedAutomationLane[], steps: number, voice: 'lead303' | 'bass1' | 'bass2') {
  const mgr = {
    isBass1Ready: () => true,
    isBass2Ready: () => true,
    isLead303Ready: () => true,
    scheduleParamAtTime: vi.fn(),
    scheduleSlideAtTime: vi.fn(),
  };
  const scheduler = new AutomationScheduler({ currentTime: 0 } as AudioContext, mgr as unknown as Open303Manager);
  const stepTime = 0.125;
  for (let step = 0; step < steps; step++) {
    scheduler.scheduleFromLanes(lanes, step, 1, stepTime, step * stepTime);
  }
  const perStep: Array<Record<string, number>> = Array.from({ length: steps }, () => ({}));
  for (const [v, func, value, time] of mgr.scheduleParamAtTime.mock.calls as Array<[string, string, number, number]>) {
    if (v !== voice) continue;
    perStep[Math.round(time / stepTime)][func] = value;
  }
  return perStep;
}

describe('laneResolver', () => {
  it('live vs offline parity: the fixture lanes resolve to what the scheduler schedules', () => {
    const lanes = fixtureLanes();
    const timeline = { totalSteps: 32, stepCount: 32, songMode: false };
    const cases = [
      { target: 'synthA', voice: 'lead303', setter: 'setCutoff', field: 'cutoff' },
      { target: 'synthB', voice: 'bass1', setter: 'setResonance', field: 'resonance' },
      { target: 'bass2', voice: 'bass2', setter: 'setDecay', field: 'decay' },
    ] as const;
    for (const { target, voice, setter, field } of cases) {
      const live = scheduledLive(lanes, 32, voice).map((s) => s[setter]);
      const offline = resolveOffline303Automation(lanes, timeline, target).paramSteps!.map((p) => p?.[field]);
      expect(offline, target).toEqual(live);
      expect(new Set(live).size, `${target} lane moves`).toBeGreaterThan(1);
    }
  });

  it('the stem renderer gets the same values, in the 303 knob scale', () => {
    const lanes = fixtureLanes();
    const timeline = { totalSteps: 32, stepCount: 32, songMode: false };
    const { byTarget } = resolveSynthLaneAutomation(lanes, timeline, [{ target: 'synthA', waveform: '303-saw' }]);
    const live = scheduledLive(lanes, 32, 'lead303').map((s) => Math.max(20, s.setCutoff * 8000));
    expect(byTarget.synthA?.filterCutoff).toEqual(live);
    expect(byTarget.synthA?.perStep).toBe(true);
  });

  it('a non-303 voice is scaled like the step handler\'s per-note override and holds per note', () => {
    const { byTarget } = resolveSynthLaneAutomation(
      [lane()],
      { totalSteps: 16, stepCount: 16, songMode: false },
      [{ target: 'synthA', waveform: 'sawtooth' }],
    );
    expect(byTarget.synthA?.perStep).toBe(false);
    expect(byTarget.synthA?.filterCutoff?.[15]).toBe(20000);
  });

  it('first enabled lane per target:parameter wins; disabled and note FX lanes do not play', () => {
    const lanes = [
      lane({ id: 'off', enabled: false, points: [{ step: 0, value: 0.9 }] }),
      lane({ id: 'a', points: [{ step: 0, value: 0.2 }] }),
      lane({ id: 'b', points: [{ step: 0, value: 0.7 }] }),
      lane({ id: 'fx', parameter: 'noteFx.arp.rate', points: [{ step: 0, value: 0.5 }] }),
    ];
    const values = resolveLaneValuesAtStep(lanes, 0);
    expect(values.map((v) => [v.lane.id, v.value])).toEqual([['a', 0.2]]);
  });

  it('clamps values outside [0, 1] in production builds', () => {
    vi.stubEnv('DEV', false);
    try {
      const values = resolveLaneValuesAtStep([lane({ points: [{ step: 0, value: 1.4 }] })], 0);
      expect(values[0].value).toBe(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('pattern-scoped lanes follow measure % 8 in song mode and pattern 0 otherwise', () => {
    const scoped = lane({ scope: 'pattern', patternIndex: 1, points: [{ step: 0, value: 0.5 }] });
    expect(isLaneActive(scoped, 1)).toBe(true);
    expect(isLaneActive(scoped, 0)).toBe(false);

    expect(lanePositionAt(37, { stepCount: 16, songMode: true })).toEqual({ step: 5, patternIndex: 2 });
    expect(lanePositionAt(37, { stepCount: 16, songMode: false })).toEqual({ step: 5, patternIndex: 0 });
    expect(lanePositionAt(16 * 9 + 3, { stepCount: 16, songMode: true })).toEqual({ step: 3, patternIndex: 1 });

    const song = resolveLaneTimeline([scoped], { totalSteps: 48, stepCount: 16, songMode: true });
    const playing = song.map((entries) => entries.length > 0);
    expect(playing.slice(0, 16).some(Boolean)).toBe(false);
    expect(playing.slice(16, 32).every(Boolean)).toBe(true);
    expect(playing.slice(32, 48).some(Boolean)).toBe(false);
  });

  it('a song-scoped lane is read at the pattern step every measure, like the wrapped live clock', () => {
    const steps = resolveOpen303ParamSteps(
      resolveLaneTimeline([lane()], { totalSteps: 32, stepCount: 16, songMode: true }),
      'synthA',
    );
    expect(steps[3]).toEqual(steps[19]);
    expect(steps[15]).toEqual({ cutoff: 1 });
  });

  it('resolveParamAtStep (the step handler\'s per-note override) honours scope like the scheduler', () => {
    const scoped = lane({ scope: 'pattern', patternIndex: 2, points: [{ step: 0, value: 0.3 }] });
    const song = lane({ id: 's', points: [{ step: 0, value: 0.8 }] });
    expect(resolveParamAtStep([scoped, song], 0, 2)).toBe(0.3);
    expect(resolveParamAtStep([scoped, song], 0, 0)).toBe(0.8);
    expect(resolveParamAtStep([scoped], 0, 0)).toBeNull();
  });

  it('reads a song-timeline lane at the song step, and a plain lane at the pattern step', () => {
    // Measure 1 of a 16-step song ramps 0 → 1; measure 0 holds 0.
    const timeline = lane({ timeline: 'song', points: [{ step: 16, value: 0 }, { step: 31, value: 1 }] });
    const plain = lane({ parameter: 'filterResonance' });

    expect(resolveParamAtStep([timeline], 15, 0, 31)).toBe(1);
    expect(resolveParamAtStep([timeline], 15, 0, 15)).toBe(0);
    // No song position (pattern mode): the lane's first measure plays.
    expect(resolveParamAtStep([timeline], 15, 0)).toBe(0);
    // A plain lane ignores the song position and repeats every measure.
    expect(resolveParamAtStep([plain], 15, 0, 31)).toBe(1);

    const resolved = resolveLaneTimeline([timeline, plain], { totalSteps: 32, stepCount: 16, songMode: true });
    const cutoff = (g: number) => resolved[g].find((v) => v.lane.parameter === 'filterCutoff')?.value;
    expect(cutoff(15)).toBe(0);
    expect(cutoff(31)).toBe(1);
  });

  it('reports master PCF lanes as not rendered on a render without the master chain', () => {
    const pcf = lane({ target: 'master', parameter: 'pcfCutoff' });
    const { report } = resolveSynthLaneAutomation(
      [pcf, lane({ target: 'synthB', parameter: 'envMod' })],
      { totalSteps: 16, stepCount: 16, songMode: false },
      [{ target: 'synthB', waveform: '303-sqr' }],
    );
    expect(report.applied).toEqual([]);
    expect(report.notRendered.map((s) => s.lane)).toEqual(['master.pcfCutoff', 'synthB.envMod']);
    expect(report.notRendered[0].reason).toMatch(/master chain/);
  });

  it('reports master PCF lanes as applied when the render runs the master PCF', () => {
    const pcf = lane({ target: 'master', parameter: 'pcfCutoff' });
    const { report } = resolveSynthLaneAutomation(
      [pcf],
      { totalSteps: 16, stepCount: 16, songMode: false },
      [],
      { masterPcf: true },
    );
    expect(report.applied).toEqual(['master.pcfCutoff']);
    expect(report.notRendered).toEqual([]);
  });
});

describe('master PCF on the offline clock', () => {
  it('converts lane values exactly as the live scheduler does', () => {
    expect(pcfLaneOverride('pcfCutoff', 0)).toEqual({ cutoffHz: 20 });
    expect(pcfLaneOverride('pcfCutoff', 1)!.cutoffHz).toBeCloseTo(20000);
    expect(pcfLaneOverride('pcfResonance', 0.5)).toEqual({ resonanceMidi: 63.5 });
    expect(pcfLaneOverride('pcfEnvAmount', 2)).toEqual({ envAmountNorm: 1 });
    expect(pcfLaneOverride('filterCutoff', 0.5)).toBeNull();
  });

  it('times one event per step where a value changes', () => {
    const events = resolveMasterPcfTimeline(
      [
        lane({ target: 'master', parameter: 'pcfCutoff', points: [{ step: 0, value: 0 }, { step: 15, value: 1 }] }),
        lane({ id: 'r', target: 'master', parameter: 'pcfResonance', points: [{ step: 0, value: 0.5 }, { step: 15, value: 0.5 }] }),
      ],
      { totalSteps: 16, stepCount: 16, songMode: false },
      0.125,
      1,
    );
    expect(events).toHaveLength(16);
    expect(events[0]).toEqual({ time: 1, cutoffHz: 20, resonanceMidi: 63.5 });
    // Resonance holds, so later events carry the cutoff only.
    expect(events[15]).toEqual({ time: 1 + 15 * 0.125, cutoffHz: pcfMidiNormToHz(1) });
  });

  it('is empty for a song without master PCF lanes', () => {
    expect(resolveMasterPcfTimeline([lane({})], { totalSteps: 16, stepCount: 16, songMode: false }, 0.125)).toEqual([]);
  });

  it('moves PCF lanes to not-rendered when the bounce could not run the PCF', () => {
    const report = withMasterPcfNotRendered(
      { applied: ['master.pcfCutoff', 'synthA.filterCutoff'], notRendered: [] },
      'no pcf',
    );
    expect(report).toEqual({
      applied: ['synthA.filterCutoff'],
      notRendered: [{ lane: 'master.pcfCutoff', reason: 'no pcf' }],
    });
  });
});

describe('laneDispatchGap — which lanes live playback ever plays', () => {
    it('is null for what the scheduler dispatches', () => {
        for (const target of ['synthA', 'synthB', 'bass2'] as const) {
            for (const parameter of ['filterCutoff', 'filterResonance', 'decay', 'envMod', 'accent', 'volume', 'drive']) {
                expect(laneDispatchGap(target, parameter)).toBeNull();
            }
        }
        expect(laneDispatchGap('synthA', 'macroTimbre')).toBeNull();
        expect(laneDispatchGap('synthB', 'vowel')).toBeNull();
        expect(laneDispatchGap('wam', 'slot-1/gain')).toBeNull();
        expect(laneDispatchGap('bass2', 'noteFx.arp.rate')).toBeNull();
    });

    it('names the gap for what it does not', () => {
        expect(laneDispatchGap('kick', 'decay')).toBe('the scheduler routes no kick lanes');
        expect(laneDispatchGap('sampler', 'volume')).toBe('the scheduler routes no sampler lanes');
        expect(laneDispatchGap('synthA', 'pitch')).toBe('the scheduler has no synthA case for "pitch"');
        expect(laneDispatchGap('bass2', 'macroTimbre')).toBe('the scheduler has no bass2 case for "macroTimbre"');
        expect(laneDispatchGap('master', 'tempo')).toBe('the scheduler has no master case for "tempo"');
    });

    it('plays the master PCF lanes — the engine builds the masterPcf stage', () => {
        for (const parameter of ['pcfCutoff', 'pcfResonance', 'pcfEnvAmount']) {
            expect(laneDispatchGap('master', parameter)).toBeNull();
        }
    });
});

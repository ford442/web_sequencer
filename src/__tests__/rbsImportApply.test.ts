import { describe, expect, it, vi } from 'vitest';
import {
  applyPcfFilterToEffect,
  applyTrackParamSlotToEngine,
  pcfFilterToPcfSettings,
} from '../importers/rbs/applyImportedEngineState';
import { trakEventsFromAutomationLanes } from '../importers/rbs/trakExport';
import { TB303_TRAK_CONTROLLER } from '../importers/rbs/trakControllers';
import { Open303Manager } from '../engines/Open303Manager';
import type { Bass2Params, SynthParams } from '../types';

describe('applyPcfFilterToEffect', () => {
  it('calls loadSettings when both PCF filter and effect exist', () => {
    const loadSettings = vi.fn();
    const pcfFilter = {
      enabled: true,
      filterType: 'lp' as const,
      cutoff: 80,
      resonance: 40,
      envAmount: 60,
      decay: 40,
      pattern: Array(16).fill(64),
      target: { tb303A: true, tb303B: false, drums: false },
    };
    expect(applyPcfFilterToEffect(pcfFilter, { loadSettings })).toBe(true);
    expect(loadSettings).toHaveBeenCalledWith(pcfFilterToPcfSettings(pcfFilter));
  });

  it('returns false when effect is missing', () => {
    expect(applyPcfFilterToEffect({
      enabled: true,
      filterType: 'lp',
      cutoff: 80,
      resonance: 40,
      envAmount: 60,
      decay: 40,
      pattern: [],
      target: { tb303A: true, tb303B: false, drums: false },
    }, null)).toBe(false);
  });
});

describe('applyTrackParamSlotToEngine', () => {
  it('merges synthA slot params and applies lead303', () => {
    const applyLead303Params = vi.fn();
    const open303 = { applyLead303Params, applyBass1Params: vi.fn(), applyBass2Params: vi.fn() } as unknown as Open303Manager;
    const synthA = {
      waveform: '303-saw',
      filterCutoff: 400,
      filterResonance: 1,
      decay: 0.2,
      volume: 0.5,
    } as SynthParams;
    const result = applyTrackParamSlotToEngine(
      {
        synthA: [{ filterCutoff: 2000, waveform: '303-sqr' }, null],
        synthB: [],
        bass2: [],
      },
      'partA',
      0,
      open303,
      { synthA, synthB: synthA, bass2: { cutoff: 800 } as Bass2Params },
    );
    expect(result.synthA?.filterCutoff).toBe(2000);
    expect(applyLead303Params).toHaveBeenCalled();
  });
});

describe('trakEventsFromAutomationLanes', () => {
  it('maps synthA cutoff points to TB-303 track 1 cutoff controllers', () => {
    const events = trakEventsFromAutomationLanes([{
      target: 'synthA',
      parameter: 'filterCutoff',
      name: 'Cutoff',
      points: [[0, 0.25], [2, 1]],
      interpolation: 'linear',
      originalRange: [0, 127],
    }]);
    expect(events).toHaveLength(2);
    expect(events[0].trackIndex).toBe(1);
    expect(events[0].controllerId).toBe(TB303_TRAK_CONTROLLER.CUTOFF);
    expect(events[0].value).toBe(32);
    expect(events[1].absoluteTicks).toBe(96);
    expect(events[1].value).toBe(127);
  });
});

/**
 * Per-track TRAK controller resolution + param automation split (#777).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RbsParser } from '../importers/rbs/RbsParser';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import { AutomationScheduler } from '../audio/automation/AutomationScheduler';
import {
  TB303_TRAK_CONTROLLER,
  resolveTrakEventKind,
  isTrakPatternSelectEvent,
  isTrakParamAutomationEvent,
} from '../importers/rbs/trakControllers';
import { TRAK_TRACK_INDEX } from '../importers/rbs/types';
import { buildSyntheticIffFile } from './rbs/fixtures';

function makeOpen303Manager() {
  return {
    isLead303Ready: () => true,
    isBass1Ready: () => true,
    isBass2Ready: () => true,
    scheduleParamAtTime: vi.fn(),
  };
}

describe('trakControllers', () => {
  it('classifies TB-303 #1 pattern select vs cutoff', () => {
    expect(resolveTrakEventKind(1, 0x01)).toBe('patternSelect');
    expect(resolveTrakEventKind(1, 0x03)).toBe('paramChange');
    expect(isTrakPatternSelectEvent(1, 0x01)).toBe(true);
    expect(isTrakParamAutomationEvent(1, 0x03)).toBe(true);
    expect(isTrakParamAutomationEvent(1, 0x01)).toBe(false);
  });

  it('does not treat mixer compressor ID as pattern select', () => {
    expect(resolveTrakEventKind(0, 0x01)).toBe('routing');
    expect(isTrakPatternSelectEvent(0, 0x01)).toBe(false);
  });
});

describe('IFF TRAK parse + importer split', () => {
  const mixedTb303Events = [
    { delta: 0, ctrl: TB303_TRAK_CONTROLLER.PATTERN_SELECT, value: 0 },
    { delta: 48, ctrl: TB303_TRAK_CONTROLLER.CUTOFF, value: 40 },
    { delta: 48, ctrl: TB303_TRAK_CONTROLLER.CUTOFF, value: 100 },
    { delta: 672, ctrl: TB303_TRAK_CONTROLLER.PATTERN_SELECT, value: 1 },
  ];

  it('tags events with trackIndex and eventKind', async () => {
    const bytes = buildSyntheticIffFile({
      trakTracks: [
        { events: [] },
        { events: mixedTb303Events },
        { events: [] },
        { events: [] },
        { events: [] },
        { events: [] },
      ],
    });
    const parser = new RbsParser();
    const result = await parser.parseBytes(bytes, { filename: 'trak_mixed.rbs' });
    expect(result.success).toBe(true);
    if (!result.success || !result.data.songData) return;

    const track = result.data.songData.tracks.find((t) => t.trackIndex === TRAK_TRACK_INDEX.TB303_1)!;
    expect(track.events[0].eventKind).toBe('patternSelect');
    expect(track.events[1].eventKind).toBe('paramChange');
    expect(track.events[1].trackIndex).toBe(TRAK_TRACK_INDEX.TB303_1);
  });

  it('splits trakParamEvents from arrangement events', async () => {
    const bytes = buildSyntheticIffFile({
      trakTracks: [
        { events: [] },
        { events: mixedTb303Events },
        { events: [] },
        { events: [] },
        { events: [] },
        { events: [] },
      ],
    });
    const parser = new RbsParser();
    const parseResult = await parser.parseBytes(bytes, { filename: 'trak_split.rbs' });
    expect(parseResult.success).toBe(true);
    if (!parseResult.success) return;

    const importer = new RbsImporter();
    const { song } = importer.convertToHyphonSong(parseResult.data);

    expect(song.songArrangement!.trakEvents!.length).toBe(4);
    expect(song.songArrangement!.trakParamEvents!.length).toBe(2);
    expect(song.songArrangement!.trakParamEvents!.every((e) => e.eventKind === 'paramChange')).toBe(true);
  });
});

describe('AutomationScheduler mixed TRAK stream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules only cutoff param events at sub-step ticks', () => {
    const ctx = { currentTime: 0 } as AudioContext;
    const mgr = makeOpen303Manager();
    const scheduler = new AutomationScheduler(ctx, mgr as any, { ppq: 24 });

    const events = [
      { tick: 0, trackIndex: 1, ctrlId: 0x01, value: 2, eventKind: 'patternSelect' as const },
      { tick: 48, trackIndex: 1, ctrlId: 0x03, value: 40, eventKind: 'paramChange' as const },
      { tick: 96, trackIndex: 1, ctrlId: 0x03, value: 100, eventKind: 'paramChange' as const },
    ];

    scheduler.scheduleFromTrakEvents(events, 120, 0, 0, 768);
    vi.runAllTimers();

    expect(mgr.scheduleParamAtTime).toHaveBeenCalledTimes(2);
    expect(mgr.scheduleParamAtTime).not.toHaveBeenCalledWith(
      'lead303',
      'setCutoff',
      expect.closeTo(2 / 127, 3),
      expect.any(Number),
    );
    expect(mgr.scheduleParamAtTime).toHaveBeenCalledWith(
      'lead303',
      'setCutoff',
      expect.closeTo(40 / 127, 3),
      expect.any(Number),
    );
  });
});

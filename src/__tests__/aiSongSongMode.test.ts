/**
 * AISongData v1.1 — the song block (`patterns` + `song` + `globals.stepCount`).
 *
 * Pins what an agent gets for writing an arrangement instead of one loop:
 * pattern slots per track, Song Mode measures, per-slot 303 knobs, and
 * pattern-local lanes tiled onto the song timeline. v1.0 files must import
 * byte-for-byte as they did before the block existed.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AISongImporter, parseAISongJSON, type AISongData } from '../importers/ai-song';
import { validateAISongData } from '../importers/ai-song/types';
import { primaryAITracks } from '../importers/ai-song/songBlock';
import { validateBeforeUpload } from '../services/ai-song-storage/validation';
import { AutomationScheduler } from '../audio/automation/AutomationScheduler';
import { resolveLaneTimeline } from '../audio/automation/laneResolver';
import type { Open303Manager } from '../engines/Open303Manager';
import { RbsExporter, hyphonSongFromSavedData } from '../importers/rbs/RbsExporter';
import { RbsParser } from '../importers/rbs/RbsParser';
import { TRAK_TRACK_INDEX } from '../importers/rbs/types';
import type { PartSequence, SavedSongData } from '../types';
import type { SongMeasure } from '../types/songMode';

const FIXTURE_DIR = resolve(process.cwd(), 'test-fixtures/ai-song');

function loadFixture(name: string): AISongData {
  const parsed = parseAISongJSON(readFileSync(resolve(FIXTURE_DIR, `${name}.json`), 'utf-8'));
  if (!parsed.success) throw new Error(parsed.error);
  return parsed.data;
}

function importSong(aiSong: AISongData): SavedSongData {
  const result = new AISongImporter().convert(aiSong);
  if (!result.success) throw new Error(`import failed: ${JSON.stringify(result.error)}`);
  return result.song;
}

function filledSteps(sequence: PartSequence | null | undefined): number[] {
  return (sequence?.steps ?? []).flatMap((note, step) => (note ? [step] : []));
}

function column(song: SavedSongData, track: keyof SongMeasure): (number | null)[] {
  return (song.songStructure as SongMeasure[]).map((measure) => measure[track]);
}

function slots(song: SavedSongData, track: string): (PartSequence | null)[] {
  return (song.trackStorage as Record<string, (PartSequence | null)[]>)[track];
}

/** Lane ids carry a timestamp; everything else must match byte for byte. */
function stableJson(value: unknown): string {
  return JSON.stringify(
    value,
    (key, v: unknown) =>
      key === 'id' && typeof v === 'string' && v.startsWith('auto_lane_') ? '<lane-id>' : v,
    2,
  ) + '\n';
}

function expectValidationError(aiSong: unknown, field: string, message?: string | RegExp) {
  const result = new AISongImporter().convert(aiSong as AISongData);
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error).toMatchObject({ type: 'VALIDATION_ERROR', field });
  if (message && result.error.type === 'VALIDATION_ERROR') {
    expect(result.error.message).toMatch(message);
  }
}

describe('v1.0 songs import exactly as before the song block', () => {
  it.each(['minimal', 'full'])('%s.json matches its recorded import', (name) => {
    const result = new AISongImporter().convert(loadFixture(name));
    const expected = readFileSync(resolve(FIXTURE_DIR, `expected/${name}.import.json`), 'utf-8');
    expect(stableJson(result)).toBe(expected);
  });

  it('rejects v1.1 fields in a v1.0 file instead of importing one loop', () => {
    const aiSong = loadFixture('minimal');
    expectValidationError({ ...aiSong, song: [{ kick: 'A' }] }, 'song', /meta\.version "1\.1"/);
    expectValidationError(
      { ...aiSong, globals: { ...aiSong.globals, stepCount: 16 } },
      'globals.stepCount',
      /meta\.version "1\.1"/,
    );
  });

  it('still rejects versions it does not know', () => {
    const aiSong = loadFixture('minimal');
    const result = new AISongImporter().convert({ ...aiSong, meta: { ...aiSong.meta, version: '1.2' as '1.1' } });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toEqual({ type: 'UNSUPPORTED_VERSION', version: '1.2' });
  });
});

describe('song-mode.json — patterns arranged into measures', () => {
  const aiSong = loadFixture('song-mode');

  it('validates, imports without warnings and passes the pre-upload check', () => {
    expect(validateAISongData(aiSong)).toEqual({ valid: true });
    const result = new AISongImporter().convert(aiSong);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.report.warnings).toEqual([]);
    expect(result.report.tracksConverted).toBe(6);
    expect(validateBeforeUpload(aiSong, result.song)).toBeNull();
  });

  it('writes the song meter and a v4 song with 32 slots per track', () => {
    const song = importSong(aiSong);
    expect(song.version).toBe(4);
    expect(song.stepCount).toBe(16);
    expect(song.tempo).toBe(132);
    for (const track of ['partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler']) {
      expect(slots(song, track), track).toHaveLength(32);
    }
  });

  it('gives each track its patterns in first-played order', () => {
    const song = importSong(aiSong);
    const partA = slots(song, 'partA');
    // groove, drop, break — the order synthA first plays them.
    expect(filledSteps(partA[0])).toEqual([0, 3, 6, 8, 11, 14]);
    expect(filledSteps(partA[1])).toEqual([0, 2, 4, 7, 8, 10, 12, 14]);
    expect(filledSteps(partA[2])).toEqual([0, 8]);
    expect(partA.slice(3).every((slot) => slot === null)).toBe(true);
    for (const slot of partA.slice(0, 3)) expect(slot?.steps).toHaveLength(16);

    const kick = slots(song, 'kick');
    expect(kick.slice(0, 3).map(filledSteps)).toEqual([[0, 4, 8, 12], [0, 4, 8, 12], [0, 4, 8, 12]]);
    expect(kick[3]).toBeNull();

    expect(filledSteps(slots(song, 'snare')[2])).toEqual([8, 10, 12, 13, 14, 15]);
    expect(slots(song, 'partB').every((slot) => slot === null)).toBe(true);
    expect(slots(song, 'sampler').every((slot) => slot === null)).toBe(true);
  });

  it('writes one Song Mode measure per row, silent where a track is missing', () => {
    const song = importSong(aiSong);
    expect(song.songStructure).toHaveLength(10);
    for (const measure of song.songStructure as SongMeasure[]) {
      expect(Object.keys(measure).sort()).toEqual(
        ['bass2', 'closedHat', 'kick', 'openHat', 'partA', 'partB', 'sampler', 'snare'],
      );
    }
    expect(column(song, 'partA')).toEqual([null, null, 0, 0, 1, 1, 2, 1, 0, null]);
    expect(column(song, 'bass2')).toEqual([null, null, null, null, 0, 0, null, 0, null, null]);
    expect(column(song, 'kick')).toEqual([0, 0, 1, 1, 2, 2, null, 2, 0, 0]);
    expect(column(song, 'closedHat')).toEqual([0, 0, 1, 1, 1, 1, null, 1, 0, null]);
    expect(column(song, 'partB').every((v) => v === null)).toBe(true);
    expect(song.activeTrackSlots).toEqual({
      partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0,
    });
    // The live pattern is each track's first slot.
    expect(filledSteps(song.pattern.partA)).toEqual(filledSteps(slots(song, 'partA')[0]));
    expect(song.pattern.kick.steps).toHaveLength(16);
  });

  it('stores per-slot 303 knobs for a track whose patterns change them', () => {
    const song = importSong(aiSong);
    expect(song.params.synthA.filterCutoff).toBe(900);

    const storage = song.trackParamStorage!;
    expect(storage).toBeDefined();
    expect(storage.synthA).toHaveLength(32);
    expect(storage.synthA[0]).toMatchObject({ waveform: '303-saw', filterCutoff: 900, filterResonance: 12 });
    expect(storage.synthA[1]).toMatchObject({ waveform: '303-sqr', filterCutoff: 2400, filterResonance: 18, decay: 0.6 });
    // "break" declares no params: recalling it returns to the song's params.
    expect(storage.synthA[2]).toEqual(storage.synthA[0]);
    expect(storage.synthA.slice(3).every((slot) => slot === null)).toBe(true);
    // bass2 plays one pattern: nothing to recall.
    expect(storage.bass2.every((slot) => slot === null)).toBe(true);
    expect(storage.synthB.every((slot) => slot === null)).toBe(true);
    expect(song.params.bass2?.cutoff).toBe(600);
  });

  it('tiles the pattern-local cutoff lane across every measure that plays "drop"', () => {
    const song = importSong(aiSong);
    const lanes = song.automationLanes ?? [];
    expect(lanes).toHaveLength(1);
    const [lane] = lanes;
    expect(lane).toMatchObject({
      target: 'synthA', parameter: 'filterCutoff', interpolation: 'linear',
      source: 'ai', scope: 'song', timeline: 'song', enabled: true, originalRange: [0, 127],
    });

    const authored = aiSong.patterns!.drop.automation![0].steps;
    const at = new Map(lane.points.map((p) => [p.step, p.value]));
    for (const measure of [4, 5, 7]) {
      authored.forEach((value, step) => {
        if (value === null) return;
        expect(at.get(measure * 16 + step), `measure ${measure} step ${step}`).toBeCloseTo(value / 127, 6);
      });
    }
    // 5 authored points × 3 occurrences, plus one hold across the break (measure 6).
    expect(lane.points).toHaveLength(16);
    expect(at.get(7 * 16 - 1)).toBeCloseTo(60 / 127, 6);
    const steps = lane.points.map((p) => p.step);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it('plays the tiled lane at the song position in Song Mode', () => {
    const song = importSong(aiSong);
    const lanes = song.automationLanes ?? [];
    const timeline = resolveLaneTimeline(lanes, { totalSteps: 160, stepCount: 16, songMode: true });
    const cutoffAt = (g: number) => timeline[g].find((v) => v.lane.parameter === 'filterCutoff')?.value;

    expect(cutoffAt(4 * 16 + 12)).toBe(1);
    expect(cutoffAt(5 * 16 + 4)).toBeCloseTo(50 / 127, 6);
    // The break holds where the drop ended; the drop starts its sweep again after.
    expect(cutoffAt(6 * 16 + 8)).toBeCloseTo(60 / 127, 6);
    expect(cutoffAt(7 * 16)).toBeCloseTo(20 / 127, 6);
  });

  describe('live scheduler', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function scheduledCutoff(fromSongStep: number | undefined): number[] {
      const mgr = {
        isBass1Ready: vi.fn(() => true),
        isBass2Ready: vi.fn(() => true),
        isLead303Ready: vi.fn(() => true),
        scheduleParamAtTime: vi.fn(),
        scheduleParamRamp: vi.fn(),
        scheduleSlideAtTime: vi.fn(),
      };
      const scheduler = new AutomationScheduler(
        { currentTime: 0 } as unknown as AudioContext,
        mgr as unknown as Open303Manager,
      );
      scheduler.scheduleFromLanes(importSong(aiSong).automationLanes ?? [], 12, 1, 0.125, 0, fromSongStep);
      vi.runAllTimers();
      return (mgr.scheduleParamAtTime.mock.calls as [string, string, number, number][])
        .filter(([voice, setter]) => voice === 'lead303' && setter === 'setCutoff')
        .map(([, , value]) => value);
    }

    it('reads a song-timeline lane at the song step it is given', () => {
      // Pattern step 12 of measure 4 is the peak of the sweep.
      expect(scheduledCutoff(4 * 16 + 12)).toEqual([1]);
      // Without a song position (pattern mode) the lane plays its first measure.
      expect(scheduledCutoff(undefined)[0]).toBeCloseTo(20 / 127, 6);
    });
  });

  it('exports pattern-select TRAK events in song order to .rbs', async () => {
    const song = importSong(aiSong);
    const hyphon = hyphonSongFromSavedData(song, { isSongModeActive: true });
    expect(hyphon.songArrangement?.mode).toBe('song');

    const { bytes, warnings } = new RbsExporter({ mode: 'song', tb303BSource: 'bass2' }).exportToBytes(hyphon);
    expect(warnings.some((w) => w.includes('writing pattern mode'))).toBe(false);

    const parsed = await new RbsParser().parseBytes(bytes);
    expect(parsed.success).toBe(true);
    if (!parsed.success || !parsed.data.songData) return;
    expect(parsed.data.songData.glob.playMode).toBe(1);

    const selects = (trackIndex: number) =>
      parsed.data.songData!.tracks
        .find((t) => t.trackIndex === trackIndex)
        ?.events.filter((e) => e.eventKind === 'patternSelect')
        .map((e) => e.value);
    // synthA: groove → drop → break → drop → groove.
    expect(selects(TRAK_TRACK_INDEX.TB303_1)).toEqual([0, 1, 2, 1, 0]);
    // kick (the drum machine's pattern select): intro → groove → drop → intro.
    expect(selects(TRAK_TRACK_INDEX.TR808)).toEqual([0, 1, 2, 0]);
  });
});

describe('v1.1 with top-level tracks is one pattern, one measure', () => {
  it.each(['minimal', 'full'])('%s.json as v1.1 keeps its pattern and lanes', (name) => {
    const v10 = loadFixture(name);
    const v11: AISongData = { ...v10, meta: { ...v10.meta, version: '1.1' } };
    const before = importSong(v10);
    const after = importSong(v11);

    expect(after.version).toBe(4);
    expect(after.stepCount).toBe(32);
    expect(after.songStructure).toEqual([
      { partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0 },
    ]);
    expect(after.pattern).toEqual(before.pattern);
    expect(after.params).toEqual(before.params);
    expect(after.trackParamStorage).toBeUndefined();
    expect(slots(after, 'partA')[0]).toEqual(before.pattern.partA);
    expect(stableJson(after.automationLanes)).toBe(stableJson(before.automationLanes));
    expect(primaryAITracks(v11)).toBe(v11.tracks);
  });
});

describe('v1.1 validation names the offending path', () => {
  const base = loadFixture('song-mode');
  const withSong = (song: unknown): unknown => ({ ...base, song });

  it('rejects an unknown pattern id', () => {
    const rows = structuredClone(base.song!);
    rows[3] = { ...rows[3], bass2: 'chorus' };
    expectValidationError(withSong(rows), 'song[3].bass2', /Unknown pattern id "chorus"/);
  });

  it('rejects an unknown track name in a row', () => {
    expectValidationError(withSong([{ lead: 'drop' }]), 'song[0].lead', /Unknown track "lead"/);
  });

  it('rejects more than 32 distinct patterns on one track', () => {
    const patterns: AISongData['patterns'] = {};
    const rows: AISongData['song'] = [];
    for (let i = 0; i < 33; i++) {
      patterns[`p${i}`] = { tracks: { kick: [true] } };
      rows.push({ kick: `p${i}` });
    }
    expectValidationError({ ...base, patterns, song: rows }, 'song[32].kick', /more than 32 distinct patterns/);
  });

  it('rejects a pattern lane that is not stepCount long', () => {
    const aiSong = structuredClone(base);
    aiSong.patterns!.drop.automation![0].steps.push(10);
    expectValidationError(
      aiSong,
      'patterns.drop.automation[0].steps',
      'steps length (17) must match globals.stepCount (16)',
    );
  });

  it('applies the default stepCount (32) to lanes when none is declared', () => {
    const aiSong = structuredClone(base);
    delete aiSong.globals.stepCount;
    expectValidationError(aiSong, 'patterns.drop.automation[0].steps', /globals\.stepCount \(32\)/);
  });

  it('rejects an out-of-range stepCount', () => {
    expectValidationError({ ...base, globals: { ...base.globals, stepCount: 65 } }, 'globals.stepCount');
  });

  it('rejects tracks and patterns together, and patterns without a song', () => {
    expectValidationError({ ...base, tracks: {} }, 'patterns', /either tracks/);
    expectValidationError({ ...base, song: undefined }, 'song', /song array required/);
    expectValidationError(withSong([]), 'song', /non-empty/);
  });

  it('rejects a song-wide lane that would shadow a pattern lane', () => {
    const lane = structuredClone(base.patterns!.drop.automation![0]);
    expectValidationError({ ...base, automation: [lane] }, 'patterns.drop.automation[0]', /already automated song-wide/);
  });
});

describe('v1.1 warnings', () => {
  it('reports patterns the song never plays and tracks a pattern does not have', () => {
    const aiSong = structuredClone(loadFixture('song-mode'));
    aiSong.patterns!.unused = { tracks: { kick: [true] } };
    aiSong.song!.push({ bass2: 'intro' });

    const result = new AISongImporter().convert(aiSong);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.report.warnings).toEqual(expect.arrayContaining([
      'patterns.unused is never played by song — skipped.',
      'song plays pattern intro on bass2, but pattern intro has no bass2 track — silent.',
    ]));
  });

  it('labels note warnings with the pattern they came from', () => {
    const aiSong = structuredClone(loadFixture('song-mode'));
    aiSong.patterns!.groove.tracks.synthA!.notes.push({ step: 20, note: 'C2' });

    const result = new AISongImporter().convert(aiSong);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.report.warnings).toContain('Note step 20 out of range in patterns.groove.synthA');
  });
});

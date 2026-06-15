/**
 * Tests for IFF CAT RB40 chunk parser enhancement (#671).
 * Tests both the full IFF path and ensures no regression on legacy path.
 */
import { describe, expect, it } from 'vitest';
import { RbsParser } from '../importers/rbs/RbsParser';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import { RebirthRBSParser } from '../importers/rbs/RebirthRBSParser';
import { TICKS_PER_BAR, TICKS_PER_STEP } from '../importers/rbs/types';
import { buildSyntheticIffFile } from './rbs/fixtures';

describe('RbsParser IFF CAT RB40', () => {
  it('parses synthetic IFF CAT RB40 song file with GLOB and TRAK data', async () => {
    const bytes = buildSyntheticIffFile();
    const file = new File([bytes], 'test_song.rbs', { type: 'application/octet-stream' });
    const parser = new RbsParser();

    const result = await parser.parseRbsFile(file);
    expect(result.success).toBe(true);
    if (!result.success) return;

    // Should have songData populated
    expect(result.data.songData).toBeDefined();
    const songData = result.data.songData!;

    // GLOB fields
    expect(songData.glob.playMode).toBe(1);
    expect(songData.glob.tempo).toBeCloseTo(135, 0);
    expect(songData.glob.shuffle).toBe(70);
    expect(songData.glob.loopStart).toBe(0);
    expect(songData.glob.loopEnd).toBe(8);

    // TRAK events
    expect(songData.tracks.length).toBeGreaterThanOrEqual(1);
    const track = songData.tracks[0];
    expect(track.eventCount).toBe(4);
    expect(track.events[0].controllerId).toBe(0); // pattern select
    expect(track.events[0].value).toBe(0);
    expect(track.events[1].absoluteTicks).toBe(768);
    expect(track.events[1].value).toBe(1);

    // Song statistics
    expect(songData.totalLengthBars).toBeGreaterThanOrEqual(3);
    expect(songData.usedPatternCount).toBe(3); // patterns 0, 1, 2
  });

  it('parses pattern mode IFF file correctly', async () => {
    const bytes = buildSyntheticIffFile({ playMode: 0, trakEvents: [] });
    const file = new File([bytes], 'pattern_mode.rbs', { type: 'application/octet-stream' });
    const parser = new RbsParser();

    const result = await parser.parseRbsFile(file);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.songData).toBeDefined();
    expect(result.data.songData!.glob.playMode).toBe(0);
  });

  it('tempo is correctly parsed from GLOB (BPM × 10 encoding)', async () => {
    const bytes = buildSyntheticIffFile({ tempo: 1200 }); // 120.0 BPM
    const file = new File([bytes], 'tempo_test.rbs', { type: 'application/octet-stream' });
    const parser = new RbsParser();

    const result = await parser.parseRbsFile(file);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.songData!.glob.tempo).toBeCloseTo(120, 0);
    expect(result.data.project.tempo).toBeCloseTo(120, 0);
  });
});

describe('RebirthRBSParser song arrangement', () => {
  it('returns song arrangement with pattern slots from TRAK events', async () => {
    const bytes = buildSyntheticIffFile();
    const file = new File([bytes], 'song_arrangement.rbs', { type: 'application/octet-stream' });
    const rbsParser = new RebirthRBSParser();

    const result = await rbsParser.parseFile(file);
    expect(result.success).toBe(true);

    const arrangement = result.arrangement!;
    expect(arrangement.mode).toBe('song');
    expect(arrangement.patternSlots.length).toBeGreaterThan(0);
    // First event selects pattern 0
    expect(arrangement.patternSlots[0].patternIndex).toBe(0);
  });

  it('returns pattern mode for files without song arrangement', async () => {
    const bytes = buildSyntheticIffFile({ playMode: 0, trakEvents: [] });
    const file = new File([bytes], 'pattern_only.rbs', { type: 'application/octet-stream' });
    const rbsParser = new RebirthRBSParser();

    const result = await rbsParser.parseFile(file);
    expect(result.success).toBe(true);

    const arrangement = result.arrangement!;
    expect(arrangement.mode).toBe('pattern');
  });
});

describe('RbsImporter song mode', () => {
  it('populates songArrangement in HyphonSong when songData is present', async () => {
    const bytes = buildSyntheticIffFile();
    const file = new File([bytes], 'import_song.rbs', { type: 'application/octet-stream' });
    const parser = new RbsParser();

    const result = await parser.parseRbsFile(file);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const importer = new RbsImporter();
    const converted = importer.convertToHyphonSong(result.data);
    expect(converted.success).toBe(true);

    const song = converted.song;
    expect(song.songArrangement).toBeDefined();
    expect(song.songArrangement!.mode).toBe('song');
    expect(song.songArrangement!.songStructure.length).toBeGreaterThan(0);
    expect(song.songArrangement!.trackStorage.partA.length).toBe(8);
    expect(song.songArrangement!.trakEvents).toBeDefined();
    expect(song.songArrangement!.trakEvents!.length).toBe(4);
  });

  it('report includes song mode info when songData is present', async () => {
    const bytes = buildSyntheticIffFile();
    const file = new File([bytes], 'report_song.rbs', { type: 'application/octet-stream' });
    const parser = new RbsParser();

    const result = await parser.parseRbsFile(file);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const importer = new RbsImporter();
    const converted = importer.convertToHyphonSong(result.data);

    expect(converted.report.songMode).toBeDefined();
    expect(converted.report.songMode!.isSongMode).toBe(true);
    expect(converted.report.songMode!.arrangementEventCount).toBe(4);
    expect(converted.report.songMode!.usedPatternCount).toBe(3);
    expect(converted.report.songMode!.songLengthBars).toBeGreaterThanOrEqual(3);
  });

  it('does not populate songArrangement for legacy single-pattern files', async () => {
    // Create a non-IFF file (legacy path)
    const parser = new RbsParser();
    const mockData = parser.generateMockData('legacy.rbs');

    const importer = new RbsImporter();
    const converted = importer.convertToHyphonSong(mockData);
    expect(converted.success).toBe(true);
    expect(converted.song.songArrangement).toBeUndefined();
    expect(converted.report.songMode).toBeUndefined();
  });
});

describe('IFF constants', () => {
  it('TICKS_PER_BAR is 768', () => {
    expect(TICKS_PER_BAR).toBe(768);
  });

  it('TICKS_PER_STEP is 48', () => {
    expect(TICKS_PER_STEP).toBe(48);
  });
});

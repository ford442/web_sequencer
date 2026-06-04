/**
 * Tests for IFF CAT RB40 chunk parser enhancement (#671).
 * Tests both the full IFF path and ensures no regression on legacy path.
 */
import { describe, expect, it } from 'vitest';
import { RbsParser } from '../importers/rbs/RbsParser';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import { RebirthRBSParser } from '../importers/rbs/RebirthRBSParser';
import { TICKS_PER_BAR, TICKS_PER_STEP } from '../importers/rbs/types';

/**
 * Build a synthetic IFF CAT RB40 file with GLOB + TRKL data.
 * This mimics the structure of a real ReBirth v2.0 song file.
 */
function buildSyntheticIffFile(options: {
  playMode?: 0 | 1;
  tempo?: number;
  shuffle?: number;
  loopStart?: number;
  loopEnd?: number;
  trakEvents?: Array<{ delta: number; ctrl: number; value: number }>;
} = {}): Uint8Array<ArrayBuffer> {
  const {
    playMode = 1,
    tempo = 1350, // 135.0 BPM × 10
    shuffle = 70,
    loopStart = 0,
    loopEnd = 8,
    trakEvents = [
      { delta: 0, ctrl: 0, value: 0 },      // pattern 0 at start
      { delta: 768, ctrl: 0, value: 1 },     // pattern 1 at bar 1
      { delta: 768, ctrl: 0, value: 2 },     // pattern 2 at bar 2
      { delta: 768, ctrl: 0, value: 0 },     // pattern 0 at bar 3
    ],
  } = options;

  const parts: Uint8Array[] = [];

  // Helper to write big-endian uint32
  function writeU32BE(val: number): Uint8Array {
    const buf = new Uint8Array(4);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, val, false);
    return buf;
  }

  // Helper to write little-endian uint16
  function writeU16LE(val: number): Uint8Array {
    const buf = new Uint8Array(2);
    const dv = new DataView(buf.buffer);
    dv.setUint16(0, val, true);
    return buf;
  }

  // Helper to write little-endian uint32
  function writeU32LE(val: number): Uint8Array {
    const buf = new Uint8Array(4);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, val, true);
    return buf;
  }

  // Build HEAD chunk (256 bytes)
  const headPayload = new Uint8Array(256);
  const headStr = 'ReBirth RB-338 v2.0';
  for (let i = 0; i < headStr.length; i++) {
    headPayload[i] = headStr.charCodeAt(i);
  }

  // Build GLOB chunk (512 bytes)
  const globPayload = new Uint8Array(512);
  globPayload[0] = playMode;
  // tempo at offset 2 (uint16 LE)
  const tempoBuf = writeU16LE(tempo);
  globPayload[2] = tempoBuf[0];
  globPayload[3] = tempoBuf[1];
  globPayload[4] = shuffle;
  // loop start at offset 6 (uint16 LE)
  const lsBuf = writeU16LE(loopStart);
  globPayload[6] = lsBuf[0];
  globPayload[7] = lsBuf[1];
  // loop end at offset 8 (uint16 LE)
  const leBuf = writeU16LE(loopEnd);
  globPayload[8] = leBuf[0];
  globPayload[9] = leBuf[1];

  // Build TRAK chunk: uint32 event_count (LE) + events (uint16 delta LE + uint8 ctrl + uint8 value)
  const trakPayloadSize = 4 + trakEvents.length * 4;
  const trakPayload = new Uint8Array(trakPayloadSize);
  const trakDv = new DataView(trakPayload.buffer);
  trakDv.setUint32(0, trakEvents.length, true);
  for (let i = 0; i < trakEvents.length; i++) {
    const offset = 4 + i * 4;
    trakDv.setUint16(offset, trakEvents[i].delta, true);
    trakPayload[offset + 2] = trakEvents[i].ctrl;
    trakPayload[offset + 3] = trakEvents[i].value;
  }

  // Build nested CAT TRKL (contains TRAK chunks)
  // Layout: "CAT " + size (BE) + "TRKL" + ("TRAK" + size (BE) + payload)
  const trklFormType = new TextEncoder().encode('TRKL');
  const trakChunkId = new TextEncoder().encode('TRAK');
  const trakChunkWithHeader = new Uint8Array(8 + trakPayload.length);
  trakChunkWithHeader.set(trakChunkId, 0);
  const trakSizeBuf = writeU32BE(trakPayload.length);
  trakChunkWithHeader.set(trakSizeBuf, 4);
  trakChunkWithHeader.set(trakPayload, 8);

  const trklInnerSize = 4 + trakChunkWithHeader.length; // formType + TRAK chunk
  const trklChunk = new Uint8Array(8 + trklInnerSize);
  trklChunk.set(new TextEncoder().encode('CAT '), 0);
  const trklSizeBuf = writeU32BE(trklInnerSize);
  trklChunk.set(trklSizeBuf, 4);
  trklChunk.set(trklFormType, 8);
  trklChunk.set(trakChunkWithHeader, 12);

  // Assemble top-level: "CAT " + rootSize (BE) + "RB40" + HEAD + GLOB + CAT TRKL
  const headChunk = new Uint8Array(8 + headPayload.length);
  headChunk.set(new TextEncoder().encode('HEAD'), 0);
  headChunk.set(writeU32BE(headPayload.length), 4);
  headChunk.set(headPayload, 8);

  const globChunk = new Uint8Array(8 + globPayload.length);
  globChunk.set(new TextEncoder().encode('GLOB'), 0);
  globChunk.set(writeU32BE(globPayload.length), 4);
  globChunk.set(globPayload, 8);

  const rootPayloadSize = 4 + headChunk.length + globChunk.length + trklChunk.length; // "RB40" + chunks
  const totalSize = 8 + rootPayloadSize; // "CAT " + size + payload
  const file = new Uint8Array(totalSize);
  let pos = 0;

  // Root header
  file.set(new TextEncoder().encode('CAT '), pos); pos += 4;
  file.set(writeU32BE(rootPayloadSize), pos); pos += 4;
  file.set(new TextEncoder().encode('RB40'), pos); pos += 4;

  // HEAD chunk
  file.set(headChunk, pos); pos += headChunk.length;

  // GLOB chunk
  file.set(globChunk, pos); pos += globChunk.length;

  // CAT TRKL chunk
  file.set(trklChunk, pos); pos += trklChunk.length;

  return file;
}

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

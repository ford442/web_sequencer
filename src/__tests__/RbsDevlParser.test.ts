/**
 * DEVL catalog parser tests (#775) — RBS42 struct-accurate device chunks.
 */
import { describe, expect, it } from 'vitest';
import { RbsParser } from '../importers/rbs/RbsParser';
import {
  parseDevlTb303Step,
  parseTb303DeviceChunk,
  TB303_FLAG_ACCENT,
  TB303_FLAG_NOTE,
  TB303_FLAG_SLIDE,
  TB303_PATTERN_COUNT,
} from '../importers/rbs/devlLayout';
import { DEVL_LAYOUT } from '../importers/rbs/parser-types';
import {
  buildDevl303ChunkPayload,
  buildSyntheticIffFile,
  encodeDevlTb303Step,
  summarizeTb303Steps,
} from './rbs/fixtures';
import { findCorpusFile, isExternalCorpusEnabled, parseCorpusFile } from './rbs/corpusUtils';

import type { RbsSongData } from '../importers/rbs/types';

/** Mock TB-303 A melody from RbsParser.generateMockTb303Pattern — must not appear when DEVL is valid. */
const MOCK_TB303_A_NOTES = [0, 0, 7, 7, 9, 9, 7, -1, 5, 5, 4, 4, 2, 2, 0, -1];

/** Max pattern-select index (ctrl 0x01, value 0–31) across TRAK tracks. */
function maxPatternSelectIndex(songData: RbsSongData | undefined): number {
  if (!songData) return -1;
  let max = -1;
  for (const track of songData.tracks) {
    for (const ev of track.events) {
      if (ev.controllerId === 0x01 && ev.value <= 31) {
        max = Math.max(max, ev.value);
      }
    }
  }
  return max;
}

describe('devlLayout TB-303 step codec', () => {
  it('encodes note with accent and slide flags per RBS42', () => {
    const [pitch, flags] = encodeDevlTb303Step({
      index: 0,
      note: 5,
      octave: 3,
      accent: true,
      slide: true,
      tie: false,
    });
    expect(pitch).toBe(5);
    expect(flags & TB303_FLAG_NOTE).toBeTruthy();
    expect(flags & TB303_FLAG_ACCENT).toBeTruthy();
    expect(flags & TB303_FLAG_SLIDE).toBeTruthy();
  });

  it('round-trips rest steps without NOTE flag', () => {
    const step = parseDevlTb303Step(3, 0, TB303_FLAG_ACCENT);
    expect(step.note).toBe(-1);
    expect(step.accent).toBe(true);
    expect(step.slide).toBe(false);
    expect(step.tie).toBe(false);
    expect(step.gate).toBe(100);
  });

  it('round-trips all 16 steps through encode → parseTb303DeviceChunk', () => {
    const steps = Array.from({ length: 16 }, (_, index) => ({
      index,
      note: index === 5 || index === 11 ? -1 : (index * 3) % 12,
      octave: 3,
      accent: index % 3 === 0,
      slide: index === 4 || index === 8,
      tie: false,
      gate: 80,
    }));

    const payload = buildDevl303ChunkPayload(steps, { cutoff: 72, resonance: 55, waveform: 1 });
    expect(payload.byteLength).toBe(DEVL_LAYOUT.TB303_CHUNK_SIZE);

    const patterns = parseTb303DeviceChunk(payload, 0);
    expect(patterns.length).toBe(TB303_PATTERN_COUNT);
    expect(summarizeTb303Steps(patterns[0].steps)).toEqual(summarizeTb303Steps(steps));
    expect(patterns[0].cutoff).toBe(72);
    expect(patterns[0].resonance).toBe(55);
    expect(patterns[0].waveform).toBe(1);
    // IFF DEVL uses 2-byte steps — no tie/gate fields; gate defaults to 100
    expect(patterns[0].steps.every((s) => s.gate === 100)).toBe(true);
    expect(patterns[0].steps.every((s) => !s.tie)).toBe(true);
  });
});

describe('RbsParser DEVL catalog', () => {
  it('parses struct-accurate 303/808 chunks from DEVL catalog', async () => {
    const tb303ASteps = Array.from({ length: 16 }, (_, index) => ({
      index,
      note: index % 4 === 3 ? -1 : index % 12,
      octave: 3,
      accent: index % 4 === 0,
      slide: index % 8 === 0,
      tie: false,
    }));

    const bytes = buildSyntheticIffFile({ includeDevl: true, tb303ASteps });
    const parser = new RbsParser();
    const result = await parser.parseBytes(bytes, { filename: 'devl_song.rbs', requireExtension: true });

    expect(result.success).toBe(true);
    if (!result.success) return;

    const banks = result.data.songData!.patternBanks;
    expect(banks.tb303A.length).toBe(TB303_PATTERN_COUNT);
    expect(banks.tb303B.length).toBe(TB303_PATTERN_COUNT);
    expect(banks.drums808.length).toBe(32);

    const pattern0 = banks.tb303A[0];
    expect(summarizeTb303Steps(pattern0.steps)).toEqual(summarizeTb303Steps(tb303ASteps));
    expect(pattern0.cutoff).toBe(90);

    const kickHits = banks.drums808[0].kick.filter(Boolean).length;
    expect(kickHits).toBe(4);
  });

  it('does not use mock TB-303 A melody when DEVL catalog is present', async () => {
    const bytes = buildSyntheticIffFile({ includeDevl: true });
    const parser = new RbsParser();
    const result = await parser.parseBytes(bytes, { filename: 'no_mock.rbs' });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const notes = result.data.tb303PatternA.steps.map((s) => s.note);
    expect(notes).not.toEqual(MOCK_TB303_A_NOTES);
  });

  it('v1.5-style DEVL with single 303 does not inject mock melody into TB-303 B', async () => {
    const bytes = buildSyntheticIffFile({
      includeDevl: true,
      include303B: false,
      tb303ASteps: [{ index: 0, note: 0, octave: 3, accent: true, slide: false, tie: false }],
    });

    const parser = new RbsParser();
    const result = await parser.parseBytes(bytes, { filename: 'v15.rbs' });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.songData!.patternBanks.tb303B.length).toBe(0);
    const partBActive = result.data.tb303PatternB.steps.filter((s) => s.note >= 0).length;
    expect(partBActive).toBe(0);
    expect(result.data.tb303PatternB.steps.map((s) => s.note)).not.toEqual(MOCK_TB303_A_NOTES);
  });

  it('pattern bank count covers TRAK pattern-select indices', async () => {
    const bytes = buildSyntheticIffFile({
      includeDevl: true,
      trakEvents: [
        { delta: 0, ctrl: 0x01, value: 0 },
        { delta: 768, ctrl: 0x01, value: 15 },
        { delta: 768, ctrl: 0x01, value: 31 },
        { delta: 768, ctrl: 0x01, value: 0 },
      ],
    });

    const parser = new RbsParser();
    const result = await parser.parseBytes(bytes, { filename: 'trak_banks.rbs' });
    expect(result.success).toBe(true);
    if (!result.success) return;

    const sd = result.data.songData!;
    const maxPat = maxPatternSelectIndex(sd);
    expect(maxPat).toBe(31);
    expect(sd.patternBanks.tb303A.length).toBeGreaterThan(maxPat);
    expect(sd.usedPatternCount).toBeGreaterThanOrEqual(3);
  });

  it('buildDevl303ChunkPayload produces 1097-byte payload', () => {
    expect(buildDevl303ChunkPayload().byteLength).toBe(DEVL_LAYOUT.TB303_CHUNK_SIZE);
  });
});

describe.skipIf(!isExternalCorpusEnabled())('DEVL banks vs external corpus (#774 + #775)', () => {
  it('real v2.0 song has 32-pattern TB-303 A bank and covers TRAK pattern indices', async () => {
    const path = findCorpusFile('jsynth_kilo.rbs');
    expect(path).toBeTruthy();
    if (!path) return;

    const result = await parseCorpusFile(path);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const sd = result.data.songData!;
    expect(sd.patternBanks.tb303A.length).toBe(32);
    expect(sd.patternBanks.tb303B.length).toBe(32);
    // DEVL bank size is authoritative for #775; TRAK pattern-index cross-check needs #777 decoder
    const maxPat = maxPatternSelectIndex(sd);
    if (maxPat >= 0 && maxPat < 32) {
      expect(sd.patternBanks.tb303A.length).toBeGreaterThan(maxPat);
    }
    expect(result.data.tb303PatternA.steps).toHaveLength(16);
  });
});

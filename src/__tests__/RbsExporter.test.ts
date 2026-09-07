/**
 * RBS Exporter tests — export → parse → structural round-trip.
 */
import { describe, expect, it } from 'vitest';
import { RbsParser } from '../importers/rbs/RbsParser';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import { RbsExporter, hyphonSongFromSavedData, shouldExportRbsSongMode } from '../importers/rbs/RbsExporter';
import { parseTb303DeviceChunk, parseTr808DeviceChunk } from '../importers/rbs/devlLayout';
import { buildSyntheticIffFile } from './rbs/fixtures';
import type { Tb303Step } from '../importers/rbs/types';
import { TRAK_TRACK_INDEX } from '../importers/rbs/types';

function findIffChunk(bytes: Uint8Array, id: string): Uint8Array | null {
  let pos = 12;
  while (pos + 8 <= bytes.length) {
    const chunkId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const size = new DataView(bytes.buffer, bytes.byteOffset + pos + 4, 4).getUint32(0, false);
    if (chunkId === id) {
      return bytes.slice(pos + 8, pos + 8 + size);
    }
    pos += 8 + size + (size % 2);
  }
  return null;
}

function findNestedCatPayload(bytes: Uint8Array, formType: string): Uint8Array | null {
  let pos = 12;
  while (pos + 12 <= bytes.length) {
    const chunkId = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const size = new DataView(bytes.buffer, bytes.byteOffset + pos + 4, 4).getUint32(0, false);
    if (chunkId === 'CAT ') {
      const innerForm = String.fromCharCode(bytes[pos + 8], bytes[pos + 9], bytes[pos + 10], bytes[pos + 11]);
      if (innerForm === formType) {
        return bytes.slice(pos, pos + 8 + size);
      }
    }
    pos += 8 + size + (size % 2);
  }
  return null;
}

function extract303PatternsFromDevl(bytes: Uint8Array): Tb303Step[][] {
  const devlCat = findNestedCatPayload(bytes, 'DEVL');
  expect(devlCat).toBeTruthy();
  if (!devlCat) return [];

  const patterns: Tb303Step[][] = [];
  let pos = 12;
  const catEnd = devlCat.length;
  while (pos + 8 <= catEnd) {
    const chunkId = String.fromCharCode(devlCat[pos], devlCat[pos + 1], devlCat[pos + 2], devlCat[pos + 3]);
    const size = new DataView(devlCat.buffer, devlCat.byteOffset + pos + 4, 4).getUint32(0, false);
    if (chunkId === '303 ') {
      const payload = devlCat.slice(pos + 8, pos + 8 + size);
      const parsed = parseTb303DeviceChunk(payload, 0, payload.length);
      patterns.push(parsed[0]?.steps ?? []);
    }
    pos += 8 + size + (size % 2);
  }
  return patterns;
}

describe('RbsExporter', () => {
  it('writes IFF CAT RB40 with HEAD and GLOB pattern mode', async () => {
    const importer = new RbsImporter({ expandTo32Steps: false });
    const parser = new RbsParser();
    const bytes = buildSyntheticIffFile({ includeDevl: true, playMode: 0, trakEvents: [] });
    const parsed = await parser.parseBytes(bytes);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const song = importer.convertToHyphonSong(parsed.data).song;
    const exporter = new RbsExporter();
    const { bytes: exported } = exporter.exportToBytes(song);

    expect(String.fromCharCode(...exported.slice(0, 4))).toBe('CAT ');
    expect(String.fromCharCode(...exported.slice(8, 12))).toBe('RB40');

    const head = findIffChunk(exported, 'HEAD');
    expect(head).toBeTruthy();
    const headStr = new TextDecoder().decode(head!).slice(0, 24);
    expect(headStr).toContain('ReBirth RB-338 v2.0');

    const glob = findIffChunk(exported, 'GLOB');
    expect(glob).toBeTruthy();
    expect(glob![0]).toBe(0); // pattern mode
  });

  it('round-trips TB-303 steps and static knob values through export → import', async () => {
    const sourceBytes = buildSyntheticIffFile({
      includeDevl: true,
      playMode: 0,
      trakEvents: [],
      tempo: 128_000,
    });
    const parser = new RbsParser();
    const sourceParsed = await parser.parseBytes(sourceBytes);
    expect(sourceParsed.success).toBe(true);
    if (!sourceParsed.success) return;

    const importer = new RbsImporter({ expandTo32Steps: false, tb303BTarget: 'partB' });
    const imported = importer.convertToHyphonSong(sourceParsed.data);
    expect(imported.success).toBe(true);

    const exporter = new RbsExporter({ tb303BSource: 'partB', collapse32Steps: true });
    const { bytes: exported } = exporter.exportToBytes(imported.song);

    const reParsed = await parser.parseBytes(exported);
    expect(reParsed.success).toBe(true);
    if (!reParsed.success) return;

    expect(reParsed.data.songData?.glob.playMode).toBe(0);
    expect(reParsed.data.project.tempo).toBeCloseTo(128, 0);

    const patterns = extract303PatternsFromDevl(exported);
    expect(patterns.length).toBeGreaterThanOrEqual(1);

    const sourceSteps = sourceParsed.data.tb303PatternA.steps;
    const exportedSteps = patterns[0];
    for (let i = 0; i < 16; i++) {
      expect(exportedSteps[i].note).toBe(sourceSteps[i].note);
      expect(exportedSteps[i].accent).toBe(sourceSteps[i].accent);
      expect(exportedSteps[i].slide).toBe(sourceSteps[i].slide);
    }
  });

  it('re-imports exported file without parser errors', async () => {
    const parser = new RbsParser();
    const importer = new RbsImporter();
    const source = await parser.parseBytes(buildSyntheticIffFile({ includeDevl: true, playMode: 0, trakEvents: [] }));
    expect(source.success).toBe(true);
    if (!source.success) return;

    const song = importer.convertToHyphonSong(source.data).song;
    const { bytes } = new RbsExporter().exportToBytes(song);

    const file = new File([new Uint8Array(bytes)], 'roundtrip.rbs', { type: 'application/octet-stream' });
    const result = await parser.parseRbsFile(file);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const converted = importer.convertToHyphonSong(result.data);
    expect(converted.success).toBe(true);
    expect(converted.report.warnings.filter((w) => w.includes('truncat')).length).toBe(0);
  });

  it('emits warnings for unsupported Hyphon features', async () => {
    const parser = new RbsParser();
    const importer = new RbsImporter();
    const source = await parser.parseBytes(buildSyntheticIffFile({ includeDevl: true, playMode: 0, trakEvents: [] }));
    if (!source.success) return;

    const song = importer.convertToHyphonSong(source.data).song;
    song.pattern.sampler = Array.from({ length: 8 }, () => ({ steps: Array(16).fill({ note: 'C4', velocity: 1 }) }));

    const { warnings } = new RbsExporter().exportToBytes(song);
    expect(warnings.some((w) => w.includes('Sampler'))).toBe(true);
  });

  it('exports drum triggers in DEVL 808 chunk', async () => {
    const parser = new RbsParser();
    const importer = new RbsImporter({ drumKitMapping: '808' });
    const source = await parser.parseBytes(buildSyntheticIffFile({ includeDevl: true, playMode: 0, trakEvents: [] }));
    if (!source.success) return;

    const song = importer.convertToHyphonSong(source.data).song;
    const { bytes } = new RbsExporter({ drumKit: '808' }).exportToBytes(song);

    const devlCat = findNestedCatPayload(bytes, 'DEVL');
    expect(devlCat).toBeTruthy();
    if (!devlCat) return;

    let pos = 12;
    let drumPayload: Uint8Array | null = null;
    while (pos + 8 <= devlCat.length) {
      const chunkId = String.fromCharCode(devlCat[pos], devlCat[pos + 1], devlCat[pos + 2], devlCat[pos + 3]);
      const size = new DataView(devlCat.buffer, devlCat.byteOffset + pos + 4, 4).getUint32(0, false);
      if (chunkId === '808 ') {
        drumPayload = devlCat.slice(pos + 8, pos + 8 + size);
        break;
      }
      pos += 8 + size + (size % 2);
    }
    expect(drumPayload).toBeTruthy();
    if (!drumPayload) return;

    const drums = parseTr808DeviceChunk(drumPayload, 0, drumPayload.length);
    expect(drums[0].kick.filter(Boolean).length).toBeGreaterThan(0);
  });

  it('round-trips pattern mode export → import without song-mode downgrade warning', async () => {
    const parser = new RbsParser();
    const importer = new RbsImporter({ expandTo32Steps: false });
    const source = await parser.parseBytes(buildSyntheticIffFile({
      includeDevl: true,
      playMode: 0,
      trakEvents: [],
    }));
    expect(source.success).toBe(true);
    if (!source.success) return;

    const imported = importer.convertToHyphonSong(source.data);
    const { bytes, warnings } = new RbsExporter({ mode: 'pattern' }).exportToBytes(imported.song);
    expect(warnings.some((w) => w.includes('Song-mode TRAK export is not yet implemented'))).toBe(false);

    const reParsed = await parser.parseBytes(bytes);
    expect(reParsed.success).toBe(true);
    if (!reParsed.success) return;

    expect(reParsed.data.songData?.glob.playMode).toBe(0);
    expect(reParsed.data.project.tempo).toBeCloseTo(imported.song.tempo, 0);
  });

  it('round-trips song mode export → import with TRAK arrangement events', async () => {
    const parser = new RbsParser();
    const importer = new RbsImporter({ expandTo32Steps: false, tb303BTarget: 'partB' });
    const sourceBytes = buildSyntheticIffFile({
      includeDevl: true,
      playMode: 1,
      trakEvents: [
        { delta: 0, ctrl: 0x01, value: 0 },
        { delta: 768, ctrl: 0x01, value: 1 },
        { delta: 768, ctrl: 0x01, value: 2 },
        { delta: 768, ctrl: 0x01, value: 0 },
      ],
    });
    const sourceParsed = await parser.parseBytes(sourceBytes);
    expect(sourceParsed.success).toBe(true);
    if (!sourceParsed.success) return;

    const imported = importer.convertToHyphonSong(sourceParsed.data);
    expect(imported.song.songArrangement?.mode).toBe('song');

    const { bytes, warnings } = new RbsExporter({
      mode: 'song',
      tb303BSource: 'partB',
      collapse32Steps: true,
    }).exportToBytes(imported.song);

    expect(warnings.some((w) => w.includes('Song-mode TRAK export is not yet implemented'))).toBe(false);
    expect(warnings.some((w) => w.includes('writing pattern mode'))).toBe(false);

    const reParsed = await parser.parseBytes(bytes);
    expect(reParsed.success).toBe(true);
    if (!reParsed.success || !reParsed.data.songData) return;

    expect(reParsed.data.songData.glob.playMode).toBe(1);

    const tb303Track = reParsed.data.songData.tracks.find(
      (t) => t.trackIndex === TRAK_TRACK_INDEX.TB303_1,
    );
    expect(tb303Track).toBeDefined();
    expect(tb303Track!.events.length).toBe(4);

    const patternSelects = tb303Track!.events.filter((e) => e.eventKind === 'patternSelect');
    expect(patternSelects.map((e) => e.value)).toEqual([0, 1, 2, 0]);

    const reImported = importer.convertToHyphonSong(reParsed.data);
    expect(reImported.song.songArrangement?.mode).toBe('song');
    expect(reImported.song.songArrangement?.songStructure.length).toBeGreaterThanOrEqual(3);
  });

  it('round-trips v1.5 single-303 IFF export → import', async () => {
    const parser = new RbsParser();
    const importer = new RbsImporter({ expandTo32Steps: false });
    const source = await parser.parseBytes(buildSyntheticIffFile({
      includeDevl: true,
      playMode: 0,
      headVersionString: 'ReBirth RB-338 v1.5',
      include303B: false,
      trakEvents: [],
    }));
    expect(source.success).toBe(true);
    if (!source.success) return;

    const imported = importer.convertToHyphonSong(source.data);
    const { bytes } = new RbsExporter({
      mode: 'pattern',
      versionTarget: '1.5',
      include303B: false,
    }).exportToBytes(imported.song);

    const head = findIffChunk(bytes, 'HEAD');
    expect(head).toBeTruthy();
    const headStr = new TextDecoder().decode(head!).slice(0, 24);
    expect(headStr).toContain('ReBirth RB-338 v1.5');

    const reParsed = await parser.parseBytes(bytes);
    expect(reParsed.success).toBe(true);
    if (!reParsed.success) return;

    const patterns = extract303PatternsFromDevl(bytes);
    expect(patterns.length).toBeGreaterThanOrEqual(1);
    expect(reParsed.data.tb303PatternA.steps.length).toBe(16);
  });

  it('warns when song mode export is requested without arrangement data', async () => {
    const song = {
      version: 1 as const,
      metadata: { name: 'No Arrangement', importedFrom: 'rbs' as const, importedAt: new Date() },
      tempo: 120,
      timeSignature: [4, 4] as [number, number],
      swing: 64,
      pattern: {
        partA: { steps: Array(16).fill(null) },
        partB: { steps: Array(16).fill(null) },
        bass2: { steps: Array(16).fill(null) },
        kick: { steps: Array(16).fill(null) },
        snare: { steps: Array(16).fill(null) },
        closedHat: { steps: Array(16).fill(null) },
        openHat: { steps: Array(16).fill(null) },
        sampler: Array.from({ length: 8 }, () => ({ steps: Array(16).fill(null) })),
      },
      params: {
        synthA: { waveform: '303-saw', filterCutoff: 800, filterResonance: 0.5, decay: 0.3, volume: 0.8, pan: 0, filterMode: 0 } as any,
        synthB: { waveform: '303-saw', filterCutoff: 800, filterResonance: 0.5, decay: 0.3, volume: 0.8, pan: 0, filterMode: 0 } as any,
        kick: { pitch: 60, tone: 0.5, decay: 0.5, volume: 0.8 } as any,
        snare: { pitch: 200, tone: 0.5, decay: 0.3, volume: 0.8 } as any,
        closedHat: { pitch: 8000, tone: 0.5, decay: 0.1, volume: 0.6 } as any,
        openHat: { pitch: 7000, tone: 0.5, decay: 0.2, volume: 0.6 } as any,
      },
    };

    const { warnings } = new RbsExporter({ mode: 'song' }).exportToBytes(song);
    expect(warnings.some((w) => w.includes('no song arrangement'))).toBe(true);
  });

  it('builds song arrangement from SavedSongData and exports TRAK when mode is song', async () => {
    const parser = new RbsParser();
    const importer = new RbsImporter({ expandTo32Steps: false, tb303BTarget: 'partB' });
    const source = await parser.parseBytes(buildSyntheticIffFile({
      includeDevl: true,
      playMode: 1,
      trakEvents: [
        { delta: 0, ctrl: 0x01, value: 0 },
        { delta: 768, ctrl: 0x01, value: 1 },
      ],
    }));
    expect(source.success).toBe(true);
    if (!source.success) return;

    const imported = importer.convertToHyphonSong(source.data);
    const arrangement = imported.song.songArrangement!;
    const saved = {
      version: 3,
      pattern: imported.song.pattern,
      tempo: imported.song.tempo,
      params: imported.song.params,
      trackStorage: arrangement.trackStorage,
      activeTrackSlots: arrangement.activeTrackSlots ?? {},
      songStructure: arrangement.songStructure,
      rbsLoopStart: 0,
      rbsLoopEnd: 4,
    };

    const reconstructed = hyphonSongFromSavedData(saved as any, { isSongModeActive: true });
    expect(reconstructed.songArrangement?.mode).toBe('song');
    expect(shouldExportRbsSongMode(saved as any, true)).toBe(true);

    const { bytes, warnings } = new RbsExporter({ mode: 'song', tb303BSource: 'partB' })
      .exportToBytes(reconstructed);
    expect(warnings.some((w) => w.includes('writing pattern mode'))).toBe(false);

    const reParsed = await parser.parseBytes(bytes);
    expect(reParsed.success).toBe(true);
    if (!reParsed.success) return;
    expect(reParsed.data.songData?.glob.playMode).toBe(1);
  });

  it('exports 9 used pattern slots without truncating to 8', async () => {
    const parser = new RbsParser();
    const importer = new RbsImporter({ expandTo32Steps: false });
    const source = await parser.parseBytes(buildSyntheticIffFile({
      includeDevl: true,
      playMode: 1,
      trakEvents: [{ delta: 0, ctrl: 0x01, value: 0 }],
    }));
    if (!source.success) return;

    const song = importer.convertToHyphonSong(source.data).song;
    const empty = { steps: Array(16).fill(null) };
    const noteAt = (note: string) => ({
      steps: [{ note, velocity: 1, length: 1 }, ...Array(15).fill(null)],
    });

    song.songArrangement = {
      ...song.songArrangement!,
      mode: 'song',
      trakEvents: undefined,
      trakParamEvents: undefined,
      trackStorage: {
        ...song.songArrangement!.trackStorage,
        partA: Array.from({ length: 9 }, (_, i) => noteAt(`C${(i % 5) + 2}`)),
        partB: Array.from({ length: 9 }, () => empty),
        bass2: Array.from({ length: 9 }, () => empty),
        kick: Array.from({ length: 9 }, () => empty),
        snare: Array.from({ length: 9 }, () => empty),
        closedHat: Array.from({ length: 9 }, () => empty),
        openHat: Array.from({ length: 9 }, () => empty),
      },
      songStructure: Array.from({ length: 9 }, (_, i) => ({
        partA: i, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: null,
      })),
    };

    const { bytes, warnings } = new RbsExporter({ mode: 'song', collapse32Steps: true })
      .exportToBytes(song);
    expect(warnings.some((w) => w.includes('supports 8 per track'))).toBe(false);

    const reParsed = await parser.parseBytes(bytes);
    expect(reParsed.success).toBe(true);
    if (!reParsed.success || !reParsed.data.songData) return;

    const banks = reParsed.data.songData.patternBanks.tb303A;
    expect(banks.length).toBeGreaterThanOrEqual(9);
    expect(banks[8].steps.some((s) => s.note >= 0)).toBe(true);

    const tb303Track = reParsed.data.songData.tracks.find(
      (t) => t.trackIndex === TRAK_TRACK_INDEX.TB303_1,
    );
    const patternSelects = tb303Track?.events.filter((e) => e.eventKind === 'patternSelect') ?? [];
    expect(patternSelects.map((e) => e.value)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('synthesizes TRAK cutoff events from automation lanes when trakEvents are absent', async () => {
    const parser = new RbsParser();
    const importer = new RbsImporter({ expandTo32Steps: false });
    const source = await parser.parseBytes(buildSyntheticIffFile({
      includeDevl: true,
      playMode: 1,
      trakEvents: [{ delta: 0, ctrl: 0x01, value: 0 }],
    }));
    if (!source.success) return;

    const song = importer.convertToHyphonSong(source.data).song;
    song.songArrangement = {
      ...song.songArrangement!,
      mode: 'song',
      trakEvents: undefined,
      trakParamEvents: undefined,
    };
    song.automation = [{
      target: 'synthA',
      parameter: 'filterCutoff',
      name: 'Cutoff',
      points: [[0, 0.5], [4, 1]],
      interpolation: 'linear',
      originalRange: [0, 127],
    }];

    const { bytes } = new RbsExporter({ mode: 'song' }).exportToBytes(song);
    const reParsed = await parser.parseBytes(bytes);
    expect(reParsed.success).toBe(true);
    if (!reParsed.success || !reParsed.data.songData) return;

    const tb303Track = reParsed.data.songData.tracks.find(
      (t) => t.trackIndex === TRAK_TRACK_INDEX.TB303_1,
    );
    const cutoffs = tb303Track?.events.filter((e) => e.eventKind === 'paramChange') ?? [];
    expect(cutoffs.length).toBeGreaterThanOrEqual(2);
  });
});

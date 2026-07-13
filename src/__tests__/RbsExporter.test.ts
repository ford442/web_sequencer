/**
 * RBS Exporter tests — export → parse → structural round-trip.
 */
import { describe, expect, it } from 'vitest';
import { RbsParser } from '../importers/rbs/RbsParser';
import { RbsImporter } from '../importers/rbs/RbsImporter';
import { RbsExporter } from '../importers/rbs/RbsExporter';
import { parseTb303DeviceChunk, parseTr808DeviceChunk } from '../importers/rbs/devlLayout';
import { buildSyntheticIffFile } from './rbs/fixtures';
import type { Tb303Step } from '../importers/rbs/types';

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
});

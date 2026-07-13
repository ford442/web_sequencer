import type {
  RawRbsData, RbsGlobData, RbsTrakEvent, RbsTrakData, RbsSongData, PcfSettings,
} from '../types';
import { TICKS_PER_BAR } from '../types';
import { isTrakPatternSelectEvent, resolveTrakEventKind } from '../trakControllers';
import type { RbsParserError, IffChunk } from '../parser-types';
import { MAX_TRAK_EVENTS, SUPPORTED_VERSIONS } from '../parser-types';
import { inferDevicesPresent } from '../deviceInference';
import {
  DEVL_CHUNK_IDS,
  parseTb303DeviceChunk,
  parseTr808DeviceChunk,
  parseTr909DeviceChunk,
  parseDevlPcfChunk,
  parseDevlMixrPcfDeviceId,
  buildPcfSettingsFromDevl,
  disabledPcfSettings,
} from '../devlLayout';
import type { ParserBinaryContext } from './parserContext';
import { readAsciiString, readNullTerminatedString } from './binaryIO';
import {
  generateEmptyTb303Pattern,
  generateEmptyTb303PatternB,
  generateEmptyDrumPattern,
} from './mockData';

export function validateVersion(version: string): RbsParserError | null {
  if (!SUPPORTED_VERSIONS.includes(version)) {
    return {
      type: 'UNSUPPORTED_VERSION',
      version,
      supported: [...SUPPORTED_VERSIONS],
    };
  }
  return null;
}

export function detectIffTruncation(ctx: ParserBinaryContext, chunks: IffChunk[]): RbsParserError | null {
  for (const chunk of chunks) {
    const paddedSize = chunk.size + (chunk.size % 2);
    const end = chunk.offset + paddedSize;
    if (end > ctx.fileSize) {
      return {
        type: 'CORRUPTED_DATA',
        section: 'iff',
        details: `Truncated chunk "${chunk.id}" (payload ends at ${end}, file size ${ctx.fileSize})`,
        offset: chunk.offset,
      };
    }
  }
  return null;
}

export function parseIffChunks(ctx: ParserBinaryContext): IffChunk[] {
  const chunks: IffChunk[] = [];
  if (ctx.fileSize < 12) return chunks;

  const magic = readAsciiString(ctx, 0, 4);
  if (magic !== 'CAT ') {
    return chunks;
  }

  const rootSize = ctx.dataView.getUint32(4, false);
  let pos = 12;

  const formType = readAsciiString(ctx, 8, 4);
  console.debug(`[RbsParser] IFF CAT form detected: ${formType}, root size ${rootSize}`);

  const maxPos = Math.min(ctx.fileSize, 8 + rootSize);
  while (pos + 8 <= maxPos) {
    const id = readAsciiString(ctx, pos, 4);
    if (!id || id.charCodeAt(0) < 32) break;
    const size = ctx.dataView.getUint32(pos + 4, false);
    const payloadEnd = pos + 8 + size + (size % 2);
    if (payloadEnd > ctx.fileSize) {
      chunks.push({ id, size, offset: pos + 8 });
      break;
    }
    chunks.push({ id, size, offset: pos + 8 });
    pos += 8 + size;
    if (size % 2 === 1) pos++;
  }

  return chunks;
}

export function parseNestedChunks(
  ctx: ParserBinaryContext,
  parentOffset: number,
  parentSize: number,
): IffChunk[] {
  const chunks: IffChunk[] = [];
  let pos = parentOffset + 4;
  const maxPos = parentOffset + parentSize;

  while (pos + 8 <= maxPos) {
    const id = readAsciiString(ctx, pos, 4);
    if (!id || id.charCodeAt(0) < 32) break;
    const size = ctx.dataView.getUint32(pos + 4, false);
    const payloadEnd = pos + 8 + size + (size % 2);
    if (payloadEnd > parentOffset + parentSize && payloadEnd > ctx.fileSize) {
      chunks.push({ id, size, offset: pos + 8 });
      break;
    }
    chunks.push({ id, size, offset: pos + 8 });
    pos += 8 + size;
    if (size % 2 === 1) pos++;
  }

  return chunks;
}

export function parseIffHead(ctx: ParserBinaryContext, chunk: IffChunk): string {
  const offset = chunk.offset;
  const sig = readNullTerminatedString(ctx, offset, Math.min(chunk.size, 64));

  const versionMatch = sig.match(/(\d+\.\d+(?:\.\d+)?)/);
  if (versionMatch) return versionMatch[1];

  if (sig.includes('RB40') || sig.includes('RB-338')) return '2.0';
  if (sig.includes('RB15') || sig.includes('v1.5') || sig.includes('1.5')) return '1.5';
  if (sig.includes('v1.0') || sig.includes('1.0')) return '1.0';

  return '2.0';
}

export function parseIffGlob(ctx: ParserBinaryContext, chunk: IffChunk): RbsGlobData {
  const o = chunk.offset;
  const playMode = ctx.rawBytes[o] === 1 ? 1 : 0;
  const tempoRaw = ctx.dataView.getUint32(o + 2, false);
  const tempo = tempoRaw > 0 ? tempoRaw / 1000 : 120;
  const loopStartTicks = ctx.dataView.getUint32(o + 6, false);
  const loopEndTicks = ctx.dataView.getUint32(o + 10, false);
  const shuffle = ctx.rawBytes[o + 14] ?? 64;
  const vintage = ctx.rawBytes[o + 0x1ea] || 0;

  return {
    playMode,
    tempo,
    shuffle,
    loopStart: Math.floor(loopStartTicks / TICKS_PER_BAR),
    loopEnd: Math.floor(loopEndTicks / TICKS_PER_BAR),
    vintage,
  };
}

export function defaultGlob(): RbsGlobData {
  return { playMode: 0, tempo: 120, shuffle: 64, loopStart: 0, loopEnd: 0, vintage: 0 };
}

export function parseDevlPatterns(
  ctx: ParserBinaryContext,
  devlChunks: IffChunk[],
  _hasDevlCatalog: boolean,
): RbsSongData['patternBanks'] {
  const banks: RbsSongData['patternBanks'] = {
    tb303A: [],
    tb303B: [],
    drums808: [],
    drums909: [],
  };

  let tb303DeviceIndex = 0;

  for (const chunk of devlChunks) {
    const chunkId = chunk.id;

    if (chunkId === DEVL_CHUNK_IDS.TB303) {
      const patterns = parseTb303DeviceChunk(ctx.rawBytes, chunk.offset, chunk.size);
      if (tb303DeviceIndex === 0) {
        banks.tb303A.push(...patterns);
      } else {
        banks.tb303B.push(...patterns);
      }
      tb303DeviceIndex++;
      continue;
    }

    if (chunkId === DEVL_CHUNK_IDS.TR808) {
      banks.drums808.push(...parseTr808DeviceChunk(ctx.rawBytes, chunk.offset, chunk.size));
      continue;
    }

    if (chunkId === DEVL_CHUNK_IDS.TR909) {
      banks.drums909.push(...parseTr909DeviceChunk(ctx.rawBytes, chunk.offset, chunk.size));
    }
  }

  if (banks.tb303A.length === 0) {
    const legacyA = devlChunks.find((c) => c.id === '3031' || c.id === '303A');
    if (legacyA) {
      banks.tb303A.push(...parseTb303DeviceChunk(ctx.rawBytes, legacyA.offset, legacyA.size));
    }
  }
  if (banks.tb303B.length === 0) {
    const legacyB = devlChunks.find((c) => c.id === '3032' || c.id === '303B');
    if (legacyB) {
      banks.tb303B.push(...parseTb303DeviceChunk(ctx.rawBytes, legacyB.offset, legacyB.size));
    }
  }

  return banks;
}

export function parseDevlPcfSettings(ctx: ParserBinaryContext, devlChunks: IffChunk[]): PcfSettings {
  const pcfChunk = devlChunks.find((c) => c.id === DEVL_CHUNK_IDS.PCF);
  const mixrChunk = devlChunks.find((c) => c.id === DEVL_CHUNK_IDS.MIXR);

  if (!pcfChunk) {
    return disabledPcfSettings();
  }

  const pcfData = parseDevlPcfChunk(ctx.rawBytes, pcfChunk.offset, pcfChunk.size);
  const mixrPcfId = mixrChunk
    ? parseDevlMixrPcfDeviceId(ctx.rawBytes, mixrChunk.offset)
    : 0;

  return buildPcfSettingsFromDevl(pcfData, mixrPcfId);
}

export function parseSingleTrak(
  ctx: ParserBinaryContext,
  chunk: IffChunk,
  index: number,
  name: string,
): RbsTrakData {
  const offset = chunk.offset;
  const events: RbsTrakEvent[] = [];

  if (chunk.size < 4) {
    return { trackIndex: index, trackName: name, eventCount: 0, events: [] };
  }

  const eventCount = ctx.dataView.getUint32(offset, true);
  let pos = offset + 4;
  let absoluteTicks = 0;

  const maxEvents = Math.min(eventCount, MAX_TRAK_EVENTS);
  for (let e = 0; e < maxEvents; e++) {
    if (pos + 4 > offset + chunk.size) break;

    const deltaTicks = ctx.dataView.getUint16(pos, true);
    const controllerId = ctx.rawBytes[pos + 2];
    const value = ctx.rawBytes[pos + 3];
    pos += 4;

    absoluteTicks += deltaTicks;
    const eventKind = resolveTrakEventKind(index, controllerId);
    events.push({
      deltaTicks,
      absoluteTicks,
      trackIndex: index,
      controllerId,
      value,
      eventKind,
    });
  }

  return { trackIndex: index, trackName: name, eventCount: events.length, events };
}

export function parseTrklTracks(ctx: ParserBinaryContext, trklChunks: IffChunk[]): RbsTrakData[] {
  const trackNames = [
    'Mixer',
    'TB-303 #1',
    'TB-303 #2',
    'TR-808',
    'TR-909',
    'Delay',
    'Distortion',
    'PCF',
    'Compressor',
  ];
  const tracks: RbsTrakData[] = [];

  for (let i = 0; i < trklChunks.length; i++) {
    const chunk = trklChunks[i];
    if (chunk.id !== 'TRAK') continue;

    const trackIndex = tracks.length;
    const track = parseSingleTrak(
      ctx,
      chunk,
      trackIndex,
      trackNames[trackIndex] || `Track ${trackIndex}`,
    );
    tracks.push(track);
  }

  return tracks;
}

export function parseIffSongData(ctx: ParserBinaryContext, topChunks: IffChunk[]): RawRbsData | null {
  const headChunk = topChunks.find(c => c.id === 'HEAD');
  const globChunk = topChunks.find(c => c.id === 'GLOB');
  const catChunks = topChunks.filter(c => c.id === 'CAT ');

  if (!headChunk) return null;

  ctx.onProgress?.(10);

  const version = parseIffHead(ctx, headChunk);
  const glob = globChunk ? parseIffGlob(ctx, globChunk) : defaultGlob();

  ctx.onProgress?.(20);

  let devlChunks: IffChunk[] = [];
  let trklChunks: IffChunk[] = [];
  for (const cat of catChunks) {
    const formType = readAsciiString(ctx, cat.offset, 4);
    if (formType === 'DEVL') {
      devlChunks = parseNestedChunks(ctx, cat.offset, cat.size);
    } else if (formType === 'TRKL') {
      trklChunks = parseNestedChunks(ctx, cat.offset, cat.size);
    }
  }

  ctx.onProgress?.(40);

  const hasDevlCatalog = devlChunks.length > 0;
  const patternBanks = parseDevlPatterns(ctx, devlChunks, hasDevlCatalog);

  ctx.onProgress?.(70);

  const tracks = parseTrklTracks(ctx, trklChunks);

  ctx.onProgress?.(90);

  let maxTick = 0;
  const usedPatterns = new Set<number>();
  for (const track of tracks) {
    for (const evt of track.events) {
      if (evt.absoluteTicks > maxTick) maxTick = evt.absoluteTicks;
      if (isTrakPatternSelectEvent(evt.trackIndex, evt.controllerId, evt.eventKind)) {
        usedPatterns.add(evt.value);
      }
    }
  }
  const totalLengthBars = Math.ceil(maxTick / TICKS_PER_BAR) || 1;

  const songData: RbsSongData = {
    glob,
    patternBanks,
    tracks,
    totalLengthTicks: maxTick,
    totalLengthBars,
    usedPatternCount: usedPatterns.size || 1,
  };

  const tb303PatternA = patternBanks.tb303A[0] ?? generateEmptyTb303Pattern();
  const tb303PatternB = patternBanks.tb303B[0] ?? generateEmptyTb303PatternB();
  const drums = patternBanks.drums808[0] ?? patternBanks.drums909[0] ?? generateEmptyDrumPattern();

  const pcf = hasDevlCatalog
    ? parseDevlPcfSettings(ctx, devlChunks)
    : disabledPcfSettings();

  const baseName = `RBS Song (${version})`;
  const rawData: RawRbsData = {
    version,
    project: {
      name: baseName,
      author: 'Imported from RBS',
      tempo: glob.tempo || 120,
      timeSignatureNum: 4,
      timeSignatureDen: 4,
      swing: glob.shuffle,
      patternLength: 16,
      createdAt: new Date(),
      sourceSoftware: 'ReBirth RB-338',
    },
    tb303PatternA,
    tb303PatternB,
    drums,
    pcf,
    automation: [],
    songData,
    parsePath: 'iff',
  };
  rawData.devicesPresent = inferDevicesPresent(rawData);

  return rawData;
}

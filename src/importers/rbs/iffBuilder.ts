/**
 * IFF CAT RB40 byte builders for RBS export (RBS42-aligned).
 * Shared between RbsExporter and test fixtures.
 */

import type { DrumPattern, Tb303Step } from './types';
import {
  TB303_CHUNK_PAYLOAD_SIZE,
  TB303_FLAG_ACCENT,
  TB303_FLAG_NOTE,
  TB303_FLAG_SLIDE,
  TB303_PATTERN_DATA_OFFSET,
  TB303_PATTERN_SIZE,
  TB303_STEP_OFFSET_IN_PATTERN,
  TB303_STEP_SIZE,
  TR808_CHUNK_PAYLOAD_SIZE,
  TR808_PATTERN_DATA_OFFSET,
  TR808_STEP_INSTRUMENT_COUNT,
  TR808_STEP_OFFSET_IN_PATTERN,
  TR909_CHUNK_PAYLOAD_SIZE,
} from './devlLayout';

export function writeU32BE(val: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, val >>> 0, false);
  return buf;
}

export function writeAscii(s: string, len = s.length): Uint8Array {
  const buf = new Uint8Array(len);
  for (let i = 0; i < Math.min(len, s.length); i++) {
    buf[i] = s.charCodeAt(i);
  }
  return buf;
}

export function wrapIffChunk(id: string, payload: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + payload.length + (payload.length % 2));
  chunk.set(writeAscii(id, 4), 0);
  chunk.set(writeU32BE(payload.length), 4);
  chunk.set(payload, 8);
  return chunk;
}

export function wrapNestedCat(formType: string, innerChunks: Uint8Array[]): Uint8Array {
  const innerSize = 4 + innerChunks.reduce((sum, c) => sum + c.length, 0);
  const cat = new Uint8Array(8 + innerSize);
  cat.set(writeAscii('CAT ', 4), 0);
  cat.set(writeU32BE(innerSize), 4);
  cat.set(writeAscii(formType, 4), 8);
  let pos = 12;
  for (const chunk of innerChunks) {
    cat.set(chunk, pos);
    pos += chunk.length;
  }
  return cat;
}

/** Encode one TB-303 step for DEVL "303 " chunk (pitch + RBS42 flags). */
export function encodeDevlTb303Step(step: Tb303Step): [number, number] {
  if (step.note < 0) {
    const flags = (step.accent ? TB303_FLAG_ACCENT : 0) | (step.slide ? TB303_FLAG_SLIDE : 0);
    return [0, flags];
  }
  const flags =
    TB303_FLAG_NOTE |
    (step.slide ? TB303_FLAG_SLIDE : 0) |
    (step.accent ? TB303_FLAG_ACCENT : 0);
  return [step.note % 12, flags];
}

export interface Tb303DeviceParams {
  cutoff?: number;
  resonance?: number;
  envMod?: number;
  decay?: number;
  accent?: number;
  waveform?: 0 | 1;
}

/** Build RBS42-aligned "303 " device chunk payload (1097 bytes), pattern slot 0 only. */
export function buildDevl303ChunkPayload(
  patternSteps: Tb303Step[] = [],
  params: Tb303DeviceParams = {},
): Uint8Array {
  const payload = new Uint8Array(TB303_CHUNK_PAYLOAD_SIZE);
  payload[0] = 1;
  payload[3] = params.cutoff ?? 90;
  payload[4] = params.resonance ?? 64;
  payload[5] = params.envMod ?? 64;
  payload[6] = params.decay ?? 48;
  payload[7] = params.accent ?? 80;
  payload[8] = params.waveform ?? 0;

  const steps: Tb303Step[] = patternSteps.length >= 16
    ? patternSteps.slice(0, 16)
    : [
        ...patternSteps,
        ...Array.from({ length: 16 - patternSteps.length }, (_, i) => ({
          index: patternSteps.length + i,
          note: -1,
          octave: 3,
          accent: false,
          slide: false,
          tie: false,
          gate: 100,
        })),
      ];

  const patternOffset = TB303_PATTERN_DATA_OFFSET;
  payload[patternOffset] = 0;
  payload[patternOffset + 1] = 16;
  for (let s = 0; s < 16; s++) {
    const stepOffset = patternOffset + TB303_STEP_OFFSET_IN_PATTERN + s * TB303_STEP_SIZE;
    const [pitch, flags] = encodeDevlTb303Step(steps[s]);
    payload[stepOffset] = pitch;
    payload[stepOffset + 1] = flags;
  }

  return payload;
}

export function buildDevlPcfChunkPayload(options: {
  enabled?: boolean;
  cutoff?: number;
  resonance?: number;
  envAmount?: number;
  wave?: number;
  decay?: number;
  filterType?: 'lp' | 'bp';
} = {}): Uint8Array {
  const payload = new Uint8Array(12);
  payload[0] = options.enabled === false ? 0 : 1;
  payload[1] = options.cutoff ?? 80;
  payload[2] = options.resonance ?? 40;
  payload[3] = options.envAmount ?? 60;
  payload[4] = options.wave ?? 1;
  payload[5] = options.decay ?? 40;
  payload[6] = options.filterType === 'lp' ? 1 : 0;
  return payload;
}

export function buildDevlMixrChunk(pcfDeviceId = 0): Uint8Array {
  const payload = new Uint8Array(64);
  payload[2] = pcfDeviceId;
  return payload;
}

/** Build TR-808 DEVL chunk with pattern 0 from a DrumPattern. */
export function buildDevl808ChunkFromPattern(dp: DrumPattern): Uint8Array {
  const payload = new Uint8Array(TR808_CHUNK_PAYLOAD_SIZE);
  payload[0] = 1;
  const patternOffset = TR808_PATTERN_DATA_OFFSET;
  payload[patternOffset + 1] = 16;
  for (let s = 0; s < 16; s++) {
    const stepBase = patternOffset + TR808_STEP_OFFSET_IN_PATTERN + s * TR808_STEP_INSTRUMENT_COUNT;
    if (dp.kick[s]) payload[stepBase + 1] = 0x01;
    if (dp.snare[s]) payload[stepBase + 2] = 0x01;
    if (dp.openHat[s]) payload[stepBase + 10] = 0x01;
    if (dp.closedHat[s]) payload[stepBase + 11] = 0x01;
  }
  return payload;
}

/** Build TR-909 DEVL chunk with pattern 0 from a DrumPattern. */
export function buildDevl909ChunkFromPattern(dp: DrumPattern): Uint8Array {
  const payload = new Uint8Array(TR909_CHUNK_PAYLOAD_SIZE);
  payload[0] = 1;
  const patternOffset = TR808_PATTERN_DATA_OFFSET;
  payload[patternOffset + 1] = 16;
  for (let s = 0; s < 16; s++) {
    const stepBase = patternOffset + TR808_STEP_OFFSET_IN_PATTERN + s * TR808_STEP_INSTRUMENT_COUNT;
    if (dp.kick[s]) payload[stepBase + 1] = 0x01;
    if (dp.snare[s]) payload[stepBase + 2] = 0x01;
    if (dp.openHat[s]) payload[stepBase + 10] = 0x01;
    if (dp.closedHat[s]) payload[stepBase + 9] = 0x01;
  }
  return payload;
}

export function buildDevlCatalogChunk(options: {
  tb303ASteps?: Tb303Step[];
  tb303BSteps?: Tb303Step[];
  tb303AParams?: Tb303DeviceParams;
  tb303BParams?: Tb303DeviceParams;
  drumPattern?: DrumPattern;
  drumKit?: '808' | '909';
  include303B?: boolean;
  pcf?: Parameters<typeof buildDevlPcfChunkPayload>[0];
  mixrPcfId?: number;
} = {}): Uint8Array {
  const {
    tb303ASteps,
    tb303BSteps,
    tb303AParams,
    tb303BParams,
    drumPattern,
    drumKit = '808',
    include303B = true,
    pcf,
    mixrPcfId = 0,
  } = options;

  const emptyDrum: DrumPattern = {
    kick: Array(16).fill(false),
    snare: Array(16).fill(false),
    closedHat: Array(16).fill(false),
    openHat: Array(16).fill(false),
    accent: Array(16).fill(0),
    kitType: drumKit,
  };

  const inner: Uint8Array[] = [
    wrapIffChunk('MIXR', buildDevlMixrChunk(mixrPcfId)),
    wrapIffChunk('DELY', new Uint8Array(8)),
    wrapIffChunk('PCF ', buildDevlPcfChunkPayload(pcf)),
    wrapIffChunk('DIST', new Uint8Array(8)),
    wrapIffChunk('COMP', new Uint8Array(8)),
    wrapIffChunk('303 ', buildDevl303ChunkPayload(tb303ASteps, tb303AParams)),
  ];
  if (include303B) {
    inner.push(wrapIffChunk('303 ', buildDevl303ChunkPayload(tb303BSteps, tb303BParams)));
  }
  const drums = drumPattern ?? emptyDrum;
  if (drumKit === '909') {
    inner.push(wrapIffChunk('808 ', new Uint8Array(TR808_CHUNK_PAYLOAD_SIZE)));
    inner.push(wrapIffChunk('909 ', buildDevl909ChunkFromPattern(drums)));
  } else {
    inner.push(wrapIffChunk('808 ', buildDevl808ChunkFromPattern(drums)));
    inner.push(wrapIffChunk('909 ', new Uint8Array(TR909_CHUNK_PAYLOAD_SIZE)));
  }
  return wrapNestedCat('DEVL', inner);
}

export function buildTrakChunkPayload(
  events: Array<{ delta: number; ctrl: number; value: number }> = [],
): Uint8Array {
  const trakPayload = new Uint8Array(4 + events.length * 4);
  const dv = new DataView(trakPayload.buffer);
  dv.setUint32(0, events.length, true);
  for (let i = 0; i < events.length; i++) {
    const offset = 4 + i * 4;
    dv.setUint16(offset, events[i].delta, true);
    trakPayload[offset + 2] = events[i].ctrl;
    trakPayload[offset + 3] = events[i].value;
  }
  return trakPayload;
}

function wrapTrakChunk(events: Array<{ delta: number; ctrl: number; value: number }>): Uint8Array {
  return wrapIffChunk('TRAK', buildTrakChunkPayload(events));
}

export function buildTrklChunk(
  trackEventLists: Array<{ events: Array<{ delta: number; ctrl: number; value: number }> }> = [],
): Uint8Array {
  const lists = trackEventLists.length > 0
    ? trackEventLists
    : Array.from({ length: 6 }, () => ({ events: [] as Array<{ delta: number; ctrl: number; value: number }> }));

  const trakChunks = lists.map((t) => wrapTrakChunk(t.events));
  const trklInnerSize = 4 + trakChunks.reduce((sum, c) => sum + c.length, 0);
  const trklChunk = new Uint8Array(8 + trklInnerSize);
  trklChunk.set(writeAscii('CAT ', 4), 0);
  trklChunk.set(writeU32BE(trklInnerSize), 4);
  trklChunk.set(writeAscii('TRKL', 4), 8);
  let pos = 12;
  for (const chunk of trakChunks) {
    trklChunk.set(chunk, pos);
    pos += chunk.length;
  }
  return trklChunk;
}

export interface IffRbsFileOptions {
  playMode?: 0 | 1;
  tempoBpm?: number;
  shuffle?: number;
  loopStartBars?: number;
  loopEndBars?: number;
  headVersionString?: string;
  songName?: string;
  devl?: Parameters<typeof buildDevlCatalogChunk>[0];
  trakTracks?: Array<{ events: Array<{ delta: number; ctrl: number; value: number }> }>;
}

/** Assemble a complete IFF CAT RB40 `.rbs` file. */
export function buildIffRbsFile(options: IffRbsFileOptions = {}): Uint8Array {
  const {
    playMode = 0,
    tempoBpm = 120,
    shuffle = 64,
    loopStartBars = 0,
    loopEndBars = 1,
    headVersionString = 'ReBirth RB-338 v2.0',
    songName,
    devl = {},
    trakTracks,
  } = options;

  const headPayload = new Uint8Array(256);
  const headStr = songName
    ? `${headVersionString}\0${songName}`.slice(0, 255)
    : headVersionString;
  for (let i = 0; i < headStr.length; i++) headPayload[i] = headStr.charCodeAt(i);

  const globPayload = new Uint8Array(512);
  globPayload[0] = playMode;
  globPayload[1] = 0;
  globPayload.set(writeU32BE(Math.round(tempoBpm * 1000)), 2);
  globPayload.set(writeU32BE(loopStartBars * 768), 6);
  globPayload.set(writeU32BE(loopEndBars * 768), 10);
  globPayload[14] = shuffle;

  const headChunk = wrapIffChunk('HEAD', headPayload);
  const globChunk = wrapIffChunk('GLOB', globPayload);
  const devlCatChunk = buildDevlCatalogChunk(devl);
  const trklChunk = buildTrklChunk(trakTracks);

  const innerChunks = [headChunk, globChunk, devlCatChunk, trklChunk];
  const rootPayloadSize = 4 + innerChunks.reduce((sum, c) => sum + c.length, 0);
  const file = new Uint8Array(8 + rootPayloadSize);
  let pos = 0;
  file.set(writeAscii('CAT ', 4), pos); pos += 4;
  file.set(writeU32BE(rootPayloadSize), pos); pos += 4;
  file.set(writeAscii('RB40', 4), pos); pos += 4;
  for (const chunk of innerChunks) {
    file.set(chunk, pos);
    pos += chunk.length;
  }
  return file;
}

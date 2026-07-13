/**
 * Synthetic RBS byte builders for parser/importer tests.
 * No real .rbs files — all fixtures are generated in-memory.
 */

import type { Tb303Step } from '../../importers/rbs/types';
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
  TR808_PATTERN_SIZE,
  TR808_STEP_INSTRUMENT_COUNT,
  TR808_STEP_OFFSET_IN_PATTERN,
  TR909_CHUNK_PAYLOAD_SIZE,
} from '../../importers/rbs/devlLayout';

// ── Binary helpers ───────────────────────────────────────────────────────────

export function writeU32BE(val: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, val >>> 0, false);
  return buf;
}

export function writeU16LE(val: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, val & 0xffff, true);
  return buf;
}

export function writeU32LE(val: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, val >>> 0, true);
  return buf;
}

export function writeAscii(s: string, len = s.length): Uint8Array {
  const buf = new Uint8Array(len);
  for (let i = 0; i < Math.min(len, s.length); i++) {
    buf[i] = s.charCodeAt(i);
  }
  return buf;
}

// ── Legacy fixed-offset RB338 file (768+ bytes) ─────────────────────────────

export interface LegacyRbsConfig {
  versionMajor?: number;
  versionMinor?: number;
  patternLength?: 16 | 32;
  tempo?: number;
  swing?: number;
  songName?: string;
  tb303ASteps?: Tb303Step[];
  kitType?: '808' | '909';
  pcfPattern?: number[];
  automationLaneCount?: number;
  /** Include TB-303 B data in legacy layout (default true for v2.0, false for v1.5 subset). */
  include303B?: boolean;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function encodeTb303Step(step: Tb303Step): Uint8Array {
  const bytes = new Uint8Array(15);
  if (step.tie) {
    bytes[0] = 254;
  } else if (step.note < 0) {
    bytes[0] = 255;
  } else {
    bytes[0] = step.note % 12;
  }
  bytes[1] = step.octave;
  let flags = 0;
  if (step.accent) flags |= 0x01;
  if (step.slide) flags |= 0x02;
  if (step.tie) flags |= 0x04;
  bytes[2] = flags;
  bytes[3] = step.gate ?? 100;
  return bytes;
}

function defaultSteps(): Tb303Step[] {
  return Array.from({ length: 16 }, (_, index) => ({
    index,
    note: index % 4 === 3 ? -1 : index % 12,
    octave: 3,
    accent: index % 4 === 0,
    slide: index % 8 === 0,
    tie: false,
    gate: 80,
  }));
}

/**
 * Build a minimal valid legacy RB338 fixed-offset .rbs file.
 */
export function buildLegacyRbsFile(config: LegacyRbsConfig = {}): Uint8Array {
  const {
    versionMajor = 2,
    versionMinor = 0,
    patternLength = 16,
    tempo = 128,
    swing = 50,
    songName = 'Synth Test',
    tb303ASteps = defaultSteps(),
    kitType = '808',
    pcfPattern = Array.from({ length: 16 }, (_, i) => (i % 2 === 0 ? 127 : 64)),
    automationLaneCount = 0,
    include303B = true,
  } = config;

  const size = 0x400;
  const file = new Uint8Array(size);

  // Header (0x00–0x3F)
  file.set(writeAscii('RB338', 5), 0x00);
  file[0x08] = versionMajor;
  file[0x09] = versionMinor;
  file[0x0a] = patternLength;
  file[0x0b] = tempo;
  file[0x0c] = 4;
  file[0x0d] = 4;
  file[0x0e] = swing;
  const nameBytes = writeAscii(songName, 48);
  file.set(nameBytes, 0x10);

  // TB-303 A (0x40)
  const tb303Base = 0x40;
  file[tb303Base] = 100;
  file[tb303Base + 1] = 64;
  file[tb303Base + 2] = 80;
  file[tb303Base + 3] = 90;
  file[tb303Base + 4] = 96;
  file[tb303Base + 5] = 0;
  for (let i = 0; i < 16; i++) {
    const step = tb303ASteps[i] ?? defaultSteps()[i];
    file.set(encodeTb303Step(step), tb303Base + 0x08 + i * 15);
  }

  // TB-303 B (0x140) — optional; v1.5 subset leaves section zeroed
  const tb303B = 0x140;
  if (include303B) {
    file[tb303B + 5] = 1;
    file[tb303B + 8] = 0; // transpose
  }

  // Drums (0x240)
  const drumsBase = 0x240;
  for (let i = 0; i < 16; i++) {
    file[drumsBase + i] = i % 4 === 0 ? 1 : 0;
  }
  file[drumsBase + 0x50] = kitType === '808' ? 0 : 1;
  file[drumsBase + 0x51] = 50;
  file[drumsBase + 0x52] = 50;
  file[drumsBase + 0x53] = 50;
  file[drumsBase + 0x54] = 50;

  // PCF (0x2C0)
  const pcfBase = 0x2c0;
  file[pcfBase] = 1;
  file[pcfBase + 1] = 0;
  file[pcfBase + 2] = 100;
  file[pcfBase + 6] = 1;
  file[pcfBase + 7] = 1;
  for (let i = 0; i < 16; i++) {
    file[pcfBase + 9 + i] = pcfPattern[i] ?? 0;
  }

  // Automation (0x300)
  file[0x300] = automationLaneCount;

  return file;
}

/** Legacy fixed-offset v1.5 subset: single TB-303 #1 + TR-808. */
export function buildLegacyV15RbsFile(
  config: Omit<LegacyRbsConfig, 'versionMajor' | 'versionMinor' | 'include303B' | 'kitType'> = {},
): Uint8Array {
  return buildLegacyRbsFile({
    ...config,
    versionMajor: 1,
    versionMinor: 5,
    include303B: false,
    kitType: '808',
    songName: config.songName ?? 'v1.5 Pattern',
  });
}

/** Summarize TB-303 steps for invariant / snapshot tests */
export function summarizeTb303Steps(steps: Tb303Step[]) {
  return steps.map((s) => ({
    note: s.note < 0 ? 'rest' : NOTE_NAMES[s.note % 12],
    accent: s.accent,
    slide: s.slide,
    tie: s.tie,
  }));
}

// ── IFF CAT RB40 song file ──────────────────────────────────────────────────

export interface IffRbsConfig {
  playMode?: 0 | 1;
  /** Tempo as BPM × 1000 per RBS42 GLOB (e.g. 135000 = 135 BPM). */
  tempo?: number;
  shuffle?: number;
  loopStart?: number;
  loopEnd?: number;
  trakEvents?: Array<{ delta: number; ctrl: number; value: number }>;
  /**
   * Per-track TRAK event lists (index 0=mixer, 1=TB-303 #1, …).
   * When omitted, `trakEvents` is placed on TB-303 #1 (track index 1).
   */
  trakTracks?: Array<{ events: Array<{ delta: number; ctrl: number; value: number }> }>;
  /** Include struct-accurate DEVL catalog with device chunks. */
  includeDevl?: boolean;
  /** Include second TB-303 device in DEVL (default true). */
  include303B?: boolean;
  /** TB-303 pattern 0 steps for first "303 " device (when includeDevl). */
  tb303ASteps?: Tb303Step[];
  /** DEVL PCF chunk settings (when includeDevl). */
  pcf?: {
    enabled?: boolean;
    cutoff?: number;
    resonance?: number;
    envAmount?: number;
    wave?: number;
    decay?: number;
    filterType?: 'lp' | 'bp';
  };
  /** MIXR pcf_id routing byte (when includeDevl). */
  mixrPcfId?: number;
  /** HEAD version string override (e.g. "ReBirth RB-338 v1.5"). */
  headVersionString?: string;
  /** Extra raw chunks appended inside the RB40 container (e.g. unknown IDs). */
  extraChunks?: Array<{ id: string; payload: Uint8Array }>;
}

function wrapIffChunk(id: string, payload: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(8 + payload.length + (payload.length % 2));
  chunk.set(writeAscii(id, 4), 0);
  chunk.set(writeU32BE(payload.length), 4);
  chunk.set(payload, 8);
  return chunk;
}

function wrapNestedCat(formType: string, innerChunks: Uint8Array[]): Uint8Array {
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

/** Build one TRAK chunk payload (uint32 count + events). */
export function buildTrakChunkPayload(
  events: Array<{ delta: number; ctrl: number; value: number }> = [],
): Uint8Array {
  const trakPayloadSize = 4 + events.length * 4;
  const trakPayload = new Uint8Array(trakPayloadSize);
  const trakDv = new DataView(trakPayload.buffer);
  trakDv.setUint32(0, events.length, true);
  for (let i = 0; i < events.length; i++) {
    const offset = 4 + i * 4;
    trakDv.setUint16(offset, events[i].delta, true);
    trakPayload[offset + 2] = events[i].ctrl;
    trakPayload[offset + 3] = events[i].value;
  }
  return trakPayload;
}

function wrapTrakChunk(events: Array<{ delta: number; ctrl: number; value: number }>): Uint8Array {
  return wrapIffChunk('TRAK', buildTrakChunkPayload(events));
}

/** Default song-mode pattern-select events on TB-303 #1 (ctrl 0x01). */
export const DEFAULT_TB303_1_PATTERN_EVENTS = [
  { delta: 0, ctrl: 0x01, value: 0 },
  { delta: 768, ctrl: 0x01, value: 1 },
  { delta: 768, ctrl: 0x01, value: 2 },
  { delta: 768, ctrl: 0x01, value: 0 },
];

/** Build pattern-select TRAK events for patterns 0..maxPattern (one bar each, plus hold bar). */
export function buildPatternSelectEventsForRange(maxPattern: number): Array<{ delta: number; ctrl: number; value: number }> {
  const events: Array<{ delta: number; ctrl: number; value: number }> = [];
  for (let p = 0; p <= maxPattern; p++) {
    events.push({ delta: p === 0 ? 0 : 768, ctrl: 0x01, value: p });
  }
  // Hold the final pattern for one bar so song length includes the last switch measure
  if (maxPattern >= 0) {
    events.push({ delta: 768, ctrl: 0x01, value: maxPattern });
  }
  return events;
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

/** Build RBS42-aligned "303 " device chunk payload (1097 bytes). */
export function buildDevl303ChunkPayload(
  patternSteps: Tb303Step[] = [],
  params: { cutoff?: number; resonance?: number; waveform?: 0 | 1 } = {},
): Uint8Array {
  const payload = new Uint8Array(TB303_CHUNK_PAYLOAD_SIZE);
  payload[0] = 1; // enabled
  payload[3] = params.cutoff ?? 90;
  payload[4] = params.resonance ?? 64;
  payload[5] = 64;
  payload[6] = 48;
  payload[7] = 80;
  payload[8] = params.waveform ?? 0;

  const steps = patternSteps.length >= 16
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
        })),
      ];

  for (let p = 0; p < 1; p++) {
    const patternOffset = TB303_PATTERN_DATA_OFFSET + p * TB303_PATTERN_SIZE;
    payload[patternOffset] = 0; // shuffle off
    payload[patternOffset + 1] = 16; // pattern length
    for (let s = 0; s < 16; s++) {
      const stepOffset = patternOffset + TB303_STEP_OFFSET_IN_PATTERN + s * TB303_STEP_SIZE;
      const [pitch, flags] = encodeDevlTb303Step(steps[s]);
      payload[stepOffset] = pitch;
      payload[stepOffset + 1] = flags;
    }
  }

  return payload;
}

/** Build RBS42-aligned DEVL `PCF ` chunk payload (12 bytes). */
export function buildDevlPcfChunkPayload(
  options: {
    enabled?: boolean;
    cutoff?: number;
    resonance?: number;
    envAmount?: number;
    wave?: number;
    decay?: number;
    filterType?: 'lp' | 'bp';
  } = {},
): Uint8Array {
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

/** Build DEVL `MIXR` chunk with `pcf_id` at byte offset 2. */
export function buildDevlMixrChunk(pcfDeviceId = 0): Uint8Array {
  const payload = new Uint8Array(64);
  payload[2] = pcfDeviceId;
  return payload;
}

/** Build minimal TR-808 DEVL chunk with kick on steps 0,4,8,12 in pattern 0. */
export function buildDevl808ChunkPayload(): Uint8Array {
  const payload = new Uint8Array(TR808_CHUNK_PAYLOAD_SIZE);
  payload[0] = 1;
  const patternOffset = TR808_PATTERN_DATA_OFFSET;
  payload[patternOffset + 1] = 16;
  for (const step of [0, 4, 8, 12]) {
    const stepBase = patternOffset + TR808_STEP_OFFSET_IN_PATTERN + step * TR808_STEP_INSTRUMENT_COUNT;
    payload[stepBase + 1] = 0x01; // BD trigger
  }
  return payload;
}

/** Build DEVL catalog CAT chunk containing device payloads. */
export function buildDevlCatalogChunk(options: {
  include303B?: boolean;
  include808?: boolean;
  tb303ASteps?: Tb303Step[];
  pcf?: Parameters<typeof buildDevlPcfChunkPayload>[0];
  mixrPcfId?: number;
} = {}): Uint8Array {
  const { include303B = true, include808 = true, tb303ASteps, pcf, mixrPcfId = 0 } = options;
  const inner: Uint8Array[] = [
    wrapIffChunk('MIXR', buildDevlMixrChunk(mixrPcfId)),
    wrapIffChunk('DELY', new Uint8Array(8)),
    wrapIffChunk('PCF ', buildDevlPcfChunkPayload(pcf)),
    wrapIffChunk('DIST', new Uint8Array(8)),
    wrapIffChunk('COMP', new Uint8Array(8)),
    wrapIffChunk('303 ', buildDevl303ChunkPayload(tb303ASteps)),
  ];
  if (include303B) {
    inner.push(wrapIffChunk('303 ', buildDevl303ChunkPayload()));
  }
  if (include808) {
    inner.push(wrapIffChunk('808 ', buildDevl808ChunkPayload()));
  }
  inner.push(wrapIffChunk('909 ', new Uint8Array(TR909_CHUNK_PAYLOAD_SIZE)));
  return wrapNestedCat('DEVL', inner);
}

/**
 * Build a synthetic IFF CAT RB40 file with GLOB + TRKL data.
 */
export function buildSyntheticIffFile(options: IffRbsConfig = {}): Uint8Array {
  const {
    playMode = 1,
    tempo = 135_000,
    shuffle = 70,
    loopStart = 0,
    loopEnd = 8,
    trakEvents = DEFAULT_TB303_1_PATTERN_EVENTS,
    trakTracks,
    includeDevl = false,
    include303B = true,
    tb303ASteps,
    pcf,
    mixrPcfId,
    headVersionString,
    extraChunks = [],
  } = options;

  const headPayload = new Uint8Array(256);
  const headStr = headVersionString ?? 'ReBirth RB-338 v2.0';
  for (let i = 0; i < headStr.length; i++) headPayload[i] = headStr.charCodeAt(i);

  const globPayload = new Uint8Array(512);
  globPayload[0] = playMode;
  globPayload[1] = 0; // loop off
  globPayload.set(writeU32BE(tempo), 2);
  globPayload.set(writeU32BE(loopStart * 768), 6);
  globPayload.set(writeU32BE(loopEnd * 768), 10);
  globPayload[14] = shuffle;

  const patternEvents = trakEvents ?? DEFAULT_TB303_1_PATTERN_EVENTS;
  const trackEventLists = trakTracks ?? [
    { events: [] },
    { events: patternEvents },
    { events: [] },
    { events: [] },
    { events: [] },
    { events: [] },
  ];
  const trakChunks = trackEventLists.map((t) => wrapTrakChunk(t.events));
  const trklInnerSize = 4 + trakChunks.reduce((sum, c) => sum + c.length, 0);
  const trklChunk = new Uint8Array(8 + trklInnerSize);
  trklChunk.set(writeAscii('CAT ', 4), 0);
  trklChunk.set(writeU32BE(trklInnerSize), 4);
  trklChunk.set(writeAscii('TRKL', 4), 8);
  let trklPos = 12;
  for (const chunk of trakChunks) {
    trklChunk.set(chunk, trklPos);
    trklPos += chunk.length;
  }

  const headChunk = new Uint8Array(8 + headPayload.length);
  headChunk.set(writeAscii('HEAD', 4), 0);
  headChunk.set(writeU32BE(headPayload.length), 4);
  headChunk.set(headPayload, 8);

  const globChunk = wrapIffChunk('GLOB', globPayload);

  const devlChunk = includeDevl
    ? buildDevlCatalogChunk({ tb303ASteps, include303B, pcf, mixrPcfId })
    : null;

  const extraParts: Uint8Array[] = [];
  for (const ch of extraChunks) {
    extraParts.push(wrapIffChunk(ch.id, ch.payload));
  }

  const innerChunks = [
    headChunk,
    globChunk,
    ...(devlChunk ? [devlChunk] : []),
    trklChunk,
    ...extraParts,
  ];
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

/** Build IFF file with a truncated chunk (length past EOF). */
export function buildTruncatedIffFile(): Uint8Array {
  const full = buildSyntheticIffFile();
  return full.slice(0, full.length - 20);
}

/** Build IFF CAT with wrong form type (not RB40). */
export function buildWrongFormTypeIffFile(): Uint8Array {
  const file = buildSyntheticIffFile();
  file.set(writeAscii('XXXX', 4), 8);
  return file;
}

/** Mapped import summary for golden snapshots (narrow, stable fields only). */
export function buildImportSnapshotSummary(song: {
  tempo: number;
  pattern: {
    partA: { steps: unknown[] };
    partB: { steps: unknown[] };
    kick: { steps: unknown[] };
  };
  params: {
    drumKit?: string;
    kick?: { pitch?: number };
    snare?: { tone?: number };
  };
  automation?: Array<{ name: string; target: string; parameter: string; points: unknown[] }>;
}) {
  const countActive = (steps: Array<{ note?: string } | null>) =>
    steps.filter((s) => s !== null).length;

  return {
    tempo: song.tempo,
    patternStepCounts: {
      partA: song.pattern.partA.steps.length,
      partB: song.pattern.partB.steps.length,
      kick: song.pattern.kick.steps.length,
      partAActive: countActive(song.pattern.partA.steps as Array<{ note?: string } | null>),
    },
    drumKit: song.params.drumKit,
    kickPitch: song.params.kick?.pitch,
    snareTone: song.params.snare?.tone,
    automationLaneNames: (song.automation ?? []).map((l) => l.name).sort(),
    automationTargets: (song.automation ?? []).map((l) => `${l.target}.${l.parameter}`).sort(),
  };
}

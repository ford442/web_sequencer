/**
 * Synthetic RBS byte builders for parser/importer tests.
 * No real .rbs files — all fixtures are generated in-memory.
 */

import type { Tb303Step } from '../../importers/rbs/types';

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

  // TB-303 B (0x140) — mirror params, empty-ish pattern
  const tb303B = 0x140;
  file[tb303B + 5] = 1;
  file[tb303B + 8] = 0; // transpose

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
  tempo?: number;
  shuffle?: number;
  loopStart?: number;
  loopEnd?: number;
  trakEvents?: Array<{ delta: number; ctrl: number; value: number }>;
  /** Extra raw chunks appended inside the RB40 container (e.g. unknown IDs). */
  extraChunks?: Array<{ id: string; payload: Uint8Array }>;
}

/**
 * Build a synthetic IFF CAT RB40 file with GLOB + TRKL data.
 */
export function buildSyntheticIffFile(options: IffRbsConfig = {}): Uint8Array {
  const {
    playMode = 1,
    tempo = 1350,
    shuffle = 70,
    loopStart = 0,
    loopEnd = 8,
    trakEvents = [
      { delta: 0, ctrl: 0, value: 0 },
      { delta: 768, ctrl: 0, value: 1 },
      { delta: 768, ctrl: 0, value: 2 },
      { delta: 768, ctrl: 0, value: 0 },
    ],
    extraChunks = [],
  } = options;

  const headPayload = new Uint8Array(256);
  const headStr = 'ReBirth RB-338 v2.0';
  for (let i = 0; i < headStr.length; i++) headPayload[i] = headStr.charCodeAt(i);

  const globPayload = new Uint8Array(512);
  globPayload[0] = playMode;
  const tempoBuf = writeU16LE(tempo);
  globPayload[2] = tempoBuf[0];
  globPayload[3] = tempoBuf[1];
  globPayload[4] = shuffle;
  const lsBuf = writeU16LE(loopStart);
  globPayload[6] = lsBuf[0];
  globPayload[7] = lsBuf[1];
  const leBuf = writeU16LE(loopEnd);
  globPayload[8] = leBuf[0];
  globPayload[9] = leBuf[1];

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

  const trklFormType = writeAscii('TRKL', 4);
  const trakChunkId = writeAscii('TRAK', 4);
  const trakChunkWithHeader = new Uint8Array(8 + trakPayload.length);
  trakChunkWithHeader.set(trakChunkId, 0);
  trakChunkWithHeader.set(writeU32BE(trakPayload.length), 4);
  trakChunkWithHeader.set(trakPayload, 8);

  const trklInnerSize = 4 + trakChunkWithHeader.length;
  const trklChunk = new Uint8Array(8 + trklInnerSize);
  trklChunk.set(writeAscii('CAT ', 4), 0);
  trklChunk.set(writeU32BE(trklInnerSize), 4);
  trklChunk.set(trklFormType, 8);
  trklChunk.set(trakChunkWithHeader, 12);

  const headChunk = new Uint8Array(8 + headPayload.length);
  headChunk.set(writeAscii('HEAD', 4), 0);
  headChunk.set(writeU32BE(headPayload.length), 4);
  headChunk.set(headPayload, 8);

  const globChunk = new Uint8Array(8 + globPayload.length);
  globChunk.set(writeAscii('GLOB', 4), 0);
  globChunk.set(writeU32BE(globPayload.length), 4);
  globChunk.set(globPayload, 8);

  const extraParts: Uint8Array[] = [];
  for (const ch of extraChunks) {
    const chunk = new Uint8Array(8 + ch.payload.length + (ch.payload.length % 2));
    chunk.set(writeAscii(ch.id, 4), 0);
    chunk.set(writeU32BE(ch.payload.length), 4);
    chunk.set(ch.payload, 8);
    extraParts.push(chunk);
  }

  const innerChunks = [headChunk, globChunk, trklChunk, ...extraParts];
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

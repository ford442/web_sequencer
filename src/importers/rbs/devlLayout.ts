/**
 * RBS42 / rbs.h aligned DEVL device chunk layouts.
 * Ref: Propellerhead RBSFormat42.txt, nsauzede/jsynth rbs.h
 */

import type { DrumPattern, Tb303PatternA, Tb303PatternB, Tb303Step, PcfSettings } from './types';

/** DEVL nested chunk IDs (4-char ASCII, trailing space where specified). */
export const DEVL_CHUNK_IDS = {
  MIXR: 'MIXR',
  DELY: 'DELY',
  PCF: 'PCF ',
  DIST: 'DIST',
  COMP: 'COMP',
  TB303: '303 ',
  TR808: '808 ',
  TR909: '909 ',
} as const;

/** Expected payload sizes per RBS42. */
export const TB303_CHUNK_PAYLOAD_SIZE = 1097;
export const TR808_CHUNK_PAYLOAD_SIZE = 6238;
export const TR909_CHUNK_PAYLOAD_SIZE = 6239;

export const TB303_PATTERN_COUNT = 32;
export const TB303_PATTERN_SIZE = 34;
export const TB303_PATTERN_DATA_OFFSET = 9;
export const TB303_STEP_SIZE = 2;
export const TB303_STEP_OFFSET_IN_PATTERN = 2;

export const TR808_PATTERN_COUNT = 32;
export const TR808_PATTERN_SIZE = 194;
export const TR808_PATTERN_DATA_OFFSET = 30;
export const TR808_STEP_INSTRUMENT_COUNT = 12;
export const TR808_STEP_OFFSET_IN_PATTERN = 2;

export const TR909_PATTERN_COUNT = 32;
export const TR909_PATTERN_SIZE = 194;
export const TR909_PATTERN_DATA_OFFSET = 30;
export const TR909_STEP_INSTRUMENT_COUNT = 12;
export const TR909_STEP_OFFSET_IN_PATTERN = 2;

/** TB-303 step flag bits (RBS42 "303 " chunk). */
export const TB303_FLAG_SLIDE = 0x01;
export const TB303_FLAG_ACCENT = 0x02;
export const TB303_FLAG_TRANSPOSE_UP = 0x04;
export const TB303_FLAG_TRANSPOSE_DOWN = 0x08;
export const TB303_FLAG_NOTE = 0x10;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readTb303Params(bytes: Uint8Array, offset: number): Omit<Tb303PatternA, 'steps'> {
  return {
    cutoff: clamp(bytes[offset + 3] ?? 64, 0, 127),
    resonance: clamp(bytes[offset + 4] ?? 48, 0, 127),
    envMod: clamp(bytes[offset + 5] ?? 64, 0, 127),
    decay: clamp(bytes[offset + 6] ?? 48, 0, 127),
    accent: clamp(bytes[offset + 7] ?? 80, 0, 127),
    waveform: (bytes[offset + 8] ?? 0) === 0 ? 0 : 1,
    distortion: 0,
    delaySend: 0,
  };
}

/**
 * Parse one TB-303 step from DEVL pattern data (2 bytes: pitch + flags).
 */
export function parseDevlTb303Step(stepIndex: number, pitch: number, flags: number): Tb303Step {
  const isNote = (flags & TB303_FLAG_NOTE) !== 0;
  const accent = (flags & TB303_FLAG_ACCENT) !== 0;
  const slide = (flags & TB303_FLAG_SLIDE) !== 0;
  const transposeUp = (flags & TB303_FLAG_TRANSPOSE_UP) !== 0;
  const transposeDown = (flags & TB303_FLAG_TRANSPOSE_DOWN) !== 0;

  if (!isNote) {
    return {
      index: stepIndex,
      note: -1,
      octave: 3,
      accent,
      slide,
      tie: false,
      gate: 100,
    };
  }

  let octave = 3;
  if (transposeUp) octave = clamp(octave + 1, 1, 5);
  if (transposeDown) octave = clamp(octave - 1, 1, 5);

  return {
    index: stepIndex,
    note: pitch % 12,
    octave,
    accent,
    slide,
    tie: false,
    gate: 100,
  };
}

/**
 * Parse all 32 patterns from a DEVL "303 " device chunk payload.
 */
export function parseTb303DeviceChunk(
  bytes: Uint8Array,
  offset: number,
  size: number = TB303_CHUNK_PAYLOAD_SIZE,
): Tb303PatternA[] {
  if (size < TB303_PATTERN_DATA_OFFSET) return [];

  const params = readTb303Params(bytes, offset);
  const patterns: Tb303PatternA[] = [];

  for (let p = 0; p < TB303_PATTERN_COUNT; p++) {
    const patternOffset = offset + TB303_PATTERN_DATA_OFFSET + p * TB303_PATTERN_SIZE;
    if (patternOffset + TB303_PATTERN_SIZE > offset + size) break;

    const patternLength = clamp(bytes[patternOffset + 1] || 16, 1, 16);
    const steps: Tb303Step[] = [];

    for (let s = 0; s < 16; s++) {
      const stepOffset = patternOffset + TB303_STEP_OFFSET_IN_PATTERN + s * TB303_STEP_SIZE;
      const pitch = bytes[stepOffset] ?? 0;
      const flags = bytes[stepOffset + 1] ?? 0;
      const step = parseDevlTb303Step(s, pitch, flags);
      if (s >= patternLength) {
        step.note = -1;
        step.tie = false;
        step.slide = false;
        step.accent = false;
      }
      steps.push(step);
    }

    patterns.push({ steps, ...params });
  }

  return patterns;
}

function isTriggerOn(value: number): boolean {
  return value === 0x01 || value === 0x02 || value === 0x03;
}

function parseTr808Pattern(
  bytes: Uint8Array,
  patternOffset: number,
  globalTuning?: DrumPattern['tuning'],
): DrumPattern {
  const patternLength = clamp(bytes[patternOffset + 1] || 16, 1, 16);
  const kick: boolean[] = [];
  const snare: boolean[] = [];
  const closedHat: boolean[] = [];
  const openHat: boolean[] = [];
  const accent: number[] = [];

  for (let s = 0; s < 16; s++) {
    const stepBase = patternOffset + TR808_STEP_OFFSET_IN_PATTERN + s * TR808_STEP_INSTRUMENT_COUNT;
    const ac = bytes[stepBase] ?? 0;
    const bd = bytes[stepBase + 1] ?? 0;
    const sd = bytes[stepBase + 2] ?? 0;
    const oh = bytes[stepBase + 10] ?? 0;
    const ch = bytes[stepBase + 11] ?? 0;

    const active = s < patternLength;
    kick.push(active && isTriggerOn(bd));
    snare.push(active && isTriggerOn(sd));
    openHat.push(active && isTriggerOn(oh));
    closedHat.push(active && isTriggerOn(ch));
    accent.push(active && (ac === 0x02 || ac === 0x03) ? 127 : 0);
  }

  return {
    kick,
    snare,
    closedHat,
    openHat,
    accent,
    kitType: '808',
    tuning: globalTuning,
  };
}

function readTr808GlobalTuning(bytes: Uint8Array, offset: number): DrumPattern['tuning'] {
  return {
    kick: ((bytes[offset + 4] ?? 64) - 64) * 0.5,
    snare: ((bytes[offset + 7] ?? 64) - 64) * 0.5,
    closedHat: ((bytes[offset + 28] ?? 64) - 64) * 0.5,
    openHat: ((bytes[offset + 26] ?? 64) - 64) * 0.5,
  };
}

/**
 * Parse all 32 patterns from a DEVL "808 " device chunk payload.
 */
export function parseTr808DeviceChunk(
  bytes: Uint8Array,
  offset: number,
  size: number = TR808_CHUNK_PAYLOAD_SIZE,
): DrumPattern[] {
  if (size < TR808_PATTERN_DATA_OFFSET) return [];

  const tuning = readTr808GlobalTuning(bytes, offset);
  const patterns: DrumPattern[] = [];

  for (let p = 0; p < TR808_PATTERN_COUNT; p++) {
    const patternOffset = offset + TR808_PATTERN_DATA_OFFSET + p * TR808_PATTERN_SIZE;
    if (patternOffset + TR808_PATTERN_SIZE > offset + size) break;
    patterns.push(parseTr808Pattern(bytes, patternOffset, tuning));
  }

  return patterns;
}

function parseTr909Pattern(
  bytes: Uint8Array,
  patternOffset: number,
  globalTuning?: DrumPattern['tuning'],
): DrumPattern {
  const patternLength = clamp(bytes[patternOffset + 1] || 16, 1, 16);
  const kick: boolean[] = [];
  const snare: boolean[] = [];
  const closedHat: boolean[] = [];
  const openHat: boolean[] = [];
  const accent: number[] = [];

  for (let s = 0; s < 16; s++) {
    const stepBase = patternOffset + TR909_STEP_OFFSET_IN_PATTERN + s * TR909_STEP_INSTRUMENT_COUNT;
    const ac = bytes[stepBase] ?? 0;
    const bd = bytes[stepBase + 1] ?? 0;
    const sd = bytes[stepBase + 2] ?? 0;
    const oh = bytes[stepBase + 10] ?? 0;
    const ch = bytes[stepBase + 9] ?? 0;

    const active = s < patternLength;
    kick.push(active && isTriggerOn(bd));
    snare.push(active && isTriggerOn(sd));
    openHat.push(active && isTriggerOn(oh));
    closedHat.push(active && isTriggerOn(ch));
    accent.push(active && (ac === 0x02 || ac === 0x03) ? 127 : 0);
  }

  return {
    kick,
    snare,
    closedHat,
    openHat,
    accent,
    kitType: '909',
    tuning: globalTuning,
  };
}

/**
 * Parse all 32 patterns from a DEVL "909 " device chunk payload.
 */
export function parseTr909DeviceChunk(
  bytes: Uint8Array,
  offset: number,
  size: number = TR909_CHUNK_PAYLOAD_SIZE,
): DrumPattern[] {
  if (size < TR909_PATTERN_DATA_OFFSET) return [];

  const tuning: DrumPattern['tuning'] = {
    kick: ((bytes[offset + 4] ?? 64) - 64) * 0.5,
    snare: ((bytes[offset + 8] ?? 64) - 64) * 0.5,
    closedHat: ((bytes[offset + 23] ?? 64) - 64) * 0.5,
    openHat: ((bytes[offset + 24] ?? 64) - 64) * 0.5,
  };

  const patterns: DrumPattern[] = [];

  for (let p = 0; p < TR909_PATTERN_COUNT; p++) {
    const patternOffset = offset + TR909_PATTERN_DATA_OFFSET + p * TR909_PATTERN_SIZE;
    if (patternOffset + TR909_PATTERN_SIZE > offset + size) break;
    patterns.push(parseTr909Pattern(bytes, patternOffset, tuning));
  }

  return patterns;
}

/** Alias for pattern B (same layout as A in DEVL). */
export type Tb303PatternFromDevl = Tb303PatternA | Tb303PatternB;

// ── MIXR / PCF (DEVL effects chunks, RBS42) ─────────────────────────────────

export const MIXR_CHUNK_PAYLOAD_SIZE = 64;
export const PCF_CHUNK_PAYLOAD_SIZE = 12;

/** MIXR.pcf_id — which device receives PCF (pattern mode routing). */
export const MIXR_PCF_DEVICE_ID = {
  OFF: 0x00,
  TB303_1: 0x02,
  TB303_2: 0x03,
  TR808: 0x04,
  TR909: 0x05,
} as const;

export interface DevlPcfChunkData {
  enabled: boolean;
  cutoff: number;
  resonance: number;
  envAmount: number;
  /** PCF wave / pattern preset index (0–55, RBS42). */
  wave: number;
  decay: number;
  filterType: 'lp' | 'bp';
}

/**
 * Parse DEVL `PCF ` chunk (12 bytes).
 * RBS42: enabled, frequency, resonance, amount, wave, decay, mode (BP/LP).
 */
export function parseDevlPcfChunk(bytes: Uint8Array, offset: number, size = PCF_CHUNK_PAYLOAD_SIZE): DevlPcfChunkData {
  const enabled = (bytes[offset] ?? 0) !== 0;
  return {
    enabled,
    cutoff: clamp(bytes[offset + 1] ?? 64, 0, 127),
    resonance: clamp(bytes[offset + 2] ?? 48, 0, 127),
    envAmount: clamp(bytes[offset + 3] ?? 64, 0, 127),
    wave: clamp(bytes[offset + 4] ?? 0, 0, 55),
    decay: clamp(bytes[offset + 5] ?? 48, 0, 127),
    filterType: (bytes[offset + 6] ?? 0) === 1 ? 'lp' : 'bp',
  };
}

/** Map MIXR `pcf_id` to PCF routing targets. */
export function mixrPcfIdToTargets(pcfDeviceId: number): PcfSettings['target'] {
  switch (pcfDeviceId) {
    case MIXR_PCF_DEVICE_ID.TB303_1:
      return { tb303A: true, tb303B: false, drums: false };
    case MIXR_PCF_DEVICE_ID.TB303_2:
      return { tb303A: false, tb303B: true, drums: false };
    case MIXR_PCF_DEVICE_ID.TR808:
    case MIXR_PCF_DEVICE_ID.TR909:
      return { tb303A: false, tb303B: false, drums: true };
    default:
      // PCF enabled with no explicit route — default to synth A (common ReBirth default)
      return { tb303A: true, tb303B: false, drums: false };
  }
}

/**
 * Expand ReBirth PCF "wave" preset index to a 16-step modulation pattern.
 * IFF DEVL stores wave index (0–55), not per-step bytes (legacy fixed-offset has 16 steps).
 */
export function pcfWaveToStepPattern(waveIndex: number, amount: number, cutoff: number): number[] {
  const amountN = clamp(amount, 0, 127);
  const base = clamp(cutoff, 0, 127);
  const pattern: number[] = [];
  const shape = waveIndex % 8;

  for (let i = 0; i < 16; i++) {
    const t = i / 15;
    let mod: number;
    switch (shape) {
      case 0:
        mod = amountN;
        break;
      case 1:
        mod = amountN * t;
        break;
      case 2:
        mod = amountN * (1 - t);
        break;
      case 3:
        mod = amountN * (0.5 + 0.5 * Math.sin(t * Math.PI));
        break;
      case 4:
        mod = i % 2 === 0 ? amountN : Math.round(amountN * 0.25);
        break;
      case 5:
        mod = amountN * (1 - Math.abs(t - 0.5) * 2);
        break;
      default:
        mod = ((waveIndex * 11 + i * 8 + base) % 128);
        break;
    }
    pattern.push(clamp(Math.round(mod), 0, 127));
  }
  return pattern;
}

/** Build full {@link PcfSettings} from DEVL MIXR + PCF chunks. */
export function buildPcfSettingsFromDevl(
  pcf: DevlPcfChunkData,
  mixrPcfDeviceId: number,
): PcfSettings {
  const targets = pcf.enabled
    ? (mixrPcfDeviceId === MIXR_PCF_DEVICE_ID.OFF
      ? mixrPcfIdToTargets(MIXR_PCF_DEVICE_ID.TB303_1)
      : mixrPcfIdToTargets(mixrPcfDeviceId))
    : { tb303A: false, tb303B: false, drums: false };

  return {
    enabled: pcf.enabled,
    filterType: pcf.filterType,
    cutoff: pcf.cutoff,
    resonance: pcf.resonance,
    envAmount: pcf.envAmount,
    decay: pcf.decay,
    pattern: pcf.enabled
      ? pcfWaveToStepPattern(pcf.wave, pcf.envAmount, pcf.cutoff)
      : Array(16).fill(0),
    waveIndex: pcf.wave,
    target: targets,
  };
}

/** Parse MIXR chunk and return `pcf_id` routing byte. */
export function parseDevlMixrPcfDeviceId(bytes: Uint8Array, offset: number): number {
  return bytes[offset + 2] ?? 0;
}

/** Disabled PCF placeholder (not the dev mock sweep). */
export function disabledPcfSettings(): PcfSettings {
  return {
    enabled: false,
    filterType: 'lp',
    cutoff: 64,
    resonance: 48,
    envAmount: 64,
    decay: 48,
    pattern: Array(16).fill(0),
    target: { tb303A: false, tb303B: false, drums: false },
  };
}

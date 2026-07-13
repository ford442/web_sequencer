import type {
  RbsBinaryHeader, Tb303PatternA, Tb303PatternB, DrumPattern, PcfSettings,
  AutomationLane, RbsRawStep,
} from '../types';
import { AUTOMATION_PARAMETER_MAP } from '../types';
import type { RbsParserError } from '../parser-types';
import { OFFSETS, STEP_COUNT, STEP_SIZE } from '../parser-types';
import type { ParserBinaryContext } from './parserContext';
import {
  readNullTerminatedString,
  readAsciiString,
  convertSignedByte,
  convertSignedByteWithOffset,
  clamp,
} from './binaryIO';
import { getAutomationDisplayName, getAutomationRange } from './automationMeta';

export function parseHeader(
  ctx: ParserBinaryContext,
): { success: true; data: RbsBinaryHeader } | { success: false; error: RbsParserError } {
  try {
    const magicBytes = new Uint8Array(ctx.rawBytes.buffer, OFFSETS.HEADER, 5);
    const magic = String.fromCharCode(...magicBytes);

    if (magic !== 'RB338') {
      const altMagic = readAsciiString(ctx, OFFSETS.HEADER, 5);
      if (altMagic !== 'RB338') {
        return {
          success: false,
          error: {
            type: 'INVALID_FORMAT',
            message: `Invalid magic bytes: expected "RB338", got "${magic}" (hex: ${Array.from(magicBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')})`,
          },
        };
      }
    }

    const versionMajor = ctx.rawBytes[OFFSETS.HEADER + 0x08];
    const versionMinor = ctx.rawBytes[OFFSETS.HEADER + 0x09];
    const version = `${versionMajor}.${versionMinor}`;

    const patternLength = ctx.rawBytes[OFFSETS.HEADER + 0x0A];
    if (patternLength !== 16 && patternLength !== 32) {
      console.warn(`[RbsParser] Non-standard pattern length: ${patternLength}`);
    }

    const tempo = ctx.rawBytes[OFFSETS.HEADER + 0x0B];
    if (tempo < 40 || tempo > 250) {
      console.warn(`[RbsParser] Unusual tempo value: ${tempo}`);
    }

    const timeSignatureNum = ctx.rawBytes[OFFSETS.HEADER + 0x0C] || 4;
    const timeSignatureDen = ctx.rawBytes[OFFSETS.HEADER + 0x0D] || 4;
    const swing = ctx.rawBytes[OFFSETS.HEADER + 0x0E];
    const songName = readNullTerminatedString(ctx, OFFSETS.HEADER + 0x10, 48);

    return {
      success: true,
      data: {
        magic,
        versionMajor,
        versionMinor,
        version,
        patternLength,
        tempo,
        timeSignatureNum,
        timeSignatureDen,
        swing,
        songName,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: {
        type: 'CORRUPTED_DATA',
        section: 'header',
        details: error instanceof Error ? error.message : 'Unknown header parse error',
        offset: 0,
      },
    };
  }
}

export function parseRawStep(ctx: ParserBinaryContext, offset: number): RbsRawStep {
  const note = ctx.rawBytes[offset + 0];
  const octave = ctx.rawBytes[offset + 1];
  const flags = ctx.rawBytes[offset + 2];
  const gate = ctx.rawBytes[offset + 3];

  return { note, octave, flags, gate };
}

export function convertRawStepToTb303Step(
  index: number,
  raw: RbsRawStep,
): Tb303PatternA['steps'][0] {
  let note: number;
  let tie = false;

  if (raw.note === 255) {
    note = -1;
  } else if (raw.note === 254) {
    note = -1;
    tie = true;
  } else {
    note = raw.note % 12;
  }

  const accent = (raw.flags & 0x01) !== 0;
  const slide = (raw.flags & 0x02) !== 0;
  const tieFlag = (raw.flags & 0x04) !== 0 || tie;

  return {
    index,
    note,
    octave: clamp(raw.octave, 1, 5),
    accent,
    slide,
    tie: tieFlag,
    gate: clamp(raw.gate, 0, 100),
  };
}

export function parseTb303PatternA(ctx: ParserBinaryContext): Tb303PatternA {
  const baseOffset = OFFSETS.TB303_A;

  const cutoff = ctx.rawBytes[baseOffset + 0x00];
  const resonance = ctx.rawBytes[baseOffset + 0x01];
  const envMod = ctx.rawBytes[baseOffset + 0x02];
  const decay = ctx.rawBytes[baseOffset + 0x03];
  const accent = ctx.rawBytes[baseOffset + 0x04];
  const waveform = ctx.rawBytes[baseOffset + 0x05] as 0 | 1;
  const distortion = ctx.rawBytes[baseOffset + 0x06];
  const delaySend = ctx.rawBytes[baseOffset + 0x07];

  const steps: Tb303PatternA['steps'] = [];
  const stepsStartOffset = baseOffset + 0x08;

  for (let i = 0; i < STEP_COUNT; i++) {
    const stepOffset = stepsStartOffset + (i * STEP_SIZE);
    const rawStep = parseRawStep(ctx, stepOffset);
    steps.push(convertRawStepToTb303Step(i, rawStep));
  }

  return {
    steps,
    cutoff: clamp(cutoff, 0, 127),
    resonance: clamp(resonance, 0, 127),
    envMod: clamp(envMod, 0, 127),
    decay: clamp(decay, 0, 127),
    accent: clamp(accent, 0, 127),
    waveform: waveform === 0 ? 0 : 1,
    distortion: clamp(distortion, 0, 127),
    delaySend: clamp(delaySend, 0, 127),
  };
}

export function parseTb303PatternB(ctx: ParserBinaryContext): Tb303PatternB {
  const baseOffset = OFFSETS.TB303_B;

  const cutoff = ctx.rawBytes[baseOffset + 0x00];
  const resonance = ctx.rawBytes[baseOffset + 0x01];
  const envMod = ctx.rawBytes[baseOffset + 0x02];
  const decay = ctx.rawBytes[baseOffset + 0x03];
  const accent = ctx.rawBytes[baseOffset + 0x04];
  const waveform = ctx.rawBytes[baseOffset + 0x05] as 0 | 1;
  const distortion = ctx.rawBytes[baseOffset + 0x06];
  const delaySend = ctx.rawBytes[baseOffset + 0x07];

  const transposeRaw = ctx.rawBytes[baseOffset + 0x08];
  const transpose = convertSignedByte(transposeRaw);

  const steps: Tb303PatternB['steps'] = [];
  const stepsStartOffset = baseOffset + 0x09;

  for (let i = 0; i < STEP_COUNT; i++) {
    const stepOffset = stepsStartOffset + (i * STEP_SIZE);
    const rawStep = parseRawStep(ctx, stepOffset);
    steps.push(convertRawStepToTb303Step(i, rawStep));
  }

  return {
    steps,
    cutoff: clamp(cutoff, 0, 127),
    resonance: clamp(resonance, 0, 127),
    envMod: clamp(envMod, 0, 127),
    decay: clamp(decay, 0, 127),
    accent: clamp(accent, 0, 127),
    waveform: waveform === 0 ? 0 : 1,
    distortion: clamp(distortion, 0, 127),
    delaySend: clamp(delaySend, 0, 127),
    transpose: clamp(transpose, -12, 12),
  };
}

export function parseDrumPatterns(ctx: ParserBinaryContext): DrumPattern {
  const baseOffset = OFFSETS.DRUMS;

  const kick: boolean[] = [];
  const snare: boolean[] = [];
  const closedHat: boolean[] = [];
  const openHat: boolean[] = [];
  const accent: number[] = [];

  for (let i = 0; i < STEP_COUNT; i++) {
    kick.push(ctx.rawBytes[baseOffset + i] !== 0);
    snare.push(ctx.rawBytes[baseOffset + 0x10 + i] !== 0);
    closedHat.push(ctx.rawBytes[baseOffset + 0x20 + i] !== 0);
    openHat.push(ctx.rawBytes[baseOffset + 0x30 + i] !== 0);
    accent.push(ctx.rawBytes[baseOffset + 0x40 + i]);
  }

  const paramsOffset = baseOffset + 0x50;
  const kitTypeNum = ctx.rawBytes[paramsOffset + 0];
  const kitType: '808' | '909' = kitTypeNum === 0 ? '808' : '909';

  const kickTune = convertSignedByteWithOffset(ctx.rawBytes[paramsOffset + 1], 50);
  const snareTune = convertSignedByteWithOffset(ctx.rawBytes[paramsOffset + 2], 50);
  const closedHatTune = convertSignedByteWithOffset(ctx.rawBytes[paramsOffset + 3], 50);
  const openHatTune = convertSignedByteWithOffset(ctx.rawBytes[paramsOffset + 4], 50);

  const kickDecay = ctx.rawBytes[paramsOffset + 5];
  const snareDecay = ctx.rawBytes[paramsOffset + 6];
  const closedHatDecay = ctx.rawBytes[paramsOffset + 7];
  const openHatDecay = ctx.rawBytes[paramsOffset + 8];

  return {
    kick,
    snare,
    closedHat,
    openHat,
    accent,
    kitType,
    tuning: {
      kick: clamp(kickTune, -50, 50),
      snare: clamp(snareTune, -50, 50),
      closedHat: clamp(closedHatTune, -50, 50),
      openHat: clamp(openHatTune, -50, 50),
    },
    decay: {
      kick: clamp(kickDecay, 0, 127),
      snare: clamp(snareDecay, 0, 127),
      closedHat: clamp(closedHatDecay, 0, 127),
      openHat: clamp(openHatDecay, 0, 127),
    },
  };
}

export function parsePcfSettings(ctx: ParserBinaryContext): PcfSettings {
  const baseOffset = OFFSETS.PCF;

  const enabled = ctx.rawBytes[baseOffset + 0] !== 0;
  const filterTypeNum = ctx.rawBytes[baseOffset + 1];
  const cutoff = ctx.rawBytes[baseOffset + 2];
  const resonance = ctx.rawBytes[baseOffset + 3];
  const envAmount = ctx.rawBytes[baseOffset + 4];
  const decay = ctx.rawBytes[baseOffset + 5];
  const targetA = ctx.rawBytes[baseOffset + 6] !== 0;
  const targetB = ctx.rawBytes[baseOffset + 7] !== 0;
  const targetDrums = ctx.rawBytes[baseOffset + 8] !== 0;

  const pattern: number[] = [];
  for (let i = 0; i < STEP_COUNT; i++) {
    pattern.push(ctx.rawBytes[baseOffset + 9 + i]);
  }

  const filterTypeMap: Record<number, 'lp' | 'bp' | 'hp'> = {
    0: 'lp',
    1: 'bp',
    2: 'hp',
  };

  return {
    enabled,
    filterType: filterTypeMap[filterTypeNum] || 'lp',
    cutoff: clamp(cutoff, 0, 127),
    resonance: clamp(resonance, 0, 127),
    envAmount: clamp(envAmount, 0, 127),
    decay: clamp(decay, 0, 127),
    pattern: pattern.map(v => clamp(v, 0, 127)),
    target: {
      tb303A: targetA,
      tb303B: targetB,
      drums: targetDrums,
    },
  };
}

export function parseAutomation(ctx: ParserBinaryContext): AutomationLane[] {
  const baseOffset = OFFSETS.AUTOMATION;
  const lanes: AutomationLane[] = [];

  if (ctx.fileSize <= baseOffset) {
    return lanes;
  }

  try {
    const laneCount = ctx.rawBytes[baseOffset];
    let currentOffset = baseOffset + 1;

    for (let laneIdx = 0; laneIdx < laneCount; laneIdx++) {
      if (currentOffset + 2 > ctx.fileSize) {
        console.warn(`[RbsParser] Automation truncated at lane ${laneIdx}`);
        break;
      }

      const parameterId = ctx.rawBytes[currentOffset];
      const pointCount = ctx.rawBytes[currentOffset + 1];
      currentOffset += 2;

      const points: [number, number][] = [];
      for (let ptIdx = 0; ptIdx < pointCount; ptIdx++) {
        if (currentOffset + 3 > ctx.fileSize) {
          console.warn(`[RbsParser] Automation point ${ptIdx} truncated in lane ${laneIdx}`);
          break;
        }

        const step = ctx.rawBytes[currentOffset];
        const value = ctx.dataView.getUint16(currentOffset + 1, true);
        points.push([step, value]);
        currentOffset += 3;
      }

      const parameterName = AUTOMATION_PARAMETER_MAP[parameterId] || `param${parameterId}`;
      const displayName = getAutomationDisplayName(parameterName);
      const range = getAutomationRange(parameterName);

      lanes.push({
        parameter: parameterName as AutomationLane['parameter'],
        name: displayName,
        points,
        interpolation: 'linear',
        range,
      });
    }
  } catch (error) {
    console.warn('[RbsParser] Error parsing automation:', error);
  }

  return lanes;
}

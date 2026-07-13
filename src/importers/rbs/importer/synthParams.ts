import type {
  RawRbsData, HyphonSong, DetailedParameterMapping, Tb303PatternA,
} from '../types';
import type {
  SynthParams, KickParams, SnareParams, HatParams, Bass2Params, Waveform,
} from '../../../types';
import { clampNormalized, TB303_DEFAULT_SLIDE_TIME } from '../importer-types';
import { inferDevicesPresent, drumBankHasTriggers } from '../deviceInference';
import {
  convertCutoffToHz,
  convertResonance,
  convertDecayToSeconds,
  convertAccentToBoost,
  mapRange,
} from './parameterCurves';
import type { ImporterContext } from './importerContext';

/** Convert TB-303 params to Bass2Params (Open303 format). */
export function convertToBass2Params(
  tb303: {
    cutoff: number;
    resonance: number;
    decay: number;
    accent: number;
    waveform: 0 | 1;
    envMod?: number;
    slideTime?: number;
  },
  sourceName: string,
  mappings?: DetailedParameterMapping[],
): Bass2Params {
  const cutoff = convertCutoffToHz(tb303.cutoff);
  const resonance = convertResonance(tb303.resonance);
  const decay = convertDecayToSeconds(tb303.decay);
  const accent = 0.5 + convertAccentToBoost(tb303.accent);

  const rawSlideTime = tb303.slideTime ?? TB303_DEFAULT_SLIDE_TIME;
  const slideTime = clampNormalized(rawSlideTime / 127);

  if (mappings) {
    mappings.push({
      source: `${sourceName}.cutoff`,
      target: 'Bass2Params.cutoff',
      originalValue: tb303.cutoff,
      convertedValue: Math.round(cutoff),
      formula: '100 * 2^(cutoff / 21.17) Hz',
    });
    mappings.push({
      source: `${sourceName}.slideTime`,
      target: 'Bass2Params.slideTime',
      originalValue: rawSlideTime,
      convertedValue: parseFloat(slideTime.toFixed(3)),
      formula: 'slideTime / 127 (0-1 normalized, TB-303 default ≈ 0.33)',
    });
  }

  return {
    waveform: tb303.waveform === 0 ? '303-saw' : '303-sqr',
    pitch: 0,
    cutoff,
    resonance,
    filterMode: 1,
    decay,
    accent,
    envMod: (tb303.envMod ?? 64) / 127,
    volume: 0.9,
    slideTime: (tb303.slideTime ?? TB303_DEFAULT_SLIDE_TIME) / 127,
  };
}

/** Map TB-303 pattern device params to Hyphon synth params (no mapping report noise). */
export function mapTb303PatternToSynthParams(
  tb303: Tb303PatternA,
  asBass2: boolean,
): Partial<SynthParams> | Partial<Bass2Params> {
  if (asBass2) {
    return convertToBass2Params(tb303, 'tb303B', undefined);
  }
  const waveform: Waveform = tb303.waveform === 0 ? '303-saw' : '303-sqr';
  const cutoffHz = convertCutoffToHz(tb303.cutoff);
  const resonance = convertResonance(tb303.resonance);
  const decaySeconds = convertDecayToSeconds(tb303.decay);
  const filterMode = clampNormalized(tb303.envMod / 127);
  const volume = 0.6 + convertAccentToBoost(tb303.accent);
  const portamento = clampNormalized((tb303.slideTime ?? TB303_DEFAULT_SLIDE_TIME) / 127);
  return {
    waveform,
    pitch: 0,
    filterCutoff: cutoffHz,
    filterResonance: resonance,
    filterMode,
    attack: 0.01,
    decay: decaySeconds,
    sustain: 0.5,
    release: 0.1,
    volume,
    portamento,
  };
}

export function buildTrackParamSlots(
  patterns: Tb303PatternA[],
  maxSlots: number,
  asBass2: boolean,
): (Partial<SynthParams> | Partial<Bass2Params> | null)[] {
  const slots: (Partial<SynthParams> | Partial<Bass2Params> | null)[] = Array(maxSlots).fill(null);
  const count = Math.min(maxSlots, patterns.length);
  for (let i = 0; i < count; i++) {
    slots[i] = mapTb303PatternToSynthParams(patterns[i], asBass2);
  }
  return slots;
}

/** Resolve drum kit for import. */
export function resolveDrumKitType(ctx: ImporterContext, raw: RawRbsData): '808' | '909' {
  if (ctx.options.drumKitMapping !== 'auto') {
    return ctx.options.drumKitMapping;
  }

  const banks = raw.songData?.patternBanks;
  if (banks) {
    const has808 = drumBankHasTriggers(banks.drums808);
    const has909 = drumBankHasTriggers(banks.drums909);
    if (has808 && !has909) return '808';
    if (has909 && !has808) return '909';
  }

  const devices = raw.devicesPresent ?? inferDevicesPresent(raw);
  if (devices.includes('808') && !devices.includes('909')) return '808';
  if (devices.includes('909') && !devices.includes('808')) return '909';

  return raw.drums.kitType;
}

/** Convert drum parameters with kit-specific mapping (808 vs 909). */
export function convertDrumParams(
  drums: RawRbsData['drums'],
  mappings: DetailedParameterMapping[],
  kitType: '808' | '909',
): { kick: KickParams; snare: SnareParams; closedHat: HatParams; openHat: HatParams } {
  const kickTone = kitType === '808' ? 0.6 : 0.8;
  const snareTone = kitType === '808' ? 200 : 300;
  const snareNoise = kitType === '808' ? 2000 : 4000;

  const kick: KickParams = {
    pitch: mapRange(drums.tuning?.kick ?? 0, -50, 50, 40, 80),
    decay: mapRange(drums.decay?.kick ?? 64, 0, 127, 0.1, 1.0),
    tone: kickTone,
    volume: 1.0,
  };

  mappings.push({
    source: `Drums.${kitType}.kick.tone`,
    target: 'KickParams.tone',
    originalValue: kitType,
    convertedValue: kickTone,
    formula: kitType === '808' ? '808: more body (0.6)' : '909: tighter (0.8)',
  });

  const snare: SnareParams = {
    decay: mapRange(drums.decay?.snare ?? 48, 0, 127, 0.1, 0.8),
    tone: snareTone,
    noise: snareNoise,
    volume: 0.9,
  };

  mappings.push({
    source: `Drums.${kitType}.snare.tone`,
    target: 'SnareParams.tone',
    originalValue: kitType,
    convertedValue: snareTone,
    formula: kitType === '808' ? '808: lower pitch (200)' : '909: higher pitch (300)',
  });
  mappings.push({
    source: `Drums.${kitType}.snare.noise`,
    target: 'SnareParams.noise',
    originalValue: kitType,
    convertedValue: snareNoise,
    formula: kitType === '808' ? '808: less snap (2000)' : '909: more snap (4000)',
  });

  const closedHat: HatParams = {
    pitch: mapRange(drums.tuning?.closedHat ?? 0, -50, 50, 8000, 12000),
    decay: mapRange(drums.decay?.closedHat ?? 32, 0, 127, 0.05, 0.3),
    volume: 0.8,
  };

  const openHat: HatParams = {
    pitch: mapRange(drums.tuning?.openHat ?? 0, -50, 50, 6000, 10000),
    decay: mapRange(drums.decay?.openHat ?? 64, 0, 127, 0.2, 0.8),
    volume: 0.8,
  };

  return { kick, snare, closedHat, openHat };
}

/** Convert synth parameters from RBS to Hyphon. */
export function convertSynthParams(
  ctx: ImporterContext,
  raw: RawRbsData,
  mappings: DetailedParameterMapping[],
): HyphonSong['params'] {
  const map303ToSynthParams = (
    tb303: {
      cutoff: number;
      resonance: number;
      envMod: number;
      decay: number;
      accent: number;
      waveform: 0 | 1;
      slideTime?: number;
    },
    sourceName: string,
  ): SynthParams => {
    const waveform: Waveform = tb303.waveform === 0 ? '303-saw' : '303-sqr';
    const cutoffHz = convertCutoffToHz(tb303.cutoff);
    const resonance = convertResonance(tb303.resonance);
    const decaySeconds = convertDecayToSeconds(tb303.decay);
    const filterMode = clampNormalized(tb303.envMod / 127);
    const accentBoost = convertAccentToBoost(tb303.accent);
    const volume = 0.6 + accentBoost;
    const rawSlideTime = tb303.slideTime ?? TB303_DEFAULT_SLIDE_TIME;
    const portamento = clampNormalized(rawSlideTime / 127);

    mappings.push({
      source: `${sourceName}.cutoff`,
      target: 'SynthParams.filterCutoff',
      originalValue: tb303.cutoff,
      convertedValue: Math.round(cutoffHz),
      formula: '100 * 2^(cutoff / 21.17) Hz',
    });
    mappings.push({
      source: `${sourceName}.resonance`,
      target: 'SynthParams.filterResonance',
      originalValue: tb303.resonance,
      convertedValue: parseFloat(resonance.toFixed(2)),
      formula: 'resonance / 6.35',
    });
    mappings.push({
      source: `${sourceName}.envMod`,
      target: 'SynthParams.filterMode',
      originalValue: tb303.envMod,
      convertedValue: parseFloat(filterMode.toFixed(3)),
      formula: 'envMod / 127 (0-1 normalized)',
    });
    mappings.push({
      source: `${sourceName}.decay`,
      target: 'SynthParams.decay',
      originalValue: tb303.decay,
      convertedValue: parseFloat(decaySeconds.toFixed(3)),
      formula: '0.05 * 40^(decay / 127) seconds',
    });
    mappings.push({
      source: `${sourceName}.accent`,
      target: 'SynthParams.volume',
      originalValue: tb303.accent,
      convertedValue: parseFloat(volume.toFixed(2)),
      formula: '0.6 + (accent / 317.5)',
    });
    mappings.push({
      source: `${sourceName}.waveform`,
      target: 'SynthParams.waveform',
      originalValue: tb303.waveform,
      convertedValue: waveform,
    });
    mappings.push({
      source: `${sourceName}.slideTime`,
      target: 'SynthParams.portamento',
      originalValue: rawSlideTime,
      convertedValue: parseFloat(portamento.toFixed(3)),
      formula: 'slideTime / 127 (0-1 normalized, TB-303 default ≈ 0.33)',
    });

    return {
      waveform,
      pitch: 0,
      filterCutoff: cutoffHz,
      filterResonance: resonance,
      filterMode,
      attack: 0.01,
      decay: decaySeconds,
      sustain: 0.5,
      release: decaySeconds * 0.5,
      length: 0.25,
      volume,
      delayTime: 0.3,
      delayFeedback: 0.2,
      delayMix: 0.0,
      portamento,
    };
  };

  const synthA = map303ToSynthParams(raw.tb303PatternA, 'TB-303A');
  const synthB = map303ToSynthParams(raw.tb303PatternB, 'TB-303B');

  const bass2Params: Bass2Params | undefined =
    ctx.options.tb303ATarget === 'bass2' ? convertToBass2Params(raw.tb303PatternA, 'TB-303A', mappings) :
      ctx.options.tb303BTarget === 'bass2' ? convertToBass2Params(raw.tb303PatternB, 'TB-303B', mappings) :
        undefined;

  let drumKit = resolveDrumKitType(ctx, raw);
  if (ctx.options.drumKitMapping !== 'auto') {
    drumKit = ctx.options.drumKitMapping;
  }
  const { kick, snare, closedHat, openHat } = convertDrumParams(raw.drums, mappings, drumKit);

  return {
    synthA,
    synthB,
    bass2: bass2Params,
    kick,
    snare,
    closedHat,
    openHat,
    drumKit,
  };
}

import { describe, it, expect } from 'vitest';
import { TsVocalFx } from '../vocalFx';
import type { VocalFxBlock } from '../vocalFx';

describe('TsVocalFx - consonantSaturation', () => {
  it('does not modify signal when consonantSaturation is 0', () => {
    const fx = new TsVocalFx(48000);
    const block: VocalFxBlock = {
      consonantSaturation: 0,
      hasPhonemeContext: true,
      isVowel: 0,
      phonemeIndex: 1,
      phonemeVolume: 1.0,
      phonemeFilterMod: 0,
      volumeFilterMod: 0,
      syllableVolume: 1,
      gateDepth: 0,
      gateRate: 4,
      consonantClarity: 0,
      transientExtraction: 0,
      spectralComp: 0,
      grainPanSpread: 0,
      vocalChorus: 0,
      subHarmonics: 0,
      duckingScalar: 0,
      drumIsSnare: 0,
      bitcrush: 0,
      downsample: 1,
      envelopeValue: 0,
      grainJitter: 0,
      grainEnvDepth: 0,
      windowShape: 0,
      grainLfoDepth: 0,
      grainPosLfoDepth: 0,
      velocity: 1.0,
      timeSmear: 0,
      bassEnvelopeValue: 0,
      bassEnvDepth: 0,
      phonemeGrainJitter: -1,
      phonemeGrainSizeMs: -1,
    };

    const input = new Float32Array([0.5, -0.5, 0.1]);
    const left = new Float32Array(input);
    const right = new Float32Array(input);

    fx.process(block, left, right);

    expect(left[0]).toBeCloseTo(0.5);
    expect(left[1]).toBeCloseTo(-0.5);
    expect(left[2]).toBeCloseTo(0.1);
  });

  it('clips unvoiced blocks (isVowel = 0) and leaves vowels (isVowel = 1) alone', () => {
    const fx = new TsVocalFx(48000);
    const block: VocalFxBlock = {
      consonantSaturation: 1.0,
      hasPhonemeContext: true,
      isVowel: 0,
      phonemeIndex: 1,
      phonemeVolume: 1.0,
      phonemeFilterMod: 0, volumeFilterMod: 0, syllableVolume: 1, gateDepth: 0, gateRate: 4,
      consonantClarity: 0, transientExtraction: 0, spectralComp: 0, grainPanSpread: 0,
      vocalChorus: 0, subHarmonics: 0, duckingScalar: 0, drumIsSnare: 0, bitcrush: 0,
      downsample: 1, envelopeValue: 0, grainJitter: 0, grainEnvDepth: 0, windowShape: 0,
      grainLfoDepth: 0, grainPosLfoDepth: 0, velocity: 1.0, timeSmear: 0, bassEnvelopeValue: 0,
      bassEnvDepth: 0, phonemeGrainJitter: -1, phonemeGrainSizeMs: -1,
    };

    const input = new Float32Array([0.5, -0.5]);
    const leftUnvoiced = new Float32Array(input);
    const rightUnvoiced = new Float32Array(input);
    fx.process(block, leftUnvoiced, rightUnvoiced);

    expect(leftUnvoiced[0]).not.toBeCloseTo(0.5, 5);

    block.isVowel = 1;
    const leftVowel = new Float32Array(input);
    const rightVowel = new Float32Array(input);
    fx.process(block, leftVowel, rightVowel);

    expect(leftVowel[0]).toBeCloseTo(0.5);
    expect(leftVowel[1]).toBeCloseTo(-0.5);
  });

  it('does nothing if hasPhonemeContext is false', () => {
    const fx = new TsVocalFx(48000);
    const block: VocalFxBlock = {
      consonantSaturation: 1.0,
      hasPhonemeContext: false,
      isVowel: 0,
      phonemeIndex: 1,
      phonemeVolume: 1.0,
      phonemeFilterMod: 0, volumeFilterMod: 0, syllableVolume: 1, gateDepth: 0, gateRate: 4,
      consonantClarity: 0, transientExtraction: 0, spectralComp: 0, grainPanSpread: 0,
      vocalChorus: 0, subHarmonics: 0, duckingScalar: 0, drumIsSnare: 0, bitcrush: 0,
      downsample: 1, envelopeValue: 0, grainJitter: 0, grainEnvDepth: 0, windowShape: 0,
      grainLfoDepth: 0, grainPosLfoDepth: 0, velocity: 1.0, timeSmear: 0, bassEnvelopeValue: 0,
      bassEnvDepth: 0, phonemeGrainJitter: -1, phonemeGrainSizeMs: -1,
    };

    const input = new Float32Array([0.5, -0.5]);
    const left = new Float32Array(input);
    const right = new Float32Array(input);
    fx.process(block, left, right);

    expect(left[0]).toBeCloseTo(0.5);
    expect(left[1]).toBeCloseTo(-0.5);
  });
});
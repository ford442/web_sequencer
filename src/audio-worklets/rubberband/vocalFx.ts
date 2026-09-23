import { GranularEngine } from "./granularEngine";
import { SpectralBandProcessor } from "./spectralEffects";
import { VocalChorusEffect } from "./chorusEffect";
import { SubHarmonicsEffect } from "./subHarmonics";
import { Bitcrusher } from "./bitcrusher";
import { PhonemeToneFilter, SyllableVolumeFilter, TranceGate } from "./toneFilters";
import { DrumDuckEnvelope } from "./drumDuckEnvelope";

export type VocalFxBackend = 'native' | 'ts';

/**
 * Per-block controls for the singing-voice FX chain. The worklet fills one
 * pre-allocated instance per block; both backends read the same fields.
 */
export interface VocalFxBlock {
  /** Playing with phoneme data + ratios: the phoneme* fields below apply. */
  hasPhonemeContext: boolean;
  phonemeVolume: number;
  isVowel: number;
  phonemeGrainJitter: number;
  phonemeGrainSizeMs: number;

  phonemeFilterMod: number;
  /** Already gated on "playing with phoneme data" by the worklet. */
  volumeFilterMod: number;
  syllableVolume: number;
  gateDepth: number;
  gateRate: number;
  spectralComp: number;
  grainPanSpread: number;
  vocalChorus: number;
  subHarmonics: number;
  duckingScalar: number;
  drumIsSnare: number;
  bitcrush: number;
  downsample: number;

  envelopeValue: number;
  grainJitter: number;
  grainEnvDepth: number;
  windowShape: number;
  grainLfoDepth: number;
  grainPosLfoDepth: number;
  /** Note velocity 0..1 (noteOn); softer notes jitter the grains more. */
  velocity: number;
}

export function createVocalFxBlock(): VocalFxBlock {
  return {
    hasPhonemeContext: false,
    phonemeVolume: 1,
    isVowel: 0,
    phonemeGrainJitter: -1,
    phonemeGrainSizeMs: -1,
    phonemeFilterMod: 0,
    volumeFilterMod: 0,
    syllableVolume: 1,
    gateDepth: 0,
    gateRate: 4,
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
    velocity: 1,
  };
}

/**
 * The singing-voice FX chain as the worklet schedules it: the freeze
 * granulator feeding the stretcher, then the post-retrieve chain.
 */
export interface VocalFxChain {
  readonly backend: VocalFxBackend;
  setSampleBuffer(buffer: Float32Array): void;
  setCustomWindowShape(shape: Float32Array | null): void;
  setCustomGrainEnvelope(shape: ArrayLike<number> | null): void;
  noteOn(): void;
  /** Advances the freeze / grain LFOs; returns the freeze LFO value. */
  advanceLfo(freezeLfoRate: number, grainLfoRate: number, frames: number): number;
  /**
   * Enters freeze and granulates `frames` samples into heap[offset..] (the
   * stretcher input). Returns frames to feed, 0 to feed none, -1 to skip.
   */
  renderGrains(
    block: VocalFxBlock,
    heap: Float32Array,
    offset: number,
    frames: number,
    currentSample: number,
    startSample: number,
    endSample: number,
  ): number;
  exitFreeze(): void;
  /** Post-retrieve chain: reads mono `left`, writes stereo `left` / `right`. */
  process(block: VocalFxBlock, left: Float32Array, right: Float32Array): void;
  dispose(): void;
}

/**
 * The pre-native chain, composed from the TS modules in this directory. Kept
 * as the golden-test oracle and as the fallback when rubberband.wasm lacks the
 * rb_fx_* exports — never the default hot path.
 */
export class TsVocalFx implements VocalFxChain {
  readonly backend = 'ts' as const;

  private readonly granular: GranularEngine;
  private readonly spectral = new SpectralBandProcessor();
  private readonly chorus = new VocalChorusEffect();
  private readonly subHarmonicsFx = new SubHarmonicsEffect();
  private readonly bitcrusher = new Bitcrusher();
  private readonly phonemeToneFilter = new PhonemeToneFilter();
  private readonly syllableVolumeFilter = new SyllableVolumeFilter();
  private readonly tranceGate = new TranceGate();
  private readonly drumDuck = new DrumDuckEnvelope();

  private sampleBuffer: Float32Array = new Float32Array(0);
  private readonly outputs: Float32Array[][] = [[new Float32Array(0), new Float32Array(0)]];
  private readonly grainParams = {
    fullSampleBuffer: new Float32Array(0) as Float32Array,
    sampleRate: 0,
    hasPhonemeContext: false,
    phonemeVolume: 1,
    phonemeGrainJitter: -1,
    phonemeGrainSizeMs: -1,
    currentSamplePtr: 0,
    startSamplePtr: 0,
    endSamplePtr: 0,
    duckingScalar: 0,
    envelopeValue: 0,
    grainJitterParam: 0,
    grainEnvDepth: 0,
    windowShape: 0,
    grainLfoDepth: 0,
    grainPosLfoDepth: 0,
    velocity: 1,
  };
  private readonly bandSplitParams = {
    outL: new Float32Array(0) as Float32Array,
    outR: undefined as Float32Array | undefined,
    hasStereo: true,
    spectralComp: 0,
    grainPanSpread: 0,
    grainPanL: [] as readonly number[],
    grainPanR: [] as readonly number[],
    sampleRate: 0,
  };

  private readonly sampleRate: number;

  constructor(sampleRate: number, random: () => number = Math.random) {
    this.sampleRate = sampleRate;
    this.granular = new GranularEngine(random);
  }

  setSampleBuffer(buffer: Float32Array): void {
    this.sampleBuffer = buffer;
  }

  setCustomWindowShape(shape: Float32Array | null): void {
    this.granular.setCustomWindowShape(shape);
  }

  setCustomGrainEnvelope(shape: ArrayLike<number> | null): void {
    this.granular.setCustomGrainEnvelope(shape ? Array.from(shape) : null);
  }

  noteOn(): void {
    this.syllableVolumeFilter.resetHoldState();
  }

  advanceLfo(freezeLfoRate: number, grainLfoRate: number, frames: number): number {
    this.granular.advanceLfoPhases(freezeLfoRate, grainLfoRate, this.sampleRate, frames);
    return this.granular.getFreezeLfoValue();
  }

  renderGrains(
    block: VocalFxBlock,
    heap: Float32Array,
    offset: number,
    frames: number,
    currentSample: number,
    startSample: number,
    endSample: number,
  ): number {
    this.granular.enterFreeze();
    const p = this.grainParams;
    p.fullSampleBuffer = this.sampleBuffer;
    p.sampleRate = this.sampleRate;
    p.hasPhonemeContext = block.hasPhonemeContext;
    p.phonemeVolume = block.phonemeVolume;
    p.phonemeGrainJitter = block.phonemeGrainJitter;
    p.phonemeGrainSizeMs = block.phonemeGrainSizeMs;
    p.currentSamplePtr = currentSample;
    p.startSamplePtr = startSample;
    p.endSamplePtr = endSample;
    p.duckingScalar = block.duckingScalar;
    p.envelopeValue = block.envelopeValue;
    p.grainJitterParam = block.grainJitter;
    p.grainEnvDepth = block.grainEnvDepth;
    p.windowShape = block.windowShape;
    p.grainLfoDepth = block.grainLfoDepth;
    p.grainPosLfoDepth = block.grainPosLfoDepth;
    p.velocity = block.velocity;
    return this.granular.renderGrains(p, heap, offset, frames);
  }

  exitFreeze(): void {
    this.granular.exitFreeze();
  }

  process(block: VocalFxBlock, left: Float32Array, right: Float32Array): void {
    const outputs = this.outputs;
    outputs[0][0] = left;
    outputs[0][1] = right;
    const fs = this.sampleRate;

    this.phonemeToneFilter.process(
      left, block.phonemeFilterMod, block.hasPhonemeContext ? block.phonemeVolume : null, fs,
    );
    if (block.volumeFilterMod > 0) {
      this.syllableVolumeFilter.process(outputs, block.volumeFilterMod, block.syllableVolume, block.isVowel, fs);
    }
    this.tranceGate.process(left, block.gateDepth, block.gateRate, fs);

    this.granular.updateGrainPan(block.grainPanSpread, block.isVowel);
    const band = this.bandSplitParams;
    band.outL = left;
    band.outR = right;
    band.spectralComp = block.spectralComp;
    band.grainPanSpread = block.grainPanSpread;
    band.grainPanL = this.granular.grainPanL;
    band.grainPanR = this.granular.grainPanR;
    band.sampleRate = fs;
    this.spectral.applyBandSplitAndCompression(band);

    if (block.vocalChorus > 0) {
      this.chorus.process(outputs, block.vocalChorus, block.isVowel, fs);
    }

    // Duck sub harmonics heavily on kicks (drumIsSnare === 0)
    const effectiveSub = block.subHarmonics *
      (block.drumIsSnare === 0.0 ? Math.max(0, 1.0 - block.duckingScalar) : 1.0);
    if (effectiveSub > 0) {
      this.subHarmonicsFx.process(outputs, effectiveSub, block.isVowel, fs);
    }

    if (block.duckingScalar > 0) {
      this.drumDuck.applyMasterDuck(outputs, block.duckingScalar, block.isVowel, fs);
    }

    this.bitcrusher.process(outputs, block.bitcrush, block.downsample);
  }

  dispose(): void {
    this.sampleBuffer = new Float32Array(0);
  }
}

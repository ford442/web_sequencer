import { ExpressiveVoiceProcessor } from '../engines/rubberband/ExpressiveVoiceProcessor';
import { resolveWorkletSampleRate } from '../utils/workletSampleRate';

interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare var AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new(options?: any): AudioWorkletProcessor;
};

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: any) => AudioWorkletProcessor
): void;

declare const globalThis: {
  sampleRate: number;
  currentTime?: number;
};
declare const currentFrame: number;

const EPSILON = 1e-3;

class ExpressiveVoiceWorkletProcessor extends AudioWorkletProcessor {
  private expressiveProcessor: ExpressiveVoiceProcessor;
  private lastGate = 0;

  // Pre-allocated configuration for expressive processor to avoid per-block GC allocations
  private readonly currentExpressiveConfig = {
    vibrato: { rate: 0, depth: 0, enabled: false },
    tremolo: { rate: 0, depth: 0, enabled: false },
    breath: { amount: 0, filterCutoff: 2000, enabled: false },
    envelope: { attack: 0, decay: 0, sustain: 0, release: 0 }
  };

  static get parameterDescriptors() {
    return [
      { name: 'vibratoRate', defaultValue: 5.5, minValue: 0.0, maxValue: 10.0, automationRate: 'k-rate' as const },
      { name: 'vibratoDepth', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' as const },
      { name: 'tremoloRate', defaultValue: 5.0, minValue: 0.0, maxValue: 20.0, automationRate: 'k-rate' as const },
      { name: 'tremoloDepth', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' as const },
      { name: 'breathAmount', defaultValue: 0.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' as const },
      { name: 'attack', defaultValue: 0.0, minValue: 0.0, maxValue: 2.0, automationRate: 'k-rate' as const },
      { name: 'decay', defaultValue: 0.0, minValue: 0.0, maxValue: 2.0, automationRate: 'k-rate' as const },
      { name: 'sustain', defaultValue: 1.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' as const },
      { name: 'release', defaultValue: 0.1, minValue: 0.0, maxValue: 5.0, automationRate: 'k-rate' as const },
      { name: 'gate', defaultValue: 1.0, minValue: 0.0, maxValue: 1.0, automationRate: 'k-rate' as const },
    ];
  }

  constructor() {
    super();
    this.expressiveProcessor = new ExpressiveVoiceProcessor({
      sampleRate: resolveWorkletSampleRate(),
    });
    this.expressiveProcessor.noteOn();
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0]?.[0];
    if (!output) return true;

    const input = inputs[0]?.[0];
    if (!input) {
      output.fill(0);
      return true;
    }

    const vibratoRate = parameters.vibratoRate?.[0] ?? 5.5;
    const vibratoDepth = parameters.vibratoDepth?.[0] ?? 0;
    const tremoloRate = parameters.tremoloRate?.[0] ?? 5.0;
    const tremoloDepth = parameters.tremoloDepth?.[0] ?? 0;
    const breathAmount = parameters.breathAmount?.[0] ?? 0;
    const attack = parameters.attack?.[0] ?? 0;
    const decay = parameters.decay?.[0] ?? 0;
    const sustain = parameters.sustain?.[0] ?? 1;
    const release = parameters.release?.[0] ?? 0.1;
    const gate = parameters.gate?.[0] ?? 1;

    if (this.lastGate <= 0 && gate > 0) {
      this.expressiveProcessor.noteOn();
    } else if (this.lastGate > 0 && gate <= 0) {
      this.expressiveProcessor.noteOff();
    }
    this.lastGate = gate;

    const fullyOpenEnvelope =
      gate >= 1 - EPSILON &&
      attack <= EPSILON &&
      decay <= EPSILON &&
      sustain >= 1 - EPSILON &&
      release <= EPSILON;
    const isBypass =
      vibratoDepth <= EPSILON &&
      tremoloDepth <= EPSILON &&
      breathAmount <= EPSILON &&
      fullyOpenEnvelope;

    const frameCount = output.length;
    const copyCount = Math.min(frameCount, input.length);
    for (let i = 0; i < copyCount; i++) {
      output[i] = input[i];
    }
    for (let i = copyCount; i < frameCount; i++) {
      output[i] = 0;
    }

    if (isBypass) {
      return true;
    }

    const now =
      typeof globalThis.currentTime === 'number'
        ? globalThis.currentTime
        : (typeof currentFrame === 'number' ? currentFrame / resolveWorkletSampleRate() : 0);
    this.expressiveProcessor.setCurrentTime(now);

    const cfg = this.currentExpressiveConfig;
    cfg.vibrato.rate = vibratoRate;
    cfg.vibrato.depth = vibratoDepth;
    cfg.vibrato.enabled = vibratoDepth > 0;

    cfg.tremolo.rate = tremoloRate;
    cfg.tremolo.depth = tremoloDepth;
    cfg.tremolo.enabled = tremoloDepth > 0;

    cfg.breath.amount = breathAmount;
    cfg.breath.enabled = breathAmount > 0;

    cfg.envelope.attack = attack;
    cfg.envelope.decay = decay;
    cfg.envelope.sustain = sustain;
    cfg.envelope.release = release;

    this.expressiveProcessor.updateConfig(cfg);

    this.expressiveProcessor.process(output, output);
    return true;
  }
}

registerProcessor('expressive-voice', ExpressiveVoiceWorkletProcessor);

import { ExpressiveVoiceProcessor } from '../engines/rubberband/ExpressiveVoiceProcessor';

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
      sampleRate: globalThis.sampleRate || 44100,
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
        : (typeof currentFrame === 'number' ? currentFrame / (globalThis.sampleRate || 44100) : 0);
    this.expressiveProcessor.setCurrentTime(now);

    this.expressiveProcessor.setVibrato(vibratoRate, vibratoDepth, vibratoDepth > 0);
    this.expressiveProcessor.setTremolo(tremoloRate, tremoloDepth, tremoloDepth > 0);
    this.expressiveProcessor.setBreath(breathAmount, 2000, breathAmount > 0);
    this.expressiveProcessor.setEnvelope(attack, decay, sustain, release);

    this.expressiveProcessor.process(output, output);
    return true;
  }
}

registerProcessor('expressive-voice', ExpressiveVoiceWorkletProcessor);

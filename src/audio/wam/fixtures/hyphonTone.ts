import type { Wam2NoteEvent, Wam2PackageDescriptor, Wam2Plugin } from '../types';

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
}

/**
 * First-party WAM2 instrument fixture: one automatable `gain` param and MIDI notes.
 * Uses native OscillatorNode so unit tests work without AudioWorklet / the official SDK.
 */
export class HyphonTonePlugin implements Wam2Plugin {
  readonly descriptor: Wam2PackageDescriptor;
  private node: GainNode | null = null;
  private readonly voices = new Map<number, Voice>();
  private gainValue: number;
  private context: AudioContext | null = null;
  private pluginState: unknown = {};

  constructor(descriptor: Wam2PackageDescriptor) {
    this.descriptor = descriptor;
    this.gainValue = descriptor.params[0]?.defaultValue ?? 0.8;
  }

  get audioNode(): AudioNode {
    if (!this.node) {
      throw new Error('HyphonTonePlugin is not initialized');
    }
    return this.node;
  }

  async initialize(context: AudioContext, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    this.context = context;
    this.node = context.createGain();
    this.node.gain.value = this.gainValue;
  }

  setParam(id: string, value: number, time?: number): void {
    if (id !== 'gain' || !this.node) return;
    this.gainValue = Math.max(0, Math.min(1, value));
    const t = time ?? this.context?.currentTime ?? 0;
    this.node.gain.setValueAtTime(this.gainValue, t);
  }

  getParam(id: string): number {
    return id === 'gain' ? this.gainValue : 0;
  }

  getState(): unknown {
    return { gain: this.gainValue, extra: this.pluginState };
  }

  setState(state: unknown): void {
    this.pluginState = state;
    if (state && typeof state === 'object' && 'gain' in state) {
      const gain = (state as { gain: unknown }).gain;
      if (typeof gain === 'number') {
        this.setParam('gain', gain);
      }
    }
  }

  noteOn(event: Wam2NoteEvent): void {
    if (!this.context || !this.node) return;
    this.noteOff(event.midi, event.time);
    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    osc.frequency.setValueAtTime(midiToHz(event.midi), event.time);
    const amp = Math.max(0, Math.min(1, event.velocity)) * this.gainValue;
    gain.gain.setValueAtTime(amp, event.time);
    osc.connect(gain);
    gain.connect(this.node);
    osc.start(event.time);
    const stopAt = event.time + Math.max(0.01, event.durationSeconds);
    osc.stop(stopAt);
    this.voices.set(event.midi, { osc, gain });
  }

  noteOff(midi: number, time: number): void {
    const voice = this.voices.get(midi);
    if (!voice) return;
    try {
      voice.osc.stop(time);
    } catch {
      /* already stopped */
    }
    this.voices.delete(midi);
  }

  dispose(): void {
    for (const midi of [...this.voices.keys()]) {
      this.noteOff(midi, this.context?.currentTime ?? 0);
    }
    try {
      this.node?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.node = null;
  }
}

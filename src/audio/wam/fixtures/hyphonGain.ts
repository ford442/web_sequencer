import type { Wam2PackageDescriptor, Wam2Plugin } from '../types';

/**
 * First-party WAM2 effect fixture: unity-through GainNode with automatable `gain`.
 */
export class HyphonGainPlugin implements Wam2Plugin {
  readonly descriptor: Wam2PackageDescriptor;
  private node: GainNode | null = null;
  private gainValue: number;
  private context: AudioContext | null = null;
  private pluginState: unknown = {};

  constructor(descriptor: Wam2PackageDescriptor) {
    this.descriptor = descriptor;
    this.gainValue = descriptor.params[0]?.defaultValue ?? 0.8;
  }

  get audioNode(): AudioNode {
    if (!this.node) {
      throw new Error('HyphonGainPlugin is not initialized');
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

  dispose(): void {
    try {
      this.node?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.node = null;
  }
}

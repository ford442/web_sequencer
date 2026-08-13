/**
 * Shared Web MIDI access — single requestMIDIAccess, demux system realtime vs channel messages.
 * Sysex remains disabled per project policy.
 */

import { isMidiSystemRealtime } from './clock/midiRealtime';

export type MidiInputMessageListener = (
  deviceId: string,
  data: Uint8Array,
  domTime: number,
) => void;

export type MidiStateChangeListener = () => void;

export interface MidiPortInfo {
  id: string;
  name: string;
}

class MidiPortManagerImpl {
  private access: MIDIAccess | null = null;
  private initPromise: Promise<MIDIAccess | null> | null = null;
  private inputHandlers = new Map<MIDIInput, (e: MIDIMessageEvent) => void>();
  private channelListeners = new Set<MidiInputMessageListener>();
  private realtimeListeners = new Set<MidiInputMessageListener>();
  private stateListeners = new Set<MidiStateChangeListener>();
  private selectedInputId: string | null = null;
  private selectedOutputId: string | null = null;

  /** Lazily acquire Web MIDI access. Returns null if unavailable or denied. */
  async ensureAccess(): Promise<MIDIAccess | null> {
    if (this.access) return this.access;
    if (this.initPromise) return this.initPromise;

    if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
      return null;
    }

    this.initPromise = navigator
      .requestMIDIAccess({ sysex: false })
      .then((access) => {
        this.access = access;
        access.onstatechange = () => {
          this.refreshInputs();
          this.notifyStateChange();
        };
        this.refreshInputs();
        return access;
      })
      .catch(() => null);

    return this.initPromise;
  }

  onChannelMessage(listener: MidiInputMessageListener): () => void {
    this.channelListeners.add(listener);
    void this.ensureAccess();
    return () => this.channelListeners.delete(listener);
  }

  onRealtimeMessage(listener: MidiInputMessageListener): () => void {
    this.realtimeListeners.add(listener);
    void this.ensureAccess();
    return () => this.realtimeListeners.delete(listener);
  }

  onStateChange(listener: MidiStateChangeListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  getInputs(): MidiPortInfo[] {
    if (!this.access) return [];
    return Array.from(this.access.inputs.values()).map((p) => ({
      id: p.id,
      name: p.name || p.id || 'MIDI Input',
    }));
  }

  getOutputs(): MidiPortInfo[] {
    if (!this.access) return [];
    return Array.from(this.access.outputs.values()).map((p) => ({
      id: p.id,
      name: p.name || p.id || 'MIDI Output',
    }));
  }

  selectInput(id: string | null): void {
    this.selectedInputId = id;
  }

  selectOutput(id: string | null): void {
    this.selectedOutputId = id;
  }

  getSelectedInputId(): string | null {
    return this.selectedInputId;
  }

  getSelectedOutputId(): string | null {
    return this.selectedOutputId;
  }

  /** Send bytes to the selected output (immediate if no timestamp). */
  send(data: number[] | Uint8Array, domTimestamp?: number): boolean {
    const output = this.resolveOutput(this.selectedOutputId);
    if (!output) return false;
    try {
      if (domTimestamp != null && Number.isFinite(domTimestamp)) {
        output.send(data, domTimestamp);
      } else {
        output.send(data);
      }
      return true;
    } catch {
      return false;
    }
  }

  sendImmediate(statusByte: number): boolean {
    return this.send([statusByte]);
  }

  isAvailable(): boolean {
    return this.access != null;
  }

  hasInputs(): boolean {
    return this.getInputs().length > 0;
  }

  hasOutputs(): boolean {
    return this.getOutputs().length > 0;
  }

  dispose(): void {
    this.inputHandlers.forEach((_, input) => this.detachInput(input));
    if (this.access) this.access.onstatechange = null;
    this.access = null;
    this.initPromise = null;
  }

  private resolveOutput(id: string | null): MIDIOutput | null {
    if (!this.access) return null;
    if (id) {
      const out = this.access.outputs.get(id);
      if (out) return out;
    }
    const first = this.access.outputs.values().next().value;
    return first ?? null;
  }

  private refreshInputs(): void {
    if (!this.access) return;
    const inputs = Array.from(this.access.inputs.values());
    inputs.forEach((input) => this.attachInput(input));
  }

  private attachInput(input: MIDIInput): void {
    if (this.inputHandlers.has(input)) return;
    const handler = (e: MIDIMessageEvent) => {
      const data = e.data;
      if (!data || data.length === 0) return;
      const deviceId = input.id || '';
      const domTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

      if (isMidiSystemRealtime(data[0])) {
        if (this.selectedInputId && deviceId !== this.selectedInputId) return;
        for (const listener of this.realtimeListeners) {
          listener(deviceId, data, domTime);
        }
      } else {
        for (const listener of this.channelListeners) {
          listener(deviceId, data, domTime);
        }
      }
    };
    this.inputHandlers.set(input, handler);
    input.onmidimessage = handler;
  }

  private detachInput(input: MIDIInput): void {
    const handler = this.inputHandlers.get(input);
    if (handler) {
      input.onmidimessage = null;
      this.inputHandlers.delete(input);
    }
  }

  private notifyStateChange(): void {
    for (const listener of this.stateListeners) listener();
  }
}

export const midiPortManager = new MidiPortManagerImpl();

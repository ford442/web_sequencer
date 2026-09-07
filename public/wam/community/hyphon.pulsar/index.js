/**
 * hyphon.pulsar — a WAM2 community package.
 *
 * This file is NOT compiled into the app. It ships as a plain ES module under
 * public/wam/community/ and travels the full community load path: the installer
 * fetches these exact bytes, SHA-256s them, compares the digest against
 * public/wam/catalog.json, and only then imports this module. Editing this file
 * without re-running `pnpm run wam:integrity` makes it fail to install, which is
 * the point.
 *
 * It implements the host ABI (`wam2ApiVersion: 1` + `createWam2Plugin`) with
 * plain Web Audio nodes — no SDK, no worklet, no network.
 *
 * DSP: two detuned saw oscillators through a resonant lowpass, per-note.
 * Params: cutoff, detune, gain.
 */

export const wam2ApiVersion = 1;

const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

class PulsarPlugin {
  constructor(descriptor) {
    this.descriptor = descriptor;
    this.context = null;
    this.node = null;
    this.filter = null;
    this.voices = new Map();
    this.values = new Map();
    for (const param of descriptor.params) {
      this.values.set(param.id, param.defaultValue);
    }
  }

  get audioNode() {
    if (!this.node) throw new Error('hyphon.pulsar is not initialized');
    return this.node;
  }

  async initialize(context, signal) {
    if (signal && signal.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    this.context = context;
    this.filter = context.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = this.getParam('cutoff');
    this.filter.Q.value = 6;
    this.node = context.createGain();
    this.node.gain.value = this.getParam('gain');
    this.filter.connect(this.node);
  }

  #descriptorFor(id) {
    return this.descriptor.params.find((p) => p.id === id);
  }

  setParam(id, value, time) {
    const desc = this.#descriptorFor(id);
    if (!desc) return;
    const next = clamp(value, desc.min, desc.max);
    this.values.set(id, next);
    const t = time ?? this.context?.currentTime ?? 0;
    if (id === 'gain' && this.node) {
      this.node.gain.setValueAtTime(next, t);
    } else if (id === 'cutoff' && this.filter) {
      this.filter.frequency.setValueAtTime(next, t);
    } else if (id === 'detune') {
      for (const voice of this.voices.values()) {
        voice.b.detune.setValueAtTime(next, t);
      }
    }
  }

  getParam(id) {
    const value = this.values.get(id);
    if (typeof value === 'number') return value;
    return this.#descriptorFor(id)?.defaultValue ?? 0;
  }

  getState() {
    return { params: Object.fromEntries(this.values) };
  }

  setState(state) {
    if (!state || typeof state !== 'object') return;
    const params = state.params;
    if (!params || typeof params !== 'object') return;
    for (const [id, value] of Object.entries(params)) {
      if (typeof value === 'number') this.setParam(id, value);
    }
  }

  noteOn(event) {
    if (!this.context || !this.filter) return;
    this.noteOff(event.midi, event.time);
    const hz = midiToHz(event.midi);
    const a = this.context.createOscillator();
    const b = this.context.createOscillator();
    const amp = this.context.createGain();
    a.type = 'sawtooth';
    b.type = 'sawtooth';
    a.frequency.setValueAtTime(hz, event.time);
    b.frequency.setValueAtTime(hz, event.time);
    b.detune.setValueAtTime(this.getParam('detune'), event.time);
    amp.gain.setValueAtTime(clamp(event.velocity, 0, 1) * 0.5, event.time);
    a.connect(amp);
    b.connect(amp);
    amp.connect(this.filter);
    a.start(event.time);
    b.start(event.time);
    const stopAt = event.time + Math.max(0.01, event.durationSeconds);
    a.stop(stopAt);
    b.stop(stopAt);
    this.voices.set(event.midi, { a, b, amp });
  }

  noteOff(midi, time) {
    const voice = this.voices.get(midi);
    if (!voice) return;
    for (const osc of [voice.a, voice.b]) {
      try {
        osc.stop(time);
      } catch {
        /* already stopped */
      }
    }
    this.voices.delete(midi);
  }

  dispose() {
    for (const midi of [...this.voices.keys()]) {
      this.noteOff(midi, this.context?.currentTime ?? 0);
    }
    for (const node of [this.filter, this.node]) {
      try {
        node?.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    this.filter = null;
    this.node = null;
  }
}

export function createWam2Plugin(descriptor) {
  return new PulsarPlugin(descriptor);
}

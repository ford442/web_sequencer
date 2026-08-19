/**
 * Dual-port bypass wrapper used as a graph node factory result.
 *
 * Incoming edges connect to `input`; outgoing edges connect from `output`.
 * A plugin crash or timeout leaves the dry bypass path open so transport
 * and master output keep running.
 */

export class WamSlotPorts {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly bypass: GainNode;
  readonly wet: GainNode;
  private plugin: AudioNode | null = null;

  constructor(context: AudioContext) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.bypass = context.createGain();
    this.wet = context.createGain();
    this.input.gain.value = 1;
    this.output.gain.value = 1;
    this.bypass.gain.value = 1;
    this.wet.gain.value = 0;
    this.input.connect(this.bypass);
    this.bypass.connect(this.output);
    this.input.connect(this.wet);
    this.wet.connect(this.output);
  }

  attachPlugin(node: AudioNode): void {
    this.detachPlugin();
    this.wet.disconnect();
    this.wet.connect(node);
    node.connect(this.output);
    this.plugin = node;
    this.bypass.gain.value = 0;
    this.wet.gain.value = 1;
  }

  /** Instrument sources have no audio input — plugin output feeds the slot. */
  attachInstrument(node: AudioNode): void {
    this.detachPlugin();
    node.connect(this.output);
    this.plugin = node;
    this.bypass.gain.value = 0;
    this.wet.gain.value = 0;
  }

  failSafeBypass(): void {
    this.bypass.gain.value = 1;
    this.wet.gain.value = 0;
  }

  detachPlugin(): void {
    if (this.plugin) {
      try {
        this.plugin.disconnect();
      } catch {
        /* already disconnected */
      }
      this.plugin = null;
    }
    try {
      this.wet.disconnect();
    } catch {
      /* already disconnected */
    }
    this.wet.connect(this.output);
    this.failSafeBypass();
  }

  dispose(): void {
    this.detachPlugin();
    try {
      this.input.disconnect();
      this.bypass.disconnect();
      this.wet.disconnect();
      this.output.disconnect();
    } catch {
      /* AudioContext closed */
    }
  }
}

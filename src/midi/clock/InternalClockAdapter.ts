import { attachWorkletPerf } from '../../utils/workletPerfBridge';
import { isAppleWebKit, logEngineFallback } from '../../utils/engineTelemetry';
import type { StepCallback, TransportClock, TransportSyncTelemetry } from './types';

let clockModulePromise: Promise<void> | null = null;

function ensureClockModule(context: AudioContext): Promise<void> {
  if (!clockModulePromise) {
    clockModulePromise = import('../../audio-worklets/clock-processor.ts?worker&url')
      .then(({ default: url }) => context.audioWorklet.addModule(url))
      .catch((err) => {
        clockModulePromise = null;
        throw err;
      });
  }
  return clockModulePromise;
}

/**
 * Internal AudioWorklet-backed transport clock (existing Hyphon behavior).
 */
export class InternalClockAdapter implements TransportClock {
  private context: AudioContext;
  private tempo: number;
  private swing: number;
  private steps: number;
  private clockNode: AudioWorkletNode | null = null;
  private running = false;
  private stepListeners = new Set<StepCallback>();
  private startPromise: Promise<void> | null = null;
  private mainThreadTimer: ReturnType<typeof setTimeout> | null = null;
  private mainThreadNextStep = 0;
  private mainThreadNextAt = 0;

  constructor(context: AudioContext, tempo: number, swing: number, steps: number) {
    this.context = context;
    this.tempo = tempo;
    this.swing = swing;
    this.steps = steps;
  }

  async ensureStarted(): Promise<void> {
    if (this.running && this.clockNode) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = (async () => {
      if (this.context.state === 'suspended') {
        await this.context.resume();
      }

      if (isAppleWebKit()) {
        logEngineFallback(
          'clock',
          'wasm-worklet',
          'clock-processor AudioWorklet skipped on WebKit; using main-thread timer',
        );
        this.stopMainThreadClock();
        this.running = true;
        this.mainThreadNextStep = 0;
        this.mainThreadNextAt = this.context.currentTime;
        this.tickMainThreadClock();
        return;
      }

      await ensureClockModule(this.context);

      if (this.clockNode) {
        this.clockNode.port.postMessage({ type: 'stop' });
        this.clockNode.disconnect();
        this.clockNode = null;
      }

      const node = new AudioWorkletNode(this.context, 'clock-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });

      node.port.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'step') {
          const { step, audioTime } = e.data as { step: number; audioTime: number };
          for (const cb of this.stepListeners) cb(step, audioTime);
        }
      };

      attachWorkletPerf(node, 'clock');

      node.port.postMessage({ type: 'setTempo', tempo: this.tempo });
      node.port.postMessage({ type: 'setSwing', swing: this.swing });
      node.port.postMessage({ type: 'setSteps', steps: this.steps });
      node.port.postMessage({ type: 'start' });

      node.connect(this.context.destination);
      this.clockNode = node;
      this.running = true;
    })().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  start(): void {
    void this.ensureStarted();
  }

  stop(): void {
    this.stopMainThreadClock();
    if (this.clockNode) {
      this.clockNode.port.postMessage({ type: 'stop' });
      this.clockNode.disconnect();
      this.clockNode = null;
    }
    this.running = false;
  }

  setTempo(bpm: number): void {
    this.tempo = bpm;
    this.clockNode?.port.postMessage({ type: 'setTempo', tempo: bpm });
  }

  setSwing(swing: number): void {
    this.swing = swing;
    this.clockNode?.port.postMessage({ type: 'setSwing', swing });
  }

  setSteps(steps: number): void {
    this.steps = steps;
    this.clockNode?.port.postMessage({ type: 'setSteps', steps });
  }

  resync(): void {
    /* Internal clock resets on start/stop only. */
  }

  private stepDurationSec(parity: 0 | 1): number {
    const base = 60 / (this.tempo * 4);
    const shift = this.swing * base * 0.5;
    return parity === 0 ? base + shift : base - shift;
  }

  private tickMainThreadClock(): void {
    if (!this.running) return;
    const now = this.context.currentTime;
    while (this.mainThreadNextAt <= now + 0.002) {
      const audioTime = this.mainThreadNextAt;
      const step = this.mainThreadNextStep;
      for (const cb of this.stepListeners) cb(step, audioTime);
      const parity = (step % 2) as 0 | 1;
      this.mainThreadNextAt += this.stepDurationSec(parity);
      this.mainThreadNextStep = (step + 1) % this.steps;
    }
    this.mainThreadTimer = setTimeout(() => this.tickMainThreadClock(), 8);
  }

  private stopMainThreadClock(): void {
    if (this.mainThreadTimer != null) {
      clearTimeout(this.mainThreadTimer);
      this.mainThreadTimer = null;
    }
  }

  onStep(cb: StepCallback): () => void {
    this.stepListeners.add(cb);
    return () => this.stepListeners.delete(cb);
  }

  getTelemetry(): TransportSyncTelemetry {
    return {
      mode: 'internal',
      state: this.running ? 'synced' : 'stopped',
      deviceName: null,
      measuredBpm: this.tempo,
      phaseErrorMs: 0,
      jitterMs: 0,
      droppedClocks: 0,
      isPlaying: this.running,
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  dispose(): void {
    this.stop();
    this.stepListeners.clear();
  }
}

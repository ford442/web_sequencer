import { attachWorkletPerf } from '../../utils/workletPerfBridge';
import { isAppleWebKit, logEngineFallback } from '../../utils/engineTelemetry';
import type { ClockStepMessage } from '../../shared/rt/clock';
import { STEP_LOOKAHEAD_MS, type StepCallback, type TransportClock, type TransportSyncTelemetry } from './types';

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
  private mainThreadAbsStep = 0;
  private mainThreadNextAt = 0;
  /** Armed at worklet `start`; fires the main-thread fallback if no step arrives. */
  private stepWatchdog: ReturnType<typeof setTimeout> | null = null;
  /** The worklet never answered, so the main-thread timer is the clock source. */
  private workletUnresponsive = false;

  constructor(context: AudioContext, tempo: number, swing: number, steps: number) {
    this.context = context;
    this.tempo = tempo;
    this.swing = swing;
    this.steps = steps;
  }

  async ensureStarted(): Promise<void> {
    if (this.running && (this.clockNode || this.workletUnresponsive)) return;
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
        this.startMainThreadClock();
        return;
      }

      await ensureClockModule(this.context);
      this.workletUnresponsive = false;

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
        // A node we fell back from may still have a step in flight; the main-thread timer owns the clock now.
        if (this.clockNode !== node) return;
        if (e.data?.type === 'step') {
          if (this.stepWatchdog != null) {
            this.clearStepWatchdog();
            console.info('[Clock] source: clock-processor AudioWorklet');
          }
          const { step, audioTime, absStep } = e.data as ClockStepMessage;
          for (const cb of this.stepListeners) cb(step, audioTime, absStep);
        }
      };

      attachWorkletPerf(node, 'clock');

      node.port.postMessage({ type: 'setTempo', tempo: this.tempo });
      node.port.postMessage({ type: 'setSwing', swing: this.swing });
      node.port.postMessage({ type: 'setSteps', steps: this.steps });
      node.port.postMessage({ type: 'setLookahead', lookahead: STEP_LOOKAHEAD_MS / 1000 });
      node.port.postMessage({ type: 'start' });

      node.connect(this.context.destination);
      this.clockNode = node;
      this.running = true;
      this.armStepWatchdog(node);
    })().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  start(): void {
    void this.ensureStarted();
  }

  stop(): void {
    this.clearStepWatchdog();
    this.stopMainThreadClock();
    this.workletUnresponsive = false;
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
    // Shrinking mid-run must not emit a step past the new end.
    this.mainThreadNextStep %= steps;
    this.clockNode?.port.postMessage({ type: 'setSteps', steps });
  }

  resync(): void {
    /* Internal clock resets on start/stop only. */
  }

  /**
   * Firefox can load and connect the worklet and still never deliver a step
   * (#1492). One lookahead after `start` the first step is overdue, so drop the
   * node and run the timer WebKit already uses. This is the only fallback: the
   * main-thread clock is not a second scheduler, it is the existing one.
   */
  private armStepWatchdog(node: AudioWorkletNode): void {
    this.clearStepWatchdog();
    this.stepWatchdog = setTimeout(() => {
      this.stepWatchdog = null;
      if (this.clockNode !== node) return;
      logEngineFallback(
        'clock',
        'wasm-worklet',
        `clock-processor posted no step within ${STEP_LOOKAHEAD_MS} ms of start; using main-thread timer`,
      );
      node.port.postMessage({ type: 'stop' });
      node.disconnect();
      this.clockNode = null;
      this.workletUnresponsive = true;
      this.startMainThreadClock();
    }, STEP_LOOKAHEAD_MS);
  }

  private clearStepWatchdog(): void {
    if (this.stepWatchdog != null) {
      clearTimeout(this.stepWatchdog);
      this.stepWatchdog = null;
    }
  }

  private startMainThreadClock(): void {
    this.stopMainThreadClock();
    this.running = true;
    this.mainThreadNextStep = 0;
    this.mainThreadAbsStep = 0;
    this.mainThreadNextAt = this.context.currentTime;
    this.tickMainThreadClock();
  }

  private stepDurationSec(parity: 0 | 1): number {
    const base = 60 / (this.tempo * 4);
    const shift = this.swing * base * 0.5;
    return parity === 0 ? base + shift : base - shift;
  }

  private tickMainThreadClock(): void {
    if (!this.running) return;
    const now = this.context.currentTime;
    // Same lookahead as the worklet clock: post each step early, stamped with its time.
    while (this.mainThreadNextAt <= now + STEP_LOOKAHEAD_MS / 1000) {
      const audioTime = this.mainThreadNextAt;
      const step = this.mainThreadNextStep;
      const absStep = this.mainThreadAbsStep;
      for (const cb of this.stepListeners) cb(step, audioTime, absStep);
      // Parity from the absolute count keeps swing alternating across odd-length wraps.
      const parity = (absStep % 2) as 0 | 1;
      this.mainThreadNextAt += this.stepDurationSec(parity);
      this.mainThreadNextStep = (step + 1) % this.steps;
      this.mainThreadAbsStep = absStep + 1;
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

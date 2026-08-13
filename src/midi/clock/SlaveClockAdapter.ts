import { midiPortManager } from '../MidiPortManager';
import { PLAYBACK_THRESHOLDS } from '../../audio/playback/PlaybackHealthMonitor';
import { AudioTimeMap } from './audioTimeMap';
import { parseMidiRealtime, sppToStep } from './midiRealtime';
import { TempoEstimator } from './tempoEstimator';
import {
  AUDIO_SCHEDULE_LOOKAHEAD_MS,
  HOLDOVER_BEAT_PERIODS,
  HOLDOVER_STOP_BEATS,
  MIDI_TICKS_PER_STEP,
  type StepCallback,
  type TransportClock,
  type TransportSyncState,
  type TransportSyncTelemetry,
} from './types';

/**
 * Slave mode: follow external MIDI clock on selected input.
 */
export class SlaveClockAdapter implements TransportClock {
  private context: AudioContext;
  private tempo = 120;
  private swing = 0;
  private steps = 32;
  private inputDeviceId: string | null;
  private timeMap: AudioTimeMap;
  private estimator = new TempoEstimator();
  private running = false;
  private armed = false;
  private syncState: TransportSyncState = 'stopped';
  private totalTicks = 0;
  private currentStep = 0;
  private lastEmittedStep = -1;
  private lastStepAudio = 0;
  private resyncPending = false;
  private holdoverStartDom: number | null = null;
  private holdoverTimer: ReturnType<typeof setInterval> | null = null;
  private lossCheckTimer: ReturnType<typeof setInterval> | null = null;
  private lastClockDom: number | null = null;
  private stepListeners = new Set<StepCallback>();
  private unsubRealtime: (() => void) | null = null;
  private onStopExternal: (() => void) | null = null;

  constructor(
    context: AudioContext,
    tempo: number,
    swing: number,
    steps: number,
    inputDeviceId: string | null,
  ) {
    this.context = context;
    this.tempo = tempo;
    this.swing = swing;
    this.steps = steps;
    this.inputDeviceId = inputDeviceId;
    this.timeMap = new AudioTimeMap(context);
    this.estimator.seedPeriodFromBpm(tempo);
    midiPortManager.selectInput(inputDeviceId);
  }

  /** Arm listening without external start yet. */
  setArmed(armed: boolean): void {
    this.armed = armed;
    if (armed && !this.unsubRealtime) {
      this.attachRealtime();
      this.syncState = 'armed';
    } else if (!armed && !this.running) {
      this.syncState = 'stopped';
    }
  }

  setOnStopExternal(cb: () => void): void {
    this.onStopExternal = cb;
  }

  start(): void {
    this.setArmed(true);
  }

  stop(): void {
    this.running = false;
    this.armed = false;
    this.syncState = 'stopped';
    this.clearHoldover();
    this.detachRealtime();
  }

  setTempo(_bpm: number): void {
    /* Slave tempo comes from external clock. */
  }

  setSwing(swing: number): void {
    this.swing = swing;
  }

  setSteps(steps: number): void {
    this.steps = steps;
  }

  resync(): void {
    this.resyncPending = true;
  }

  onStep(cb: StepCallback): () => void {
    this.stepListeners.add(cb);
    return () => this.stepListeners.delete(cb);
  }

  getTelemetry(): TransportSyncTelemetry {
    const snap = this.estimator.getSnapshot();
    const inputs = midiPortManager.getInputs();
    const device = inputs.find((i) => i.id === this.inputDeviceId);
    return {
      mode: 'slave',
      state: this.syncState,
      deviceName: device?.name ?? (this.inputDeviceId ? 'device not found' : null),
      measuredBpm: snap.measuredBpm,
      phaseErrorMs: snap.phaseErrorMs,
      jitterMs: snap.jitterMs,
      droppedClocks: snap.droppedClocks,
      isPlaying: this.running,
    };
  }

  dispose(): void {
    this.stop();
    this.stepListeners.clear();
  }

  private attachRealtime(): void {
    if (this.unsubRealtime) return;
    void midiPortManager.ensureAccess();
    this.unsubRealtime = midiPortManager.onRealtimeMessage((deviceId, data, domTime) => {
      if (this.inputDeviceId && deviceId !== this.inputDeviceId) return;
      this.handleRealtime(data, domTime);
    });
  }

  private detachRealtime(): void {
    this.unsubRealtime?.();
    this.unsubRealtime = null;
  }

  private handleRealtime(data: Uint8Array, domTime: number): void {
    const msg = parseMidiRealtime(data);
    if (!msg) return;

    switch (msg.type) {
      case 'start':
        this.handleStart(domTime);
        break;
      case 'continue':
        this.handleContinue(domTime);
        break;
      case 'stop':
        this.handleStop();
        break;
      case 'songPosition':
        this.handleSpp(msg.sixteenthNotes);
        break;
      case 'clock':
        if (this.running || this.armed) this.handleClock(domTime);
        break;
    }
  }

  private handleStart(domTime: number): void {
    this.running = true;
    this.armed = true;
    this.syncState = 'synced';
    this.totalTicks = 0;
    this.currentStep = 0;
    this.estimator.reset();
    this.estimator.observeClock(domTime);
    this.lastClockDom = domTime;
    this.holdoverStartDom = null;
    this.clearHoldover();
    this.attachRealtime();
    this.emitStep(0, domTime);
  }

  private handleContinue(domTime: number): void {
    this.running = true;
    this.syncState = 'synced';
    this.estimator.observeClock(domTime);
    this.lastClockDom = domTime;
    this.holdoverStartDom = null;
    this.clearHoldover();
    this.attachRealtime();
  }

  private handleStop(): void {
    this.running = false;
    this.syncState = 'stopped';
    this.clearHoldover();
    this.onStopExternal?.();
  }

  private handleSpp(sixteenthNotes: number): void {
    const step = sppToStep(sixteenthNotes, this.steps);
    if (step >= this.currentStep) {
      this.currentStep = step;
      this.totalTicks = step * MIDI_TICKS_PER_STEP;
    }
  }

  private handleClock(domTime: number): void {
    if (!this.running) return;

    this.lastClockDom = domTime;
    this.holdoverStartDom = null;
    if (this.syncState === 'holdover') this.syncState = 'synced';

    const accepted = this.estimator.observeClock(domTime);
    if (!accepted && this.estimator.getSnapshot().droppedClocks > 0) {
      /* Still advance on clock even if interval rejected — external master is authoritative. */
    }

    this.totalTicks++;

    if (this.resyncPending && this.currentStep === 0 && this.totalTicks % 24 === 0) {
      this.resyncPending = false;
      this.timeMap.reanchor(this.context);
    }

    if (this.totalTicks % MIDI_TICKS_PER_STEP !== 0) return;

    const step = this.currentStep;
    this.currentStep = (this.currentStep + 1) % this.steps;

    // Start already emitted step 0; skip duplicate at first 16th boundary.
    if (this.totalTicks === MIDI_TICKS_PER_STEP && step === 0) return;

    this.emitStep(step, domTime);
    this.startLossWatch();
  }

  private emitStep(step: number, domTime: number): void {
    const nowAudio = this.context.currentTime;
    let audioTime =
      this.timeMap.domToAudio(domTime) + AUDIO_SCHEDULE_LOOKAHEAD_MS / 1000;
    audioTime = Math.max(nowAudio + 0.001, audioTime);

    const dupMs = (audioTime - this.lastStepAudio) * 1000;
    if (
      step === this.lastEmittedStep &&
      dupMs < PLAYBACK_THRESHOLDS.stepDuplicateGuardMs
    ) {
      return;
    }

    this.lastEmittedStep = step;
    this.lastStepAudio = audioTime;

    for (const cb of this.stepListeners) cb(step, audioTime);
  }

  private startLossWatch(): void {
    if (this.lossCheckTimer) return;
    this.lossCheckTimer = setInterval(() => {
      if (!this.running || this.lastClockDom == null) return;
      const snap = this.estimator.getSnapshot();
      const period = snap.periodMs ?? (60_000 / this.tempo) / 24;
      const nowDom = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const sinceLast = nowDom - this.lastClockDom;

      if (sinceLast > period * 24 * HOLDOVER_BEAT_PERIODS) {
        if (this.syncState !== 'holdover') {
          this.syncState = 'holdover';
          this.holdoverStartDom = nowDom;
          this.startHoldover(period);
        } else if (
          this.holdoverStartDom != null &&
          nowDom - this.holdoverStartDom > period * 24 * HOLDOVER_STOP_BEATS
        ) {
          this.syncState = 'degraded';
          this.handleStop();
        }
      }
    }, 50);
  }

  private startHoldover(periodMs: number): void {
    this.clearHoldover();
    this.holdoverTimer = setInterval(() => {
      if (!this.running || this.syncState !== 'holdover') return;
      const dom = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.handleClock(dom);
    }, periodMs);
  }

  private clearHoldover(): void {
    if (this.holdoverTimer) {
      clearInterval(this.holdoverTimer);
      this.holdoverTimer = null;
    }
    if (this.lossCheckTimer) {
      clearInterval(this.lossCheckTimer);
      this.lossCheckTimer = null;
    }
  }
}

import { midiPortManager } from '../MidiPortManager';
import { AudioTimeMap } from './audioTimeMap';
import { InternalClockAdapter } from './InternalClockAdapter';
import { MIDI_PPQN, type StepCallback, type TransportClock, type TransportSyncTelemetry } from './types';

const SCHEDULE_AHEAD_SEC = 0.5;

/**
 * Master mode: internal AudioWorklet clock + MIDI Start/Stop/Clock on selected output.
 */
export class MasterClockAdapter implements TransportClock {
  private internal: InternalClockAdapter;
  private context: AudioContext;
  private tempo: number;
  private timeMap: AudioTimeMap;
  private outputDeviceId: string | null;
  private running = false;
  private degraded = false;
  private nextPulseIndex = 0;
  private startAudioTime = 0;
  private scheduleTimer: ReturnType<typeof setInterval> | null = null;
  private stepUnsub: (() => void) | null = null;
  private stepListeners = new Set<StepCallback>();

  constructor(
    context: AudioContext,
    tempo: number,
    swing: number,
    steps: number,
    outputDeviceId: string | null,
  ) {
    this.context = context;
    this.tempo = tempo;
    this.outputDeviceId = outputDeviceId;
    this.timeMap = new AudioTimeMap(context);
    this.internal = new InternalClockAdapter(context, tempo, swing, steps);
    midiPortManager.selectOutput(outputDeviceId);
  }

  start(): void {
    this.degraded = false;
    this.nextPulseIndex = 0;
    this.startAudioTime = this.context.currentTime;
    this.timeMap.reanchor(this.context);

    if (!this.sendTransport(0xfa)) {
      this.degraded = true;
    }

    this.internal.start();
    this.running = true;
    this.startScheduler();
  }

  stop(): void {
    this.stopScheduler();
    this.internal.stop();
    this.sendTransport(0xfc);
    this.running = false;
  }

  setTempo(bpm: number): void {
    this.tempo = bpm;
    this.internal.setTempo(bpm);
  }

  setSwing(swing: number): void {
    this.internal.setSwing(swing);
  }

  setSteps(steps: number): void {
    this.internal.setSteps(steps);
  }

  resync(): void {
    this.nextPulseIndex = 0;
    this.startAudioTime = this.context.currentTime;
    this.timeMap.reanchor(this.context);
  }

  onStep(cb: StepCallback): () => void {
    this.stepListeners.add(cb);
    if (!this.stepUnsub) {
      this.stepUnsub = this.internal.onStep((step, audioTime) => {
        for (const listener of this.stepListeners) listener(step, audioTime);
      });
    }
    return () => this.stepListeners.delete(cb);
  }

  getTelemetry(): TransportSyncTelemetry {
    const outputs = midiPortManager.getOutputs();
    const device = outputs.find((o) => o.id === this.outputDeviceId);
    return {
      mode: 'master',
      state: this.degraded ? 'degraded' : this.running ? 'synced' : 'stopped',
      deviceName: device?.name ?? (this.outputDeviceId ? 'device not found' : null),
      measuredBpm: this.tempo,
      phaseErrorMs: 0,
      jitterMs: 0,
      droppedClocks: 0,
      isPlaying: this.running,
    };
  }

  dispose(): void {
    this.stop();
    this.stepUnsub?.();
    this.stepUnsub = null;
    this.stepListeners.clear();
    this.internal.dispose();
  }

  private sendTransport(status: number): boolean {
    midiPortManager.selectOutput(this.outputDeviceId);
    return midiPortManager.sendImmediate(status);
  }

  private startScheduler(): void {
    this.stopScheduler();
    this.scheduleTimer = setInterval(() => this.scheduleClockPulses(), 25);
    this.scheduleClockPulses();
  }

  private stopScheduler(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
  }

  private scheduleClockPulses(): void {
    if (!this.running) return;
    midiPortManager.selectOutput(this.outputDeviceId);

    const nowAudio = this.context.currentTime;
    const endAudio = nowAudio + SCHEDULE_AHEAD_SEC;
    const secPerPulse = 60 / (this.tempo * MIDI_PPQN);

    while (this.startAudioTime + this.nextPulseIndex * secPerPulse <= endAudio) {
      const pulseAudio = this.startAudioTime + this.nextPulseIndex * secPerPulse;
      const domTs = this.timeMap.audioToDom(pulseAudio);
      const sent = midiPortManager.send([0xf8], domTs);
      if (!sent) this.degraded = true;
      this.nextPulseIndex++;
    }
  }
}

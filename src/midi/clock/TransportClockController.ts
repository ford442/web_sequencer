import { midiPortManager } from '../MidiPortManager';
import { InternalClockAdapter } from './InternalClockAdapter';
import { MasterClockAdapter } from './MasterClockAdapter';
import { SlaveClockAdapter } from './SlaveClockAdapter';
import type {
  StepCallback,
  TransportClock,
  TransportSyncMode,
  TransportSyncTelemetry,
} from './types';

export class TransportClockController {
  private context: AudioContext | null = null;
  private adapter: TransportClock | null = null;
  private mode: TransportSyncMode = 'internal';
  private tempo = 120;
  private swing = 0;
  private steps = 32;
  private inputDeviceId: string | null = null;
  private outputDeviceId: string | null = null;
  private playing = false;
  private slaveArmed = false;
  private stepListeners = new Set<StepCallback>();
  private adapterUnsub: (() => void) | null = null;
  private onExternalStop: (() => void) | null = null;

  setOnExternalStop(cb: (() => void) | null): void {
    this.onExternalStop = cb;
  }

  setContext(context: AudioContext | null): void {
    if (this.context === context) return;
    this.disposeAdapter();
    this.context = context;
    if (context && this.playing) this.rebuildAdapter();
  }

  setMode(mode: TransportSyncMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.playing || this.slaveArmed) {
      this.rebuildAdapter();
    }
  }

  setInputDevice(id: string | null): void {
    this.inputDeviceId = id;
    midiPortManager.selectInput(id);
    if (this.mode === 'slave') this.rebuildAdapter();
  }

  setOutputDevice(id: string | null): void {
    this.outputDeviceId = id;
    midiPortManager.selectOutput(id);
    if (this.mode === 'master') this.rebuildAdapter();
  }

  setTempo(bpm: number): void {
    this.tempo = bpm;
    this.adapter?.setTempo(bpm);
  }

  setSwing(swing: number): void {
    this.swing = swing;
    this.adapter?.setSwing(swing);
  }

  setSteps(steps: number): void {
    this.steps = steps;
    this.adapter?.setSteps(steps);
  }

  /** Start transport (internal/master) or arm slave listener. */
  start(): void {
    if (!this.context) return;
    this.playing = true;

    if (this.mode === 'slave') {
      this.slaveArmed = true;
      this.rebuildAdapter();
      this.adapter?.start();
      return;
    }

    this.rebuildAdapter();
    this.adapter?.start();
  }

  stop(): void {
    this.playing = false;
    this.slaveArmed = false;
    this.adapter?.stop();
    if (this.mode !== 'slave') {
      this.disposeAdapter();
    }
  }

  resync(): void {
    this.adapter?.resync();
  }

  onStep(cb: StepCallback): () => void {
    this.stepListeners.add(cb);
    this.ensureAdapterSubscription();
    return () => this.stepListeners.delete(cb);
  }

  getTelemetry(): TransportSyncTelemetry {
    if (this.adapter) return this.adapter.getTelemetry();
    return {
      mode: this.mode,
      state: 'stopped',
      deviceName: null,
      measuredBpm: null,
      phaseErrorMs: 0,
      jitterMs: 0,
      droppedClocks: 0,
      isPlaying: false,
    };
  }

  getMode(): TransportSyncMode {
    return this.mode;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  isSlaveMode(): boolean {
    return this.mode === 'slave';
  }

  dispose(): void {
    this.stop();
    this.disposeAdapter();
    this.stepListeners.clear();
  }

  private rebuildAdapter(): void {
    if (!this.context) return;
    const wasPlaying = this.playing;
    this.disposeAdapter();

    switch (this.mode) {
      case 'internal':
        this.adapter = new InternalClockAdapter(
          this.context,
          this.tempo,
          this.swing,
          this.steps,
        );
        break;
      case 'master':
        this.adapter = new MasterClockAdapter(
          this.context,
          this.tempo,
          this.swing,
          this.steps,
          this.outputDeviceId,
        );
        break;
      case 'slave': {
        const slave = new SlaveClockAdapter(
          this.context,
          this.tempo,
          this.swing,
          this.steps,
          this.inputDeviceId,
        );
        slave.setOnStopExternal(() => {
          this.playing = false;
          this.slaveArmed = false;
          this.onExternalStop?.();
        });
        this.adapter = slave;
        if (this.slaveArmed) slave.setArmed(true);
        break;
      }
    }

    this.ensureAdapterSubscription();
    if (wasPlaying && this.mode !== 'slave') {
      this.adapter?.start();
    }
  }

  private ensureAdapterSubscription(): void {
    if (!this.adapter) return;
    this.adapterUnsub?.();
    this.adapterUnsub = this.adapter.onStep((step, audioTime) => {
      for (const cb of this.stepListeners) cb(step, audioTime);
    });
  }

  private disposeAdapter(): void {
    this.adapterUnsub?.();
    this.adapterUnsub = null;
    this.adapter?.dispose();
    this.adapter = null;
  }
}

export const transportClockController = new TransportClockController();

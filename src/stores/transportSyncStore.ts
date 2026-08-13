import React from 'react';
import type { TransportSyncMode, TransportSyncState, TransportSyncTelemetry } from '../midi/clock/types';
import { getStoredTransportSyncPrefs, setStoredTransportSyncPrefs } from '../utils/transportSyncPrefs';
import { transportClockController } from '../midi/clock/TransportClockController';
import { midiPortManager } from '../midi/MidiPortManager';

export interface TransportSyncStoreState {
  mode: TransportSyncMode;
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  telemetry: TransportSyncTelemetry;
  inputs: { id: string; name: string }[];
  outputs: { id: string; name: string }[];
}

type Listener = (state: TransportSyncStoreState) => void;

function buildTelemetry(): TransportSyncTelemetry {
  return transportClockController.getTelemetry();
}

function createState(): TransportSyncStoreState {
  const prefs = getStoredTransportSyncPrefs();
  return {
    mode: prefs.mode,
    inputDeviceId: prefs.inputDeviceId ?? null,
    outputDeviceId: prefs.outputDeviceId ?? null,
    telemetry: buildTelemetry(),
    inputs: midiPortManager.getInputs(),
    outputs: midiPortManager.getOutputs(),
  };
}

class TransportSyncStoreImpl {
  private state: TransportSyncStoreState = createState();
  private listeners = new Set<Listener>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    transportClockController.setMode(this.state.mode);
    transportClockController.setInputDevice(this.state.inputDeviceId);
    transportClockController.setOutputDevice(this.state.outputDeviceId);
    void midiPortManager.ensureAccess().then(() => this.refreshPorts());
    midiPortManager.onStateChange(() => this.refreshPorts());
    this.startPolling();
  }

  getState(): TransportSyncStoreState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setMode(mode: TransportSyncMode): void {
    this.state = { ...this.state, mode };
    transportClockController.setMode(mode);
    this.persist();
    this.notify();
  }

  setInputDevice(id: string | null): void {
    this.state = { ...this.state, inputDeviceId: id };
    transportClockController.setInputDevice(id);
    this.persist();
    this.notify();
  }

  setOutputDevice(id: string | null): void {
    this.state = { ...this.state, outputDeviceId: id };
    transportClockController.setOutputDevice(id);
    this.persist();
    this.notify();
  }

  resync(): void {
    transportClockController.resync();
  }

  refreshTelemetry(): void {
    this.state = {
      ...this.state,
      telemetry: buildTelemetry(),
      inputs: midiPortManager.getInputs(),
      outputs: midiPortManager.getOutputs(),
    };
    this.notify();
  }

  private refreshPorts(): void {
    this.state = {
      ...this.state,
      inputs: midiPortManager.getInputs(),
      outputs: midiPortManager.getOutputs(),
    };
    this.notify();
  }

  private persist(): void {
    setStoredTransportSyncPrefs({
      mode: this.state.mode,
      inputDeviceId: this.state.inputDeviceId,
      outputDeviceId: this.state.outputDeviceId,
    });
  }

  private notify(): void {
    for (const l of this.listeners) l(this.state);
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.refreshTelemetry(), 250);
  }
}

export const transportSyncStore = new TransportSyncStoreImpl();

export function useTransportSyncStore(): TransportSyncStoreState {
  const [state, setState] = React.useState(() => transportSyncStore.getState());
  React.useEffect(() => transportSyncStore.subscribe(setState), []);
  return state;
}

export function syncStateLabel(state: TransportSyncState): string {
  switch (state) {
    case 'synced':
      return 'synced';
    case 'holdover':
      return 'holdover';
    case 'degraded':
      return 'degraded';
    case 'armed':
      return 'armed';
    default:
      return 'stopped';
  }
}

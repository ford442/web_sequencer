/**
 * Transport & Mix Store
 *
 * External, `useSyncExternalStore`-backed home for the app's transport and
 * master mix properties (tempo, swing, master volume, etc.).
 *
 * These flags used to live as `useState` calls inside `useAppState()`, which meant
 * every one of them was folded into the single object handed to `AppStateContext`.
 * Moving them here lets a component subscribe to exactly the flag it cares
 * about via `useTransportMixStore(selector)`.
 *
 * `useTransportMixState()` (src/hooks/appState/useTransportMixState.ts) still wraps
 * this store so `useAppState()` and `AppStateContext` keep working
 * unchanged for consumers that haven't migrated off the shared context yet.
 */

import { useSyncExternalStore } from 'react';
import { DEFAULT_TEMPO } from '../constants';
import type { ReverbType } from '../types';
import type { TimeSignature } from '../utils/musicTheory';
import { DEFAULT_SONG_METER, type SongMeter, type TrackLengths } from '../utils/songMeter';

export interface TransportMixState {
  tempo: number;
  /** MPC-style percent: 50 = straight, 75 = hardest (see `swingPercentToClock`). */
  swing: number;
  /** Master pattern length in 16th-note steps (song-wide). */
  stepCount: number;
  timeSignature: TimeSignature;
  /** Per-track loop length overrides (polyrhythm); absent = follow `stepCount`. */
  trackLengths: TrackLengths;
  masterVolume: number;
  masterSaturation: number;
  globalPan: number;
  reverbType: ReverbType;
  ambianceUrl: string;
  backgroundImage: string;
}

type Listener = () => void;

function createInitialState(): TransportMixState {
  return {
    tempo: DEFAULT_TEMPO,
    swing: DEFAULT_SONG_METER.swing,
    stepCount: DEFAULT_SONG_METER.stepCount,
    timeSignature: DEFAULT_SONG_METER.timeSignature,
    trackLengths: {},
    masterVolume: 0.8,
    masterSaturation: 0,
    globalPan: 0,
    reverbType: 'plate',
    ambianceUrl: '',
    backgroundImage: '',
  };
}

class TransportMixStore {
  private state: TransportMixState = createInitialState();
  private listeners = new Set<Listener>();

  // Expose refs for audio code to read without a render
  public tempoRef: { current: number } = { current: DEFAULT_TEMPO };
  /** Live meter for the step handler (read on the audio-message path, no render). */
  public meterRef: { current: SongMeter } = { current: { ...DEFAULT_SONG_METER, trackLengths: {} } };
  public lastFreqRef: { current: Record<string, number> } = { current: { partA: 0, partB: 0 } };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): TransportMixState => this.state;

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  private setField<K extends keyof TransportMixState>(key: K, action: TransportMixState[K] | ((prev: TransportMixState[K]) => TransportMixState[K])): void {
    const prev = this.state[key];
    const next: TransportMixState[K] =
      typeof action === 'function' ? (action as (prev: TransportMixState[K]) => TransportMixState[K])(prev) : action;
    if (next === prev) return;
    this.state = { ...this.state, [key]: next };

    // Sync ref for tempo
    if (key === 'tempo') {
        this.tempoRef.current = next as number;
    }
    if (key === 'stepCount' || key === 'timeSignature' || key === 'trackLengths' || key === 'swing') {
        this.syncMeterRef();
    }

    this.notify();
  }

  setTempo = (v: number | ((prev: number) => number)): void => this.setField('tempo', v);
  setSwing = (v: number | ((prev: number) => number)): void => this.setField('swing', v);
  setStepCount = (v: number | ((prev: number) => number)): void => this.setField('stepCount', v);
  setTimeSignature = (v: TimeSignature | ((prev: TimeSignature) => TimeSignature)): void => this.setField('timeSignature', v);
  setTrackLengths = (v: TrackLengths | ((prev: TrackLengths) => TrackLengths)): void => this.setField('trackLengths', v);
  /** Set (or clear with `null`) one track's loop length. */
  setTrackLength = (key: keyof TrackLengths, length: number | null): void =>
    this.setTrackLengths((prev) => {
      const next = { ...prev };
      if (length == null) delete next[key];
      else next[key] = length;
      return next;
    });
  /** Apply a whole song meter at once (song load / import). */
  applyMeter = (meter: SongMeter): void => {
    this.state = {
      ...this.state,
      stepCount: meter.stepCount,
      timeSignature: meter.timeSignature,
      trackLengths: meter.trackLengths,
      swing: meter.swing,
    };
    this.syncMeterRef();
    this.notify();
  };
  /** Snapshot of the meter fields, for saving. */
  getMeter = (): SongMeter => this.meterRef.current;
  setMasterVolume = (v: number | ((prev: number) => number)): void => this.setField('masterVolume', v);
  setMasterSaturation = (v: number | ((prev: number) => number)): void => this.setField('masterSaturation', v);
  setGlobalPan = (v: number | ((prev: number) => number)): void => this.setField('globalPan', v);
  setReverbType = (v: ReverbType | ((prev: ReverbType) => ReverbType)): void => this.setField('reverbType', v);
  setAmbianceUrl = (v: string | ((prev: string) => string)): void => this.setField('ambianceUrl', v);
  setBackgroundImage = (v: string | ((prev: string) => string)): void => this.setField('backgroundImage', v);

  private syncMeterRef(): void {
    const { stepCount, timeSignature, trackLengths, swing } = this.state;
    this.meterRef.current = { stepCount, timeSignature, trackLengths, swing };
  }

  /** Full reset to initial state (used in tests). */
  reset = (): void => {
    this.state = createInitialState();
    this.tempoRef.current = this.state.tempo;
    this.syncMeterRef();
    this.lastFreqRef.current = { partA: 0, partB: 0 };
    this.notify();
  };
}

export const transportMixStore = new TransportMixStore();

const identitySelector = (state: TransportMixState): TransportMixState => state;

export function useTransportMixStore<T = TransportMixState>(
  selector: (state: TransportMixState) => T = identitySelector as unknown as (state: TransportMixState) => T,
): T {
  return useSyncExternalStore(
    transportMixStore.subscribe,
    () => selector(transportMixStore.getSnapshot()),
  );
}

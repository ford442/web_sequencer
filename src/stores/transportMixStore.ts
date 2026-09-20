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

export interface TransportMixState {
  tempo: number;
  swing: number;
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
    swing: 0,
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
    const next = typeof action === 'function' ? (action as any)(prev) : action;
    if (next === prev) return;
    this.state = { ...this.state, [key]: next };

    // Sync ref for tempo
    if (key === 'tempo') {
        this.tempoRef.current = next as number;
    }

    this.notify();
  }

  setTempo = (v: number | ((prev: number) => number)): void => this.setField('tempo', v);
  setSwing = (v: number | ((prev: number) => number)): void => this.setField('swing', v);
  setMasterVolume = (v: number | ((prev: number) => number)): void => this.setField('masterVolume', v);
  setMasterSaturation = (v: number | ((prev: number) => number)): void => this.setField('masterSaturation', v);
  setGlobalPan = (v: number | ((prev: number) => number)): void => this.setField('globalPan', v);
  setReverbType = (v: ReverbType | ((prev: ReverbType) => ReverbType)): void => this.setField('reverbType', v);
  setAmbianceUrl = (v: string | ((prev: string) => string)): void => this.setField('ambianceUrl', v);
  setBackgroundImage = (v: string | ((prev: string) => string)): void => this.setField('backgroundImage', v);

  /** Full reset to initial state (used in tests). */
  reset = (): void => {
    this.state = createInitialState();
    this.tempoRef.current = this.state.tempo;
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

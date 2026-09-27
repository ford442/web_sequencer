import { useSyncExternalStore, type MutableRefObject } from 'react';
import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner';
import type { PartSequence, AudioEngine } from '../types';
import {
  UPDATED_INITIAL_PATTERN,
  type TrackKey,
  type SongSnapshot,
  getInitialTrackStorage,
} from '../constants/appDefaults';

export interface SamplerBanksState {
  trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;
  activeTrackSlots: Record<TrackKey, number>;
  songStorage: (SongSnapshot | null)[];
  activeSongSlot: number | null;
  activeAlignment: AlignmentResult | null;
  activeSamplerBank: number;
  sampleBuffers: (AudioBuffer | null)[];
  ttsPhrases: string[];

  // Refs are kept on the store so they don't trigger re-renders when mutated directly
  trackStorageRef: MutableRefObject<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>;
  activeTrackSlotsRef: MutableRefObject<Record<TrackKey, number>>;
  activeSamplerBankRef: MutableRefObject<number>;
  lastSamplerMidiRef: MutableRefObject<Record<number, number>>;
  lastSamplerFormantRef: MutableRefObject<Record<number, number>>;
  sliceHighlightRef: MutableRefObject<((slice: number) => void) | null>;
}

class SamplerBanksStore {
  private state: SamplerBanksState;
  private listeners = new Set<() => void>();

  constructor() {
    const initialTrackStorage = getInitialTrackStorage(UPDATED_INITIAL_PATTERN);
    const initialActiveTrackSlots = {
      partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0
    };
    const initialActiveSamplerBank = 0;

    this.state = {
      trackStorage: initialTrackStorage,
      activeTrackSlots: initialActiveTrackSlots,
      songStorage: [null, null, null, null],
      activeSongSlot: null,
      activeAlignment: null,
      activeSamplerBank: initialActiveSamplerBank,
      sampleBuffers: new Array(8).fill(null),
      ttsPhrases: Array(8).fill("Hello World"),

      trackStorageRef: { current: initialTrackStorage },
      activeTrackSlotsRef: { current: initialActiveTrackSlots },
      activeSamplerBankRef: { current: initialActiveSamplerBank },
      lastSamplerMidiRef: { current: {} },
      lastSamplerFormantRef: { current: {} },
      sliceHighlightRef: { current: null },
    };
  }

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify = () => {
    for (const listener of this.listeners) {
      listener();
    }
  };

  // Setters

  setTrackStorage = (value: Record<TrackKey, (PartSequence | PartSequence[] | null)[]> | ((prev: Record<TrackKey, (PartSequence | PartSequence[] | null)[]>) => Record<TrackKey, (PartSequence | PartSequence[] | null)[]>)) => {
    const next = typeof value === 'function' ? value(this.state.trackStorage) : value;
    if (this.state.trackStorage !== next) {
      this.state = { ...this.state, trackStorage: next };
      this.state.trackStorageRef.current = next;
      this.notify();
    }
  };

  setActiveTrackSlots = (value: Record<TrackKey, number> | ((prev: Record<TrackKey, number>) => Record<TrackKey, number>)) => {
    const next = typeof value === 'function' ? value(this.state.activeTrackSlots) : value;
    if (this.state.activeTrackSlots !== next) {
      this.state = { ...this.state, activeTrackSlots: next };
      this.state.activeTrackSlotsRef.current = next;
      this.notify();
    }
  };

  setSongStorage = (value: (SongSnapshot | null)[] | ((prev: (SongSnapshot | null)[]) => (SongSnapshot | null)[])) => {
    const next = typeof value === 'function' ? value(this.state.songStorage) : value;
    if (this.state.songStorage !== next) {
      this.state = { ...this.state, songStorage: next };
      this.notify();
    }
  };

  setActiveSongSlot = (value: number | null | ((prev: number | null) => number | null)) => {
    const next = typeof value === 'function' ? value(this.state.activeSongSlot) : value;
    if (this.state.activeSongSlot !== next) {
      this.state = { ...this.state, activeSongSlot: next };
      this.notify();
    }
  };

  setActiveAlignment = (value: AlignmentResult | null | ((prev: AlignmentResult | null) => AlignmentResult | null)) => {
    const next = typeof value === 'function' ? value(this.state.activeAlignment) : value;
    if (this.state.activeAlignment !== next) {
      this.state = { ...this.state, activeAlignment: next };
      this.notify();
    }
  };

  setActiveSamplerBank = (value: number | ((prev: number) => number)) => {
    const next = typeof value === 'function' ? value(this.state.activeSamplerBank) : value;
    if (this.state.activeSamplerBank !== next) {
      this.state = { ...this.state, activeSamplerBank: next };
      this.state.activeSamplerBankRef.current = next;
      this.notify();
    }
  };

  setSampleBuffers = (value: (AudioBuffer | null)[] | ((prev: (AudioBuffer | null)[]) => (AudioBuffer | null)[])) => {
    const next = typeof value === 'function' ? value(this.state.sampleBuffers) : value;
    if (this.state.sampleBuffers !== next) {
      this.state = { ...this.state, sampleBuffers: next };
      this.notify();
    }
  };

  setTtsPhrases = (value: string[] | ((prev: string[]) => string[])) => {
    const next = typeof value === 'function' ? value(this.state.ttsPhrases) : value;
    if (this.state.ttsPhrases !== next) {
      this.state = { ...this.state, ttsPhrases: next };
      this.notify();
    }
  };
}

export const samplerBanksStore = new SamplerBanksStore();

const identitySelector = (state: SamplerBanksState): SamplerBanksState => state;

export function useSamplerBanksStore<T = SamplerBanksState>(
  selector: (state: SamplerBanksState) => T = identitySelector as unknown as (state: SamplerBanksState) => T,
): T {
  return useSyncExternalStore(
    samplerBanksStore.subscribe,
    () => selector(samplerBanksStore.getSnapshot()),
  );
}

// Helpers to compute derived properties from sampleBuffers
export function loadedBanksFrom(buffers: readonly (AudioBuffer | null)[]): boolean[] {
  return buffers.map((b) => b != null);
}

export function multisampleFlagsFrom(
  buffers: readonly (AudioBuffer | null)[],
  engine: AudioEngine | null,
): { ready: boolean[]; processing: boolean[] } {
  const ready = buffers.map((_, i) => engine?.isMultisampleReady?.(i) ?? false);
  const processing = buffers.map((_, i) => engine?.getMultisampleBank?.(i)?.isProcessing ?? false);
  return { ready, processing };
}

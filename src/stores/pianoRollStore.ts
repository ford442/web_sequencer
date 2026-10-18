/**
 * Which track the piano roll is editing (#1345 Phase 1), or null when closed.
 *
 * Session UI state, never saved with the song. The row-header chip writes it
 * directly, so nothing threads through MainSequencer; the lazy panel host is
 * the only reader that mounts anything.
 */
import { useSyncExternalStore } from 'react';
import type { TrackKey } from '@/types';

/** Tracks with pitched notes. Drums have a fixed pitch and no roll. */
export type PianoRollTrack = Extract<TrackKey, 'partA' | 'partB' | 'bass2' | 'sampler'>;

export const PIANO_ROLL_TRACKS: readonly PianoRollTrack[] = ['partA', 'partB', 'bass2', 'sampler'];

export function isPianoRollTrack(key: TrackKey): key is PianoRollTrack {
    return (PIANO_ROLL_TRACKS as readonly TrackKey[]).includes(key);
}

export interface PianoRollTarget {
    track: PianoRollTrack;
    /** Sampler bank (0–7); always 0 for the synth tracks. */
    bank: number;
}

export interface PianoRollState {
    open: PianoRollTarget | null;
}

type Listener = () => void;

let state: PianoRollState = { open: null };
const listeners = new Set<Listener>();
/** Element focused when the roll opened; focus returns there on close. */
let returnFocus: HTMLElement | null = null;

function setState(next: PianoRollState): void {
    if (next.open?.track === state.open?.track && next.open?.bank === state.open?.bank) return;
    state = next;
    listeners.forEach((fn) => fn());
}

export const pianoRollStore = {
    getSnapshot(): PianoRollState {
        return state;
    },
    // An arrow, so it can be passed bare to useSyncExternalStore.
    subscribe: (fn: Listener): (() => void) => {
        listeners.add(fn);
        return () => {
            listeners.delete(fn);
        };
    },
    open(track: PianoRollTrack, bank = 0): void {
        if (!state.open && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
            returnFocus = document.activeElement;
        }
        setState({ open: { track, bank: track === 'sampler' ? Math.min(7, Math.max(0, bank)) : 0 } });
    },
    toggle(track: PianoRollTrack, bank = 0): void {
        if (state.open?.track === track && state.open.bank === (track === 'sampler' ? bank : 0)) {
            pianoRollStore.close();
        } else {
            pianoRollStore.open(track, bank);
        }
    },
    close(): void {
        if (!state.open) return;
        setState({ open: null });
        const target = returnFocus;
        returnFocus = null;
        if (target?.isConnected) target.focus();
    },
    /** @internal unit tests */
    reset(): void {
        returnFocus = null;
        setState({ open: null });
    },
};

export function usePianoRollStore<T>(selector: (s: PianoRollState) => T): T {
    return useSyncExternalStore(
        pianoRollStore.subscribe,
        () => selector(pianoRollStore.getSnapshot()),
        () => selector(pianoRollStore.getSnapshot()),
    );
}

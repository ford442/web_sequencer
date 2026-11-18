/**
 * Runtime-only per-track mute / solo state for the eight sequencer tracks and
 * the audio tracks (#1629): one solo mask across both.
 *
 * Deliberately not part of the song schema, `HyphonSong` or cloud storage: the
 * state is a mix decision for the current session. It survives pattern and slot
 * switches (nothing here is keyed by pattern) and is gone on reload.
 *
 * `isAudible` is the single source of truth for the solo mask and is called
 * once per track per step on the audio hot path, so it stays allocation-free.
 */

import React from 'react';
import type { TrackKey } from '../constants/appDefaults';
import type { AudioTrackKey } from '../types/song';

/** A mixer channel: one of the eight sequencer tracks or an audio track (#1629). */
export type MixTrackKey = TrackKey | AudioTrackKey;

export interface TrackMuteSoloState {
    muted: MixTrackKey[];
    soloed: MixTrackKey[];
    anySoloed: boolean;
}

type Listener = (state: TrackMuteSoloState) => void;

class TrackMuteSoloStore {
    private muted = new Set<MixTrackKey>();
    private soloed = new Set<MixTrackKey>();
    private listeners = new Set<Listener>();

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        listener(this.getState());
        return () => this.listeners.delete(listener);
    }

    getState(): TrackMuteSoloState {
        return {
            muted: Array.from(this.muted),
            soloed: Array.from(this.soloed),
            anySoloed: this.soloed.size > 0,
        };
    }

    isMuted(track: MixTrackKey): boolean {
        return this.muted.has(track);
    }

    isSoloed(track: MixTrackKey): boolean {
        return this.soloed.has(track);
    }

    anySoloed(): boolean {
        return this.soloed.size > 0;
    }

    /**
     * The solo mask: if anything is soloed a track sounds iff it is soloed,
     * otherwise it sounds iff it is not muted. Solo therefore wins over mute
     * on a track that is both.
     */
    isAudible(track: MixTrackKey): boolean {
        if (this.soloed.size > 0) return this.soloed.has(track);
        return !this.muted.has(track);
    }

    setMuted(track: MixTrackKey, muted: boolean): void {
        if (this.muted.has(track) === muted) return;
        if (muted) this.muted.add(track);
        else this.muted.delete(track);
        this.notify();
    }

    setSoloed(track: MixTrackKey, soloed: boolean): void {
        if (this.soloed.has(track) === soloed) return;
        if (soloed) this.soloed.add(track);
        else this.soloed.delete(track);
        this.notify();
    }

    toggleMute(track: MixTrackKey): void {
        this.setMuted(track, !this.muted.has(track));
    }

    toggleSolo(track: MixTrackKey): void {
        this.setSoloed(track, !this.soloed.has(track));
    }

    reset(): void {
        if (this.muted.size === 0 && this.soloed.size === 0) return;
        this.muted.clear();
        this.soloed.clear();
        this.notify();
    }

    private notify(): void {
        const state = this.getState();
        this.listeners.forEach((l) => l(state));
    }
}

export const trackMuteSoloStore = new TrackMuteSoloStore();

export function useTrackMuteSolo(): TrackMuteSoloState {
    const [state, setState] = React.useState<TrackMuteSoloState>(() => trackMuteSoloStore.getState());
    React.useEffect(() => trackMuteSoloStore.subscribe(setState), []);
    return state;
}

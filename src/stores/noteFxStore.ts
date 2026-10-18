/**
 * Per-track note FX chains (#1345 Phase 2). Saved with the song
 * (`SavedSongData.noteFx`); read by the step handler on every step through
 * `getActiveChain`, which is allocation-free. Chains are immutable: every
 * edit replaces the track's chain object, which is what the live and preview
 * caches key on.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { normalizeSongNoteFx } from '@/sequencer/noteFx/params';
import {
    NOTE_FX_TRACKS,
    chainIsActive,
    defaultNoteFxChain,
    type NoteFxChain,
    type NoteFxModuleId,
    type NoteFxTrack,
    type SongNoteFx,
} from '@/sequencer/noteFx/types';

type Listener = () => void;

/** Distinct default seeds, so two tracks' humanize never move in lockstep. */
const DEFAULT_SEEDS: Record<NoteFxTrack, number> = { partA: 101, partB: 202, bass2: 303, sampler: 404 };

let chains: SongNoteFx = {};
const listeners = new Set<Listener>();

function emit(): void {
    listeners.forEach((fn) => fn());
}

export const noteFxStore = {
    getSnapshot(): SongNoteFx {
        return chains;
    },
    subscribe(fn: Listener): () => void {
        listeners.add(fn);
        return () => {
            listeners.delete(fn);
        };
    },
    /** The track's chain, or a fresh default one (not stored until edited). */
    getChain(track: NoteFxTrack): NoteFxChain {
        return chains[track] ?? defaultNoteFxChain(DEFAULT_SEEDS[track]);
    },
    /** The chain when it changes anything, else null — the step handler's hot-path check. */
    getActiveChain(track: NoteFxTrack): NoteFxChain | null {
        const chain = chains[track];
        return chainIsActive(chain) ? chain : null;
    },
    setChain(track: NoteFxTrack, chain: NoteFxChain): void {
        chains = { ...chains, [track]: chain };
        emit();
    },
    /** Merge a patch into one module of a track's chain. */
    updateModule<M extends NoteFxModuleId>(track: NoteFxTrack, module: M, patch: Partial<NoteFxChain[M]>): void {
        const current = noteFxStore.getChain(track);
        noteFxStore.setChain(track, { ...current, [module]: { ...current[module], ...patch } });
    },
    /** Turn every module off, keeping the settings (after a freeze). */
    bypass(track: NoteFxTrack): void {
        const c = chains[track];
        if (!c) return;
        noteFxStore.setChain(track, {
            ...c,
            chord: { ...c.chord, enabled: false },
            arp: { ...c.arp, enabled: false },
            ratchet: { ...c.ratchet, enabled: false },
            euclid: { ...c.euclid, enabled: false },
            humanize: { ...c.humanize, enabled: false },
        });
    },
    /** For `SavedSongData.noteFx`: only tracks that were ever configured. */
    exportChains(): SongNoteFx {
        const out: SongNoteFx = {};
        for (const track of NOTE_FX_TRACKS) if (chains[track]) out[track] = chains[track];
        return out;
    },
    hasChains(): boolean {
        return NOTE_FX_TRACKS.some((t) => chains[t] !== undefined);
    },
    /** Replace everything from a loaded song (absent / invalid → no chains). */
    importChains(raw: unknown): void {
        chains = normalizeSongNoteFx(raw);
        emit();
    },
    reset(): void {
        chains = {};
        emit();
    },
};

export function useNoteFxChain(track: NoteFxTrack): NoteFxChain {
    // Subscribe to the stored chain (a stable object); the default for an
    // unconfigured track is memoised so consumers' effects do not churn.
    const stored = useSyncExternalStore(noteFxStore.subscribe, () => chains[track], () => chains[track]);
    const fallback = useMemo(() => defaultNoteFxChain(DEFAULT_SEEDS[track]), [track]);
    return stored ?? fallback;
}

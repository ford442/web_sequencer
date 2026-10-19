/**
 * Note FX chains (#1345) persist with the song: written only when a track
 * has a chain, validated on load, and cleared by a song that has none.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSongStorage, type SongStorageDeps } from '../useSongStorage';
import { noteFxStore } from '../../stores/noteFxStore';
import { UPDATED_INITIAL_PATTERN } from '../../constants/appDefaults';
import type { SavedSongData } from '../../types';
import { createArrangement } from '../../arrangement/model';
import { defaultNoteFxChain } from '../../sequencer/noteFx/types';

function makeDeps(): SongStorageDeps {
    const base: Record<string, unknown> = {
        patternRef: { current: UPDATED_INITIAL_PATTERN },
        tempoRef: { current: 120 },
        trackStorageRef: { current: {} },
        activeTrackSlotsRef: { current: {} },
        songStructureRef: { current: [] },
        arrangementRef: { current: createArrangement(32) },
        ambianceUrl: '',
        backgroundImage: '',
        sampleBuffers: [],
        ttsPhrases: [],
        songStorage: [],
        pattern: UPDATED_INITIAL_PATTERN,
        tempo: 120,
        trackStorage: {},
        audioEngine: null,
    };
    return new Proxy(base, {
        get(target, key: string) {
            if (!(key in target)) target[key] = key.endsWith('Ref') ? { current: {} } : vi.fn();
            return target[key];
        },
    }) as unknown as SongStorageDeps;
}

describe('useSongStorage note FX', () => {
    afterEach(() => noteFxStore.reset());

    it('omits noteFx from a song that never used it', async () => {
        const { result } = renderHook(() => useSongStorage(makeDeps()));
        const data = await result.current.getSongData();
        expect(data).not.toHaveProperty('noteFx');
    });

    it('round-trips configured chains through save and load', async () => {
        const chain = defaultNoteFxChain(42);
        chain.arp = { enabled: true, mode: 'updown', rate: 0.5, octaves: 2, gate: 0.6 };
        noteFxStore.setChain('bass2', chain);
        const { result } = renderHook(() => useSongStorage(makeDeps()));
        const saved = JSON.parse(JSON.stringify(await result.current.getSongData())) as SavedSongData;
        expect(saved.noteFx).toEqual({ bass2: chain });

        noteFxStore.reset();
        // The proxy deps save placeholder synth params; load just what is under test.
        const reloaded = { version: saved.version, pattern: UPDATED_INITIAL_PATTERN, tempo: 120, noteFx: saved.noteFx } as SavedSongData;
        await act(() => result.current.loadCloudData(reloaded, 'song'));
        expect(noteFxStore.getSnapshot()).toEqual({ bass2: chain });
    });

    it('validates chains on load and clears them for a song without any', async () => {
        const { result } = renderHook(() => useSongStorage(makeDeps()));
        const hostile = {
            version: 5, pattern: UPDATED_INITIAL_PATTERN, tempo: 120,
            noteFx: { partA: { ratchet: { enabled: true, count: 99 } }, kick: { arp: { enabled: true } } },
        } as unknown as SavedSongData;
        await act(() => result.current.loadCloudData(hostile, 'song'));
        expect(noteFxStore.getSnapshot().partA?.ratchet).toMatchObject({ enabled: true, count: 8 });
        expect(Object.keys(noteFxStore.getSnapshot())).toEqual(['partA']);

        const plain = { version: 5, pattern: UPDATED_INITIAL_PATTERN, tempo: 120 } as unknown as SavedSongData;
        await act(() => result.current.loadCloudData(plain, 'song'));
        expect(noteFxStore.getSnapshot()).toEqual({});
    });
});

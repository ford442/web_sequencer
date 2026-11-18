import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSongStorage, type SongStorageDeps } from '../useSongStorage';
import { transportMixStore } from '../../stores/transportMixStore';
import { UPDATED_INITIAL_PATTERN } from '../../constants/appDefaults';
import type { Arrangement, SavedSongData } from '../../types';
import { createArrangement, placeClip } from '../../arrangement/model';
import { createEmptyMeasure } from '../../utils/songModeEditing';
import { arrangementStore } from '../../stores/songRecordStore';

/** Every dep a spy; the arrangement itself lives in `arrangementStore` (#1597 P2). */
function makeDeps(arrangement: Arrangement): SongStorageDeps {
  arrangementStore.set(arrangement);
  const base: Record<string, unknown> = { audioEngine: null };
  return new Proxy(base, {
    get(target, key: string) {
      if (!(key in target)) target[key] = key.endsWith('Ref') ? { current: null } : vi.fn();
      return target[key];
    },
  }) as unknown as SongStorageDeps;
}

const trimmed = placeClip(createArrangement(64), {
  id: 'clip-1', track: 'kick', patternSlot: 2, startStep: 4, lengthSteps: 8, loop: false, offsetSteps: 4,
});

describe('useSongStorage arrangement (v5)', () => {
  afterEach(() => {
    transportMixStore.reset();
    arrangementStore.reset();
  });

  it('saves the arrangement and its Song Mode projection', async () => {
    transportMixStore.setStepCount(16);
    const deps = makeDeps(trimmed);
    const { result } = renderHook(() => useSongStorage(deps));
    const data = await result.current.getSongData();
    expect(data.version).toBe(5);
    expect(data.arrangement).toEqual(trimmed);
    const structure = data.songStructure as Array<Record<string, number | null>>;
    expect(structure).toHaveLength(4);
    expect(structure[0].kick).toBe(2);
    expect(structure[1].kick).toBeNull();
  });

  it('loads a v5 arrangement as saved (trim, offset and one-shot kept)', async () => {
    const deps = makeDeps(createArrangement(32));
    const { result } = renderHook(() => useSongStorage(deps));
    const v5 = { version: 5, pattern: UPDATED_INITIAL_PATTERN, tempo: 120, songStructure: [], arrangement: trimmed } as unknown as SavedSongData;
    await act(() => result.current.loadCloudData(v5, 'song'));
    expect(arrangementStore.getSnapshot()).toEqual(trimmed);
  });

  it('migrates a v4 song: one clip per cell at the song meter length', async () => {
    const deps = makeDeps(createArrangement(32));
    const { result } = renderHook(() => useSongStorage(deps));
    const v4 = {
      version: 4, pattern: UPDATED_INITIAL_PATTERN, tempo: 120, stepCount: 24,
      songStructure: [{ ...createEmptyMeasure(), kick: 0 }, createEmptyMeasure(), { ...createEmptyMeasure(), snare: 3 }],
    } as unknown as SavedSongData;
    await act(() => result.current.loadCloudData(v4, 'song'));
    const loaded = arrangementStore.getSnapshot();
    expect(loaded.lengthSteps).toBe(72);
    expect(loaded.clips.map((c) => [c.track, c.patternSlot, c.startStep, c.lengthSteps])).toEqual([
      ['kick', 0, 0, 24],
      ['snare', 3, 48, 24],
    ]);
  });
});

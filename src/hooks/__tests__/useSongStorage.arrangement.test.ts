import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSongStorage, type SongStorageDeps } from '../useSongStorage';
import { transportMixStore } from '../../stores/transportMixStore';
import { UPDATED_INITIAL_PATTERN } from '../../constants/appDefaults';
import type { Arrangement, SavedSongData } from '../../types';
import { createArrangement, placeClip } from '../../arrangement/model';
import { createEmptyMeasure } from '../../utils/songModeEditing';

function makeDeps(arrangement: Arrangement) {
  const setArrangement = vi.fn();
  const base: Record<string, unknown> = {
    patternRef: { current: UPDATED_INITIAL_PATTERN },
    tempoRef: { current: 120 },
    trackStorageRef: { current: {} },
    activeTrackSlotsRef: { current: {} },
    songStructureRef: { current: [] },
    arrangementRef: { current: arrangement },
    setArrangement,
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
  const deps = new Proxy(base, {
    get(target, key: string) {
      if (!(key in target)) target[key] = key.endsWith('Ref') ? { current: {} } : vi.fn();
      return target[key];
    },
  }) as unknown as SongStorageDeps;
  return { deps, setArrangement };
}

const trimmed = placeClip(createArrangement(64), {
  id: 'clip-1', track: 'kick', patternSlot: 2, startStep: 4, lengthSteps: 8, loop: false, offsetSteps: 4,
});

describe('useSongStorage arrangement (v5)', () => {
  afterEach(() => transportMixStore.reset());

  it('saves the arrangement and its Song Mode projection', async () => {
    transportMixStore.setStepCount(16);
    const { deps } = makeDeps(trimmed);
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
    const { deps, setArrangement } = makeDeps(createArrangement(32));
    const { result } = renderHook(() => useSongStorage(deps));
    const v5 = { version: 5, pattern: UPDATED_INITIAL_PATTERN, tempo: 120, songStructure: [], arrangement: trimmed } as unknown as SavedSongData;
    await act(() => result.current.loadCloudData(v5, 'song'));
    expect(setArrangement).toHaveBeenCalledWith(trimmed);
  });

  it('migrates a v4 song: one clip per cell at the song meter length', async () => {
    const { deps, setArrangement } = makeDeps(createArrangement(32));
    const { result } = renderHook(() => useSongStorage(deps));
    const v4 = {
      version: 4, pattern: UPDATED_INITIAL_PATTERN, tempo: 120, stepCount: 24,
      songStructure: [{ ...createEmptyMeasure(), kick: 0 }, createEmptyMeasure(), { ...createEmptyMeasure(), snare: 3 }],
    } as unknown as SavedSongData;
    await act(() => result.current.loadCloudData(v4, 'song'));
    const loaded = setArrangement.mock.calls[0][0] as Arrangement;
    expect(loaded.lengthSteps).toBe(72);
    expect(loaded.clips.map((c) => [c.track, c.patternSlot, c.startStep, c.lengthSteps])).toEqual([
      ['kick', 0, 0, 24],
      ['snare', 3, 48, 24],
    ]);
  });
});

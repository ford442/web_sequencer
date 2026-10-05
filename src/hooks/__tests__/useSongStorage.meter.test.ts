import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSongStorage, type SongStorageDeps } from '../useSongStorage';
import { transportMixStore } from '../../stores/transportMixStore';
import { SAVED_SONG_DATA_VERSION } from '../../constants';
import { UPDATED_INITIAL_PATTERN } from '../../constants/appDefaults';
import type { SavedSongData } from '../../types';

/** Refs get `{ current }`, everything else a spy — enough for save/load of a bare song. */
function makeDeps(): SongStorageDeps {
  const base: Record<string, unknown> = {
    patternRef: { current: UPDATED_INITIAL_PATTERN },
    tempoRef: { current: 120 },
    trackStorageRef: { current: {} },
    activeTrackSlotsRef: { current: {} },
    songStructureRef: { current: [] },
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

describe('useSongStorage song meter', () => {
  afterEach(() => transportMixStore.reset());

  it('writes the meter with version 4', async () => {
    transportMixStore.setStepCount(24);
    transportMixStore.setTimeSignature([3, 4]);
    transportMixStore.setTrackLength('closedHat', 12);
    transportMixStore.setSwing(62);
    const { result } = renderHook(() => useSongStorage(makeDeps()));
    const data = await result.current.getSongData();
    expect(SAVED_SONG_DATA_VERSION).toBe(4);
    expect(data).toMatchObject({
      version: 4,
      stepCount: 24,
      timeSignature: [3, 4],
      trackLengths: { closedHat: 12 },
      swing: 62,
    });
  });

  it('loads a v3 song as 32 steps, 4/4, straight', async () => {
    transportMixStore.setStepCount(16);
    transportMixStore.setTimeSignature([7, 8]);
    transportMixStore.setSwing(70);
    const { result } = renderHook(() => useSongStorage(makeDeps()));
    const v3 = { version: 3, pattern: UPDATED_INITIAL_PATTERN, tempo: 120 } as unknown as SavedSongData;
    await act(() => result.current.loadCloudData(v3, 'song'));
    expect(transportMixStore.getMeter()).toEqual({ stepCount: 32, timeSignature: [4, 4], trackLengths: {}, swing: 50 });
  });

  it('round-trips a saved meter through load', async () => {
    const { result } = renderHook(() => useSongStorage(makeDeps()));
    const v4 = {
      version: 4, pattern: UPDATED_INITIAL_PATTERN, tempo: 120,
      stepCount: 12, timeSignature: [6, 8], trackLengths: { kick: 8 }, swing: 66,
    } as unknown as SavedSongData;
    await act(() => result.current.loadCloudData(v4, 'song'));
    expect(transportMixStore.getMeter()).toEqual({ stepCount: 12, timeSignature: [6, 8], trackLengths: { kick: 8 }, swing: 66 });
  });
});

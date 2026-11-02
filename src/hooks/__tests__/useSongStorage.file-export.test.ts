import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSongStorage, type SongStorageDeps } from '../useSongStorage';

vi.mock('../../importers/rbs', () => ({
    RbsExporter: class RbsExporter {
        exportToBlob() { return { success: true, blob: new Blob() }; }
    },
    hyphonSongFromSavedData: vi.fn(),
    shouldExportRbsSongMode: vi.fn(),
}));

vi.mock('../../importers/smf', () => ({
    SmfExporter: class SmfExporter {
        exportToBlob() { return { success: true, blob: new Blob() }; }
    },
    hyphonSongFromSavedDataForSmf: vi.fn(),
}));

// mock URL and document functions
global.URL.createObjectURL = vi.fn();
global.URL.revokeObjectURL = vi.fn();

function makeDeps() {
  const base: Record<string, unknown> = {
    patternRef: { current: {} },
    tempoRef: { current: 120 },
    trackStorageRef: { current: {} },
    activeTrackSlotsRef: { current: {} },
    songStructureRef: { current: [] },
    arrangementRef: { current: { clips: [] } },
    ambianceUrl: '',
    backgroundImage: '',
    sampleBuffers: [],
    ttsPhrases: [],
    songStorage: [],
    pattern: {},
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
  return { deps };
}

describe('useSongStorage file export loading states', () => {
    it('sets and clears isExportingRbs correctly', async () => {
        const { deps } = makeDeps();
        const { result } = renderHook(() => useSongStorage(deps));

        expect(result.current.isExportingRbs).toBe(false);

        let exportPromise: Promise<void>;
        act(() => {
            exportPromise = result.current.exportRbsToFile();
        });

        // The async operation sets the flag
        expect(result.current.isExportingRbs).toBe(true);

        await act(async () => {
            await exportPromise;
        });

        // Flag clears after completion
        expect(result.current.isExportingRbs).toBe(false);
    });

    it('sets and clears isExportingSmf correctly', async () => {
        const { deps } = makeDeps();
        const { result } = renderHook(() => useSongStorage(deps));

        expect(result.current.isExportingSmf).toBe(false);

        let exportPromise: Promise<void>;
        act(() => {
            exportPromise = result.current.exportSmfToFile();
        });

        // The async operation sets the flag
        expect(result.current.isExportingSmf).toBe(true);

        await act(async () => {
            await exportPromise;
        });

        // Flag clears after completion
        expect(result.current.isExportingSmf).toBe(false);
    });

    it('clears isExportingRbs even on failure', async () => {
        const { deps } = makeDeps();

        // Setup mock to fail
        vi.mocked(await import('../../importers/rbs')).shouldExportRbsSongMode.mockImplementationOnce(() => {
            throw new Error('Test Error');
        });

        const { result } = renderHook(() => useSongStorage(deps));

        expect(result.current.isExportingRbs).toBe(false);

        let exportPromise: Promise<void>;
        act(() => {
            exportPromise = result.current.exportRbsToFile();
        });

        expect(result.current.isExportingRbs).toBe(true);

        await act(async () => {
            await exportPromise;
        });

        // Flag clears after failure
        expect(result.current.isExportingRbs).toBe(false);
    });
});

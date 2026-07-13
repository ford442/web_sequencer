import { describe, it, expect, beforeEach } from 'vitest';
import {
    saveSessionToLocalStorage,
    loadSessionFromLocalStorage,
    clearSessionFromLocalStorage,
    hasStoredSession,
    toCompactSongData,
    makeAutoSave,
    AUTOSAVE_VERSION,
    type CompactSongData,
    type StorageBackend,
} from '../utils/projectPersistence';
import type { SavedSongData } from '../types';

// ── Mock storage ──────────────────────────────────────────────────────────────

function makeMockStorage(): StorageBackend & { store: Record<string, string> } {
    const store: Record<string, string> = {};
    return {
        store,
        getItem:    (k) => store[k] ?? null,
        setItem:    (k, v) => { store[k] = v; },
        removeItem: (k) => { delete store[k]; },
    };
}

// ── Minimal SavedSongData fixture ─────────────────────────────────────────────

const EMPTY_SEQUENCE = { steps: Array(32).fill(null) };
const BASE_SONG: SavedSongData = {
    version: 1,
    pattern: {
        partA: EMPTY_SEQUENCE,
        partB: EMPTY_SEQUENCE,
        bass2: EMPTY_SEQUENCE,
        kick: EMPTY_SEQUENCE,
        snare: EMPTY_SEQUENCE,
        closedHat: EMPTY_SEQUENCE,
        openHat: EMPTY_SEQUENCE,
        sampler: Array(8).fill(EMPTY_SEQUENCE),
    },
    params: {
        synthA: { waveform: 'sawtooth', pitch: 0, filterCutoff: 2000, filterResonance: 1, attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3, length: 1, volume: 0.8, delayTime: 0, delayFeedback: 0, delayMix: 0 },
        synthB: { waveform: 'square',   pitch: 0, filterCutoff: 2000, filterResonance: 1, attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3, length: 1, volume: 0.8, delayTime: 0, delayFeedback: 0, delayMix: 0 },
        bass2: { waveform: '303-saw', cutoff: 2000, resonance: 1, filterMode: 0, decay: 0.3, volume: 0.8, pitch: 0, accent: 0.5 } as any,
        kick:       { pitch: 0, decay: 0.5, tone: 0.5, volume: 0.8 },
        snare:      { decay: 0.3, tone: 0.5, noise: 0.5, volume: 0.8 },
        closedHat:  { pitch: 0, decay: 0.1, volume: 0.8 },
        openHat:    { pitch: 0, decay: 0.4, volume: 0.8 },
        sampler: Array(8).fill({ sampleName: '', playbackSpeed: 1, volume: 1, filterCutoff: 20000, filterResonance: 0, drive: 0, delaySend: 0 }),
    },
    trackStorage: {},
    activeTrackSlots: { partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0 },
    songStructure: [],
    tempo: 120,
};

// ── toCompactSongData ─────────────────────────────────────────────────────────

describe('toCompactSongData', () => {
    it('strips embeddedSamples and backgroundImage', () => {
        const full: SavedSongData = {
            ...BASE_SONG,
            embeddedSamples: { 0: 'data:audio/wav;base64,longstring' },
            backgroundImage: 'data:image/jpeg;base64,..very long..',
        };
        const compact = toCompactSongData(full);
        expect('embeddedSamples' in compact).toBe(false);
        expect('backgroundImage' in compact).toBe(false);
    });

    it('sets autosaveVersion and savedAt', () => {
        const compact = toCompactSongData(BASE_SONG);
        expect(compact.autosaveVersion).toBe(AUTOSAVE_VERSION);
        expect(typeof compact.savedAt).toBe('number');
        expect(compact.savedAt).toBeLessThanOrEqual(Date.now());
    });

    it('sets samplesStripped=true when samples were present', () => {
        const full: SavedSongData = {
            ...BASE_SONG,
            embeddedSamples: { 0: 'data:audio/wav;base64,...' },
        };
        expect(toCompactSongData(full).samplesStripped).toBe(true);
    });

    it('sets samplesStripped=false when no samples present', () => {
        expect(toCompactSongData(BASE_SONG).samplesStripped).toBe(false);
    });

    it('preserves tempo, pattern, params, and automationLanes', () => {
        const compact = toCompactSongData(BASE_SONG);
        expect(compact.tempo).toBe(120);
        expect(compact.pattern).toBe(BASE_SONG.pattern);
    });
});

// ── saveSessionToLocalStorage ─────────────────────────────────────────────────

describe('saveSessionToLocalStorage', () => {
    it('writes JSON to the storage backend and returns true', () => {
        const storage = makeMockStorage();
        const ok = saveSessionToLocalStorage(BASE_SONG, storage);
        expect(ok).toBe(true);
        expect(typeof storage.store['hyphon:autosave:v1']).toBe('string');
    });

    it('the stored value is valid JSON containing tempo', () => {
        const storage = makeMockStorage();
        saveSessionToLocalStorage(BASE_SONG, storage);
        const parsed = JSON.parse(storage.store['hyphon:autosave:v1']!);
        expect(parsed.tempo).toBe(120);
    });

    it('returns false and does not throw when storage throws (quota exceeded)', () => {
        const badStorage: StorageBackend = {
            getItem: () => null,
            setItem: () => { throw new Error('QuotaExceededError'); },
            removeItem: () => {},
        };
        expect(() => saveSessionToLocalStorage(BASE_SONG, badStorage)).not.toThrow();
        expect(saveSessionToLocalStorage(BASE_SONG, badStorage)).toBe(false);
    });

    it('skips payloads larger than 512 KB and returns false', () => {
        const huge: SavedSongData = {
            ...BASE_SONG,
            // A 600 KB string embedded in the data
            ambianceUrl: 'x'.repeat(600 * 1024),
        };
        const storage = makeMockStorage();
        const ok = saveSessionToLocalStorage(huge, storage);
        expect(ok).toBe(false);
        expect(storage.store['hyphon:autosave:v1']).toBeUndefined();
    });
});

// ── loadSessionFromLocalStorage ───────────────────────────────────────────────

describe('loadSessionFromLocalStorage', () => {
    it('returns null when nothing is stored', () => {
        const storage = makeMockStorage();
        expect(loadSessionFromLocalStorage(storage)).toBeNull();
    });

    it('round-trips a save → load cycle', () => {
        const storage = makeMockStorage();
        saveSessionToLocalStorage(BASE_SONG, storage);
        const restored = loadSessionFromLocalStorage(storage);
        expect(restored).not.toBeNull();
        expect(restored!.tempo).toBe(120);
        expect(restored!.autosaveVersion).toBe(AUTOSAVE_VERSION);
    });

    it('returns null for corrupt JSON', () => {
        const storage = makeMockStorage();
        storage.setItem('hyphon:autosave:v1', 'not json }{');
        expect(loadSessionFromLocalStorage(storage)).toBeNull();
    });

    it('returns null when autosaveVersion does not match', () => {
        const storage = makeMockStorage();
        const stale: CompactSongData = {
            ...toCompactSongData(BASE_SONG),
            autosaveVersion: 999,
        };
        storage.setItem('hyphon:autosave:v1', JSON.stringify(stale));
        expect(loadSessionFromLocalStorage(storage)).toBeNull();
    });

    it('returns null when pattern field is missing', () => {
        const storage = makeMockStorage();
        const bad = { autosaveVersion: AUTOSAVE_VERSION, tempo: 120, savedAt: Date.now() };
        storage.setItem('hyphon:autosave:v1', JSON.stringify(bad));
        expect(loadSessionFromLocalStorage(storage)).toBeNull();
    });

    it('returns null when tempo is not a number', () => {
        const storage = makeMockStorage();
        const compact = toCompactSongData(BASE_SONG);
        storage.setItem('hyphon:autosave:v1', JSON.stringify({ ...compact, tempo: 'fast' }));
        expect(loadSessionFromLocalStorage(storage)).toBeNull();
    });
});

// ── clearSessionFromLocalStorage / hasStoredSession ───────────────────────────

describe('clearSessionFromLocalStorage', () => {
    it('removes the stored entry', () => {
        const storage = makeMockStorage();
        saveSessionToLocalStorage(BASE_SONG, storage);
        expect(hasStoredSession(storage)).toBe(true);
        clearSessionFromLocalStorage(storage);
        expect(hasStoredSession(storage)).toBe(false);
    });
});

describe('hasStoredSession', () => {
    it('returns false with an empty storage', () => {
        expect(hasStoredSession(makeMockStorage())).toBe(false);
    });

    it('returns true after a successful save', () => {
        const storage = makeMockStorage();
        saveSessionToLocalStorage(BASE_SONG, storage);
        expect(hasStoredSession(storage)).toBe(true);
    });
});

// ── makeAutoSave ──────────────────────────────────────────────────────────────

describe('makeAutoSave', () => {
    it('does not save immediately — waits for the debounce', async () => {
        const storage = makeMockStorage();
        const { save, cancel } = makeAutoSave(50, storage);
        save(BASE_SONG);
        // Immediately after, nothing should be written yet
        expect(storage.store['hyphon:autosave:v1']).toBeUndefined();
        // Wait for debounce
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(storage.store['hyphon:autosave:v1']).toBeDefined();
        cancel();
    });

    it('debounces — only writes once for rapid calls', async () => {
        const storage = makeMockStorage();
        let writeCount = 0;
        const countStorage: StorageBackend = {
            getItem:    () => null,
            setItem:    (k, v) => { writeCount++; storage.setItem(k, v); },
            removeItem: () => {},
        };
        const { save, cancel } = makeAutoSave(50, countStorage);
        save(BASE_SONG);
        save(BASE_SONG);
        save(BASE_SONG); // only the last should fire
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(writeCount).toBe(1);
        cancel();
    });

    it('cancel() prevents the pending save', async () => {
        const storage = makeMockStorage();
        const { save, cancel } = makeAutoSave(50, storage);
        save(BASE_SONG);
        cancel();
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(storage.store['hyphon:autosave:v1']).toBeUndefined();
    });
});

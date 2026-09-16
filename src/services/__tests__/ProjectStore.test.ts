import { describe, it, expect, beforeEach } from 'vitest';
import {
    ProjectStore,
    contentHash,
    AUTOSAVE_PROJECT_ID,
    type ProjectFileBackend,
} from '@/services/ProjectStore';
import { AUTOSAVE_KEY } from '@/utils/projectPersistence';
import type { SavedSongData } from '@/types';

// ── in-memory backend, mirrors ProjectStore's own MemoryBackend fallback ──────

function makeMemoryBackend(): ProjectFileBackend {
    const files = new Map<string, Uint8Array>();
    return {
        kind: 'memory',
        writeFile(path, data) {
            files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
            return Promise.resolve();
        },
        readFile(path) {
            return Promise.resolve(files.get(path) ?? null);
        },
        readText(path) {
            const bytes = files.get(path);
            return Promise.resolve(bytes ? new TextDecoder().decode(bytes) : null);
        },
        exists(path) {
            return Promise.resolve(files.has(path));
        },
        deleteFile(path) {
            files.delete(path);
            return Promise.resolve();
        },
        listDirs(dirPath) {
            const prefix = `${dirPath}/`;
            const names = new Set<string>();
            for (const key of files.keys()) {
                if (!key.startsWith(prefix)) continue;
                const seg = key.slice(prefix.length).split('/')[0];
                if (seg) names.add(seg);
            }
            return Promise.resolve([...names]);
        },
        deleteDir(dirPath) {
            const prefix = `${dirPath}/`;
            for (const key of [...files.keys()]) {
                if (key === dirPath || key.startsWith(prefix)) files.delete(key);
            }
            return Promise.resolve();
        },
    };
}

const EMPTY_SEQUENCE = { steps: Array(32).fill(null) };
function makeSong(overrides: Partial<SavedSongData> = {}): SavedSongData {
    return {
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
            synthA: { waveform: 'sawtooth', pitch: 0, filterCutoff: 2000, filterResonance: 1, attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3, length: 1, volume: 0.8, delayTime: 0, delayFeedback: 0, delayMix: 0 } as any,
            synthB: { waveform: 'square', pitch: 0, filterCutoff: 2000, filterResonance: 1, attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.3, length: 1, volume: 0.8, delayTime: 0, delayFeedback: 0, delayMix: 0 } as any,
            kick: { pitch: 0, decay: 0.5, tone: 0.5, volume: 0.8 } as any,
            snare: { decay: 0.3, tone: 0.5, noise: 0.5, volume: 0.8 } as any,
            closedHat: { pitch: 0, decay: 0.1, volume: 0.8 } as any,
            openHat: { pitch: 0, decay: 0.4, volume: 0.8 } as any,
            sampler: Array(8).fill({ sampleName: '', playbackSpeed: 1, volume: 1, filterCutoff: 20000, filterResonance: 0, drive: 0, delaySend: 0 }) as any,
        },
        trackStorage: {},
        activeTrackSlots: { partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0 },
        songStructure: [],
        tempo: 120,
        ...overrides,
    };
}

function wavDataUrl(bytes: number[]): string {
    const raw = new Uint8Array(bytes);
    let bin = '';
    for (const b of raw) bin += String.fromCharCode(b);
    return `data:audio/wav;base64,${btoa(bin)}`;
}

describe('contentHash', () => {
    it('is deterministic for identical bytes', () => {
        const a = new Uint8Array([1, 2, 3, 4, 5]);
        const b = new Uint8Array([1, 2, 3, 4, 5]);
        expect(contentHash(a)).toBe(contentHash(b));
    });

    it('differs for different bytes', () => {
        expect(contentHash(new Uint8Array([1, 2, 3]))).not.toBe(contentHash(new Uint8Array([3, 2, 1])));
    });
});

describe('ProjectStore', () => {
    let backend: ProjectFileBackend;
    let store: ProjectStore;

    beforeEach(() => {
        backend = makeMemoryBackend();
        store = new ProjectStore(backend);
        localStorage.clear();
    });

    it('round-trips a project without samples', async () => {
        const song = makeSong({ tempo: 140 });
        const result = await store.saveProject('p1', song);
        expect(result.ok).toBe(true);

        const loaded = await store.loadProject('p1');
        expect(loaded).not.toBeNull();
        expect(loaded!.tempo).toBe(140);
        expect(loaded!.embeddedSamples).toBeUndefined();
    });

    it('round-trips embedded samples byte-for-byte via content-addressed storage', async () => {
        const sampleBytes = [82, 73, 70, 70, 0, 1, 2, 3, 255, 254];
        const song = makeSong({
            embeddedSamples: { 0: wavDataUrl(sampleBytes) },
        });
        await store.saveProject('p2', song);

        const loaded = await store.loadProject('p2');
        expect(loaded!.embeddedSamples).toBeDefined();
        const restoredUrl = loaded!.embeddedSamples![0];
        expect(restoredUrl.startsWith('data:audio/wav;base64,')).toBe(true);

        // decode both to compare raw bytes
        const decode = (url: string) => {
            const b64 = url.split(',')[1];
            const bin = atob(b64);
            return Uint8Array.from(bin, (c) => c.charCodeAt(0));
        };
        expect(Array.from(decode(restoredUrl))).toEqual(sampleBytes);
    });

    it('does not lose samples over 512KB — unlike the legacy localStorage autosave', async () => {
        const bigBytes = Array.from({ length: 600 * 1024 }, (_, i) => i % 256);
        const song = makeSong({ embeddedSamples: { 0: wavDataUrl(bigBytes) } });
        const result = await store.saveProject('big', song);
        expect(result.ok).toBe(true);
        const loaded = await store.loadProject('big');
        expect(loaded!.embeddedSamples![0]).toBeDefined();
    });

    it('dedupes identical sample content across saves (content-addressed)', async () => {
        const sampleBytes = [1, 2, 3, 4, 5, 6, 7, 8];
        const song1 = makeSong({ embeddedSamples: { 0: wavDataUrl(sampleBytes) } });
        await store.saveProject('dedupe', song1);
        const written1 = await backend.listDirs('hyphon-projects/dedupe/samples');
        expect(written1.length).toBe(1);

        // Save again with the same sample content — no new file should appear.
        await store.saveProject('dedupe', song1);
        const written2 = await backend.listDirs('hyphon-projects/dedupe/samples');
        expect(written2.length).toBe(1);
        expect(written2).toEqual(written1);
    });

    it('hasProject / deleteProject', async () => {
        await store.saveProject('del-me', makeSong());
        expect(await store.hasProject('del-me')).toBe(true);
        await store.deleteProject('del-me');
        expect(await store.hasProject('del-me')).toBe(false);
        expect(await store.loadProject('del-me')).toBeNull();
    });

    it('loadProject returns null for a project that was never saved', async () => {
        expect(await store.loadProject('nope')).toBeNull();
    });

    it('listProjects sorts by updatedAt descending', async () => {
        await store.saveProject('older', makeSong());
        await new Promise((r) => setTimeout(r, 5));
        await store.saveProject('newer', makeSong());
        const list = await store.listProjects();
        expect(list.map((p) => p.id)).toEqual(['newer', 'older']);
    });

    describe('clean shutdown tracking', () => {
        it('marks a project dirty on save and clean after markCleanShutdown', async () => {
            await store.saveProject(AUTOSAVE_PROJECT_ID, makeSong());
            expect(await store.wasCleanShutdown(AUTOSAVE_PROJECT_ID)).toBe(false);

            await store.markCleanShutdown(AUTOSAVE_PROJECT_ID);
            expect(await store.wasCleanShutdown(AUTOSAVE_PROJECT_ID)).toBe(true);
        });

        it('returns null when there is no project to recover', async () => {
            expect(await store.wasCleanShutdown('never-saved')).toBeNull();
        });
    });

    describe('migrateLegacyAutosave', () => {
        it('lifts a legacy localStorage payload into the store and clears the key', async () => {
            const legacy = {
                autosaveVersion: 1,
                savedAt: Date.now(),
                samplesStripped: false,
                pattern: makeSong().pattern,
                params: makeSong().params,
                trackStorage: {},
                activeTrackSlots: {},
                songStructure: [],
                tempo: 133,
            };
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(legacy));

            const migrated = await store.migrateLegacyAutosave();
            expect(migrated).toBe(true);
            expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();

            const loaded = await store.loadProject(AUTOSAVE_PROJECT_ID);
            expect(loaded).not.toBeNull();
            expect(loaded!.tempo).toBe(133);
        });

        it('is a no-op (but still clears the key) when a newer autosave already exists', async () => {
            await store.saveProject(AUTOSAVE_PROJECT_ID, makeSong({ tempo: 200 }));

            const legacy = {
                autosaveVersion: 1,
                savedAt: Date.now(),
                samplesStripped: false,
                pattern: makeSong().pattern,
                params: makeSong().params,
                trackStorage: {},
                activeTrackSlots: {},
                songStructure: [],
                tempo: 90,
            };
            localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(legacy));

            await store.migrateLegacyAutosave();
            expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();

            const loaded = await store.loadProject(AUTOSAVE_PROJECT_ID);
            expect(loaded!.tempo).toBe(200); // untouched — the newer save wins
        });

        it('returns false when there is nothing to migrate', async () => {
            expect(await store.migrateLegacyAutosave()).toBe(false);
        });
    });

    describe('backgroundImage', () => {
        it('round-trips a data: URL background image via content addressing', async () => {
            const bytes = [137, 80, 78, 71, 1, 2, 3];
            let bin = '';
            for (const b of bytes) bin += String.fromCharCode(b);
            const dataUrl = `data:image/png;base64,${btoa(bin)}`;
            await store.saveProject('bg', makeSong({ backgroundImage: dataUrl }));
            const loaded = await store.loadProject('bg');
            expect(loaded!.backgroundImage).toBe(dataUrl);
        });

        it('passes through a plain (non-data:) URL unchanged', async () => {
            await store.saveProject('bg2', makeSong({ backgroundImage: 'https://example.com/bg.jpg' }));
            const loaded = await store.loadProject('bg2');
            expect(loaded!.backgroundImage).toBe('https://example.com/bg.jpg');
        });
    });
});

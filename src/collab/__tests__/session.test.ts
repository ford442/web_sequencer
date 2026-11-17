import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { SavedSongData } from '@/types';
import { ProjectStore, type ProjectFileBackend } from '@/services/ProjectStore';
import { decodeUpdateLog } from '../updateLog';
import { applyUpdates, readSongFromDoc } from '../codec';
import { createProjectDoc } from '../doc';
import { projectDocCodec } from '../projectDocCodec';
import { createLocalProvider } from '../providers/local';
import { openCollabSession, type CollabSession, type CollabSessionOptions } from '../session';
import { createChannelHub } from './channelHub';
import { loadSongFixtures } from './songFixtures';

const ID = 'p1';
const LOG = `hyphon-projects/${ID}/doc.ylog`;
const JSON_PATH = `hyphon-projects/${ID}/project.json`;

const song = (await loadSongFixtures()).find((f) => f.name === 'ai-song/full.json')!.song;

function memoryBackend(): ProjectFileBackend & { files: Map<string, Uint8Array>; failNextWrite: (path: string) => void } {
    const files = new Map<string, Uint8Array>();
    const failing = new Set<string>();
    return {
        kind: 'memory',
        files,
        failNextWrite: (path) => failing.add(path),
        writeFile(path, data) {
            if (failing.delete(path)) return Promise.reject(new Error(`disk full: ${path}`));
            files.set(path, typeof data === 'string' ? new TextEncoder().encode(data) : data);
            return Promise.resolve();
        },
        readFile: (path) => Promise.resolve(files.get(path) ?? null),
        readText(path) {
            const bytes = files.get(path);
            return Promise.resolve(bytes ? new TextDecoder().decode(bytes) : null);
        },
        exists: (path) => Promise.resolve(files.has(path)),
        deleteFile(path) {
            files.delete(path);
            return Promise.resolve();
        },
        listDirs: () => Promise.resolve([]),
        deleteDir(dir) {
            for (const key of [...files.keys()]) if (key.startsWith(`${dir}/`)) files.delete(key);
            return Promise.resolve();
        },
    };
}

function logFrames(backend: ReturnType<typeof memoryBackend>): Uint8Array[] {
    const bytes = backend.files.get(LOG);
    if (!bytes) throw new Error('no doc log');
    const decoded = decodeUpdateLog(bytes);
    if (!decoded) throw new Error('unreadable doc log');
    return decoded.frames;
}

function songFromLog(backend: ReturnType<typeof memoryBackend>): SavedSongData {
    const doc = createProjectDoc();
    applyUpdates(doc, logFrames(backend));
    return readSongFromDoc(doc);
}

const sessions: CollabSession[] = [];
async function open(options: CollabSessionOptions): Promise<CollabSession> {
    const session = await openCollabSession({ persistDelayMs: 5, syncTimeoutMs: 10, ...options });
    sessions.push(session);
    return session;
}

afterEach(async () => {
    for (const session of sessions.splice(0)) await session.close();
});

describe('collab session over ProjectStore v2', () => {
    it('seeds the doc from project.json, writes the log, and reopens from the log', async () => {
        const backend = memoryBackend();
        const store = new ProjectStore(backend);
        await store.saveProject(ID, song);
        expect(backend.files.has(LOG)).toBe(false);

        const first = await open({ projectId: ID, store });
        expect(JSON.stringify(first.readSong())).toBe(JSON.stringify(await store.loadProjectSnapshot(ID)));
        expect(logFrames(backend)).toHaveLength(1);
        await first.close();

        // project.json is no longer needed to rebuild the doc.
        backend.files.delete(JSON_PATH);
        const second = await open({ projectId: ID, store });
        expect(second.readSong()).toEqual(first.readSong());
    });

    it('routes saves through the live doc and appends them to the log', async () => {
        const backend = memoryBackend();
        const store = new ProjectStore(backend, { loadDocCodec: () => Promise.reject(new Error('not while live')) });
        await store.saveProject(ID, song);
        const session = await open({ projectId: ID, store });
        const updates: unknown[] = [];
        session.doc.on('update', (_u: Uint8Array, origin: unknown) => updates.push(origin));

        const edited = structuredClone(song);
        edited.tempo = 141;
        edited.pattern.kick.steps[1] = { note: 'C1', velocity: 1 };
        expect(await store.saveProject(ID, edited)).toEqual({ ok: true });

        expect(updates).toEqual(['hyphon:save']);
        expect(logFrames(backend)).toHaveLength(2);
        expect(songFromLog(backend)).toEqual(await store.loadProjectSnapshot(ID));
        expect(session.readSong().tempo).toBe(141);
    });

    it('without a session, a save still keeps an existing log in step', async () => {
        const backend = memoryBackend();
        const store = new ProjectStore(backend);
        await store.saveProject(ID, song);
        await (await open({ projectId: ID, store })).close();

        for (const tempo of [100, 101, 102]) {
            expect(await store.saveProject(ID, { ...song, tempo })).toEqual({ ok: true });
            expect(songFromLog(backend).tempo).toBe(tempo);
        }
        expect(logFrames(backend)).toHaveLength(4);
        // One client id for all of this store's session-less edits, not one per save.
        const doc = createProjectDoc();
        applyUpdates(doc, logFrames(backend));
        expect(Y.decodeStateVector(Y.encodeStateVector(doc)).size).toBe(2);
        // An unchanged save writes nothing.
        await store.saveProject(ID, { ...song, tempo: 102 });
        expect(logFrames(backend)).toHaveLength(4);
    });

    it('starts a fresh client id when the log no longer holds its earlier edits', () => {
        const first = projectDocCodec.nextFrames([], song, null);
        const doc = createProjectDoc();
        applyUpdates(doc, first.frames!);
        expect(Y.decodeStateVector(Y.encodeStateVector(doc)).has(first.clientId)).toBe(true);
        // Continued while its edits are in the log...
        const second = projectDocCodec.nextFrames(first.frames!, { ...song, tempo: 1 }, first.clientId);
        expect(second.clientId).toBe(first.clientId);
        // ...but not into a log that lost them (deleted and recreated).
        const fresh = projectDocCodec.nextFrames([Y.encodeStateAsUpdate(createProjectDoc())], song, first.clientId);
        expect(fresh.clientId).not.toBe(first.clientId);
    });

    it('a project that never had a session never loads the doc codec', async () => {
        const backend = memoryBackend();
        const loadDocCodec = vi.fn(() => Promise.resolve(projectDocCodec));
        const store = new ProjectStore(backend, { loadDocCodec });
        await store.saveProject(ID, song);
        await store.saveProject(ID, { ...song, tempo: 77 });
        expect(loadDocCodec).not.toHaveBeenCalled();
        expect(backend.files.has(LOG)).toBe(false);
    });

    it('compacts the log into one frame', async () => {
        const backend = memoryBackend();
        const store = new ProjectStore(backend);
        await store.saveProject(ID, song);
        await open({ projectId: ID, store, compactAfterAppends: 3 });
        for (const tempo of [90, 91, 92]) await store.saveProject(ID, { ...song, tempo });
        expect(logFrames(backend)).toHaveLength(1);
        expect(songFromLog(backend).tempo).toBe(92);
    });

    it('keeps edits queued when an append fails, and lands them on the next flush', async () => {
        const backend = memoryBackend();
        const store = new ProjectStore(backend);
        await store.saveProject(ID, song);
        await open({ projectId: ID, store });
        backend.failNextWrite(LOG);
        const failed = await store.saveProject(ID, { ...song, tempo: 133 });
        expect(failed.ok).toBe(false);
        expect(failed.error).toMatch(/Project doc log: disk full/);
        expect(await store.saveProject(ID, { ...song, tempo: 134 })).toEqual({ ok: true });
        expect(songFromLog(backend).tempo).toBe(134);
        expect(logFrames(backend)).toHaveLength(2);
    });

    it('allows one live doc per project', async () => {
        const store = new ProjectStore(memoryBackend());
        await open({ projectId: ID, store });
        await expect(openCollabSession({ projectId: ID, store })).rejects.toThrow(/already has a live doc/);
    });

    it('two tabs: an autosave in one reaches the other tab’s doc', async () => {
        const backend = memoryBackend();
        const hub = createChannelHub();
        const tabA = new ProjectStore(backend);
        const tabB = new ProjectStore(backend);
        await tabA.saveProject(ID, song);
        const connect = (doc: Y.Doc) => createLocalProvider(doc, { room: ID, createChannel: hub.createChannel });
        const a = await open({ projectId: ID, store: tabA, connect });
        const b = await open({ projectId: ID, store: tabB, connect });
        await hub.settle();
        expect(b.provider?.peers()).toEqual([a.doc.clientID]);

        await tabA.saveProject(ID, { ...song, tempo: 150 });
        await hub.settle();
        expect(b.readSong().tempo).toBe(150);

        // The tab that made the edit is the one that appended it.
        await b.close();
        await a.close();
        expect(songFromLog(backend).tempo).toBe(150);
    });
});

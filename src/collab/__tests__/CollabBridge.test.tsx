import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AUTOSAVE_PROJECT_ID, projectStore } from '@/services/ProjectStore';
import CollabBridge from '../CollabBridge';
import { collabModeFromSearch } from '../collabQuery';
import { openCollabSession } from '../session';
import { writeSongToDoc } from '../codec';
import { stopLiveProject } from '../liveProjectRuntime';
import { transportMixStore } from '@/stores/transportMixStore';

// The unit setup's IndexedDB stub never answers; give the app's store memory.
vi.mock('@/services/ProjectStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/ProjectStore')>();
    const files = new Map<string, Uint8Array>();
    const encode = (data: Uint8Array | string) => (typeof data === 'string' ? new TextEncoder().encode(data) : data);
    const backend = {
        kind: 'memory' as const,
        writeFile: (path: string, data: Uint8Array | string) => Promise.resolve(void files.set(path, encode(data))),
        readFile: (path: string) => Promise.resolve(files.get(path) ?? null),
        readText: (path: string) => Promise.resolve(files.has(path) ? new TextDecoder().decode(files.get(path)) : null),
        exists: (path: string) => Promise.resolve(files.has(path)),
        deleteFile: (path: string) => Promise.resolve(void files.delete(path)),
        listDirs: () => Promise.resolve([]),
        deleteDir: () => Promise.resolve(),
    };
    return { ...actual, projectStore: new actual.ProjectStore(backend) };
});

afterEach(async () => {
    cleanup();
    // Let the deferred release close the session before the next test.
    await new Promise((resolve) => setTimeout(resolve, 10));
    stopLiveProject();
    transportMixStore.reset();
});

describe('?collab flag', () => {
    it('is local only for collab=local', () => {
        expect(collabModeFromSearch('?collab=local')).toBe('local');
        expect(collabModeFromSearch('?e2e=1&collab=local')).toBe('local');
        expect(collabModeFromSearch('')).toBeNull();
        expect(collabModeFromSearch('?collab')).toBeNull();
        expect(collabModeFromSearch('?collab=webrtc')).toBeNull();
    });
});

describe('CollabBridge', () => {
    it('opens one session under StrictMode, makes its doc the project doc, and releases it on unmount', async () => {
        const warn = vi.spyOn(console, 'warn');
        const view = render(
            <StrictMode>
                <CollabBridge mode="local" />
            </StrictMode>,
        );
        await vi.waitFor(() => expect(window.__HYPHON_COLLAB__).toBeDefined());
        const handle = window.__HYPHON_COLLAB__!;
        expect(handle).toMatchObject({ mode: 'local', projectId: AUTOSAVE_PROJECT_ID, room: `project:${AUTOSAVE_PROJECT_ID}` });
        expect(handle.peers()).toEqual([]);
        // The project had no doc yet: the session's doc is filled from the stores.
        await vi.waitFor(() => expect(handle.readSong()).toMatchObject({ tempo: 120 }));
        expect(handle.readSong()).toHaveProperty('pattern');

        // A store edit is a doc edit (what peers and the update log receive)…
        transportMixStore.setTempo(133);
        expect(handle.readSong().tempo).toBe(133);
        // …and this tab's to undo.
        expect(handle.history().map((e) => e.label)).toEqual(['Tempo 120 → 133']);
        expect(handle.undo()).toBe(true);
        expect(transportMixStore.getSnapshot().tempo).toBe(120);
        expect(handle.redo()).toBe(true);
        expect(transportMixStore.getSnapshot().tempo).toBe(133);

        // A save goes through the session's doc and reaches the stores.
        await projectStore.saveProject(AUTOSAVE_PROJECT_ID, { ...handle.readSong(), tempo: 128 });
        expect(transportMixStore.getSnapshot().tempo).toBe(128);
        expect(warn).not.toHaveBeenCalled();

        view.unmount();
        expect(window.__HYPHON_COLLAB__).toBeUndefined();
        // Released: the project takes a new live doc, and the edits made through
        // the bridge's session are on disk.
        await vi.waitFor(async () => {
            const reopened = await openCollabSession({ projectId: AUTOSAVE_PROJECT_ID, store: projectStore });
            expect(reopened.readSong()).toMatchObject({ tempo: 128 });
            await reopened.close();
        });
        warn.mockRestore();
    });

    it('shows the song already in the project doc', async () => {
        const seeded = await openCollabSession({ projectId: AUTOSAVE_PROJECT_ID, store: projectStore });
        writeSongToDoc(seeded.doc, { ...seeded.readSong(), tempo: 99 });
        await seeded.close();

        render(<CollabBridge mode="local" />);
        await vi.waitFor(() => expect(transportMixStore.getSnapshot().tempo).toBe(99));
    });
});

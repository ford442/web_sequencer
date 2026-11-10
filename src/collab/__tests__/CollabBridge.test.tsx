import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AUTOSAVE_PROJECT_ID, projectStore } from '@/services/ProjectStore';
import CollabBridge from '../CollabBridge';
import { collabModeFromSearch } from '../collabQuery';
import { openCollabSession } from '../session';

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

afterEach(() => {
    cleanup();
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
    it('opens one session under StrictMode, exposes it, and releases it on unmount', async () => {
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
        expect(handle.readSong()).toEqual({});
        expect(warn).not.toHaveBeenCalled();

        // Saves now go through the session's doc.
        await projectStore.saveProject(AUTOSAVE_PROJECT_ID, { tempo: 128 } as never);
        expect(handle.readSong()).toEqual({ tempo: 128 });

        view.unmount();
        expect(window.__HYPHON_COLLAB__).toBeUndefined();
        // Released: the project takes a new live doc, and the edit made through
        // the bridge's session is on disk.
        await vi.waitFor(async () => {
            const reopened = await openCollabSession({ projectId: AUTOSAVE_PROJECT_ID, store: projectStore });
            expect(reopened.readSong()).toEqual({ tempo: 128 });
            await reopened.close();
        });
        warn.mockRestore();
    });
});

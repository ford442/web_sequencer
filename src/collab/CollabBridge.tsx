/**
 * Starts the project runtime (#1597 P2) and, with `?collab=local`, the collab
 * session behind it (#1597 P1). Mounted lazily by App.tsx on every page load,
 * so Yjs stays out of the entry chunk. Renders nothing.
 *
 * Always: the stores are bound to a private project doc, undo goes through it,
 * and a pointer down or key press starts a new undo step (one gesture, one
 * step).
 *
 * With a collab mode: the session's doc (rebuilt from the project's update log
 * and kept in sync with the room) becomes the project doc, so this tab shows
 * the room's song and every edit here reaches the other tabs. The session is
 * exposed as `window.__HYPHON_COLLAB__` for inspection and the e2e suite.
 */

import { useEffect } from 'react';
import type { SavedSongData } from '@/types';
import { AUTOSAVE_PROJECT_ID, projectStore } from '@/services/ProjectStore';
import type { CollabMode } from './collabQuery';
import type { HistoryEntry } from './history';
import { liveProject } from './liveProject';
import { startLiveProject } from './liveProjectRuntime';
import { createLocalProvider } from './providers/local';
import { openCollabSession, type CollabSession } from './session';

export interface CollabDebugHandle {
    mode: CollabMode;
    projectId: string;
    room: string | null;
    /** Doc client id of this tab. */
    clientId: number;
    peers(): number[];
    synced(): boolean;
    readSong(): SavedSongData;
    flush(): Promise<void>;
    /** This tab's undo history (both editors), oldest first. */
    history(): readonly HistoryEntry[];
    undo(): boolean;
    redo(): boolean;
}

declare global {
    interface Window {
        __HYPHON_COLLAB__?: CollabDebugHandle;
    }
}

interface SharedSession {
    promise: Promise<CollabSession>;
    users: number;
    /** Gives the project doc back to a private one; set once the runtime adopted the session's. */
    releaseDoc: (() => void) | null;
}

// One session per page, shared across mounts: StrictMode's mount → unmount →
// mount must not open (and attach) a second session while the first is live.
let shared: SharedSession | null = null;

function acquire(mode: CollabMode): SharedSession {
    if (!shared) {
        const projectId = AUTOSAVE_PROJECT_ID;
        const entry: SharedSession = {
            users: 0,
            releaseDoc: null,
            promise: openCollabSession({
                projectId,
                store: projectStore,
                connect: mode === 'local' ? (doc) => createLocalProvider(doc, { room: `project:${projectId}` }) : undefined,
            }),
        };
        entry.promise.then(
            (session) => {
                if (shared === entry) entry.releaseDoc = startLiveProject().adopt(session.doc);
            },
            () => undefined,
        );
        shared = entry;
    }
    shared.users++;
    return shared;
}

function release(entry: SharedSession): void {
    entry.users--;
    // Deferred, so an immediate remount picks the same session back up.
    setTimeout(() => {
        if (entry.users > 0 || shared !== entry) return;
        shared = null;
        void entry.promise
            .then((session) => {
                // The runtime must leave the doc before the session destroys it.
                entry.releaseDoc?.();
                entry.releaseDoc = null;
                return session.close();
            })
            .catch((err: unknown) => {
                console.warn('[collab] session did not close cleanly', err);
            });
    }, 0);
}

function debugHandle(mode: CollabMode, session: CollabSession): CollabDebugHandle {
    return {
        mode,
        projectId: session.projectId,
        room: session.provider?.room ?? null,
        clientId: session.doc.clientID,
        peers: () => session.provider?.peers() ?? [],
        synced: () => session.provider?.synced ?? false,
        readSong: () => session.readSong(),
        flush: () => session.flush(),
        history: () => liveProject.getSnapshot().entries,
        undo: () => liveProject.undo(),
        redo: () => liveProject.redo(),
    };
}

/** A new pointer gesture or key press is a new undo step (key repeat is not). */
function useGestureBoundaries(): void {
    useEffect(() => {
        const onPointerDown = () => liveProject.beginGesture();
        const onKeyDown = (event: KeyboardEvent) => {
            if (!event.repeat) liveProject.beginGesture();
        };
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKeyDown, true);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('keydown', onKeyDown, true);
        };
    }, []);
}

export default function CollabBridge({ mode }: { mode: CollabMode | null }): null {
    useEffect(() => {
        startLiveProject();
    }, []);
    useGestureBoundaries();

    useEffect(() => {
        if (!mode) return;
        let active = true;
        let handle: CollabDebugHandle | null = null;
        const entry = acquire(mode);
        entry.promise.then(
            (session) => {
                if (!active) return;
                handle = debugHandle(mode, session);
                window.__HYPHON_COLLAB__ = handle;
            },
            (err: unknown) => console.warn('[collab] could not open the session', err),
        );
        return () => {
            active = false;
            if (handle && window.__HYPHON_COLLAB__ === handle) delete window.__HYPHON_COLLAB__;
            release(entry);
        };
    }, [mode]);
    return null;
}

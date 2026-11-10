/**
 * Opens the collab session behind `?collab=local` (#1597 P1) and exposes it as
 * `window.__HYPHON_COLLAB__` for inspection and the e2e suite. Mounted lazily
 * by App.tsx only with the flag, so Yjs and the provider are fetched only then.
 * Renders nothing; in P1 the session changes nothing visible.
 */

import { useEffect } from 'react';
import type { SavedSongData } from '@/types';
import { AUTOSAVE_PROJECT_ID, projectStore } from '@/services/ProjectStore';
import type { CollabMode } from './collabQuery';
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
}

declare global {
    interface Window {
        __HYPHON_COLLAB__?: CollabDebugHandle;
    }
}

interface SharedSession {
    promise: Promise<CollabSession>;
    users: number;
}

// One session per page, shared across mounts: StrictMode's mount → unmount →
// mount must not open (and attach) a second session while the first is live.
let shared: SharedSession | null = null;

function acquire(mode: CollabMode): Promise<CollabSession> {
    if (!shared) {
        const projectId = AUTOSAVE_PROJECT_ID;
        shared = {
            users: 0,
            promise: openCollabSession({
                projectId,
                store: projectStore,
                connect: mode === 'local' ? (doc) => createLocalProvider(doc, { room: `project:${projectId}` }) : undefined,
            }),
        };
    }
    shared.users++;
    return shared.promise;
}

function release(entry: SharedSession): void {
    entry.users--;
    // Deferred, so an immediate remount picks the same session back up.
    setTimeout(() => {
        if (entry.users > 0 || shared !== entry) return;
        shared = null;
        void entry.promise.then((session) => session.close()).catch((err: unknown) => {
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
    };
}

export default function CollabBridge({ mode }: { mode: CollabMode }): null {
    useEffect(() => {
        let active = true;
        let handle: CollabDebugHandle | null = null;
        const promise = acquire(mode);
        const entry = shared;
        promise.then(
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
            if (entry) release(entry);
        };
    }, [mode]);
    return null;
}

/**
 * A collab session on one project (#1597 P1): the project's live doc, kept on
 * disk through ProjectStore's update log and, when a provider is given, in
 * sync with the other docs in the room.
 *
 * Opening one:
 *   1. rebuilds the doc from the project's log, or seeds it from project.json
 *      and writes the log (from then on the project "has a doc");
 *   2. routes the project's saves through the doc (`attachLiveDoc`), so a save
 *      becomes a minimal doc transaction that peers receive as an edit;
 *   3. appends each batch of this tab's edits to the log. Edits that arrive
 *      from peers are not appended here — the tab that made them does that —
 *      but every compaction writes the whole merged doc, so they land anyway.
 *
 * In P1 nothing reads the doc back into the app's stores (that is P2's store
 * bridges), so the session changes nothing anyone can see.
 */

import * as Y from 'yjs';
import type { SavedSongData } from '@/types';
import type { ProjectStore } from '@/services/ProjectStore';
import type { CollabProvider } from './providers/types';
import { DOC_ORIGINS, createProjectDoc } from './doc';
import { applyUpdates, readSongFromDoc, writeSongToDoc } from './codec';

/** The ProjectStore surface a session uses. */
export type SessionProjectStore = Pick<
    ProjectStore,
    'attachLiveDoc' | 'appendDocUpdate' | 'updateDocLog' | 'loadProjectSnapshot'
>;

export interface CollabSessionOptions {
    projectId: string;
    store: SessionProjectStore;
    /** Joins a room with the doc. Omitted: a session with persistence only. */
    connect?: (doc: Y.Doc) => CollabProvider;
    /** Edits are batched for this long before an append. */
    persistDelayMs?: number;
    /** How long to wait for a peer before the first compaction. */
    syncTimeoutMs?: number;
    /** Appends between compactions. */
    compactAfterAppends?: number;
}

export interface CollabSession {
    readonly projectId: string;
    readonly doc: Y.Doc;
    readonly provider: CollabProvider | null;
    /** The song the doc holds now. */
    readSong(): SavedSongData;
    /** Append the edits not yet on disk; rejects when the write fails (they stay queued). */
    flush(): Promise<void>;
    /** Flush, leave the room and release the project's saves. */
    close(): Promise<void>;
}

const DEFAULT_PERSIST_DELAY_MS = 250;
const DEFAULT_SYNC_TIMEOUT_MS = 500;
const DEFAULT_COMPACT_AFTER_APPENDS = 64;

export async function openCollabSession(options: CollabSessionOptions): Promise<CollabSession> {
    const { projectId, store } = options;
    const persistDelayMs = options.persistDelayMs ?? DEFAULT_PERSIST_DELAY_MS;
    const compactAfterAppends = options.compactAfterAppends ?? DEFAULT_COMPACT_AFTER_APPENDS;
    const doc = createProjectDoc();

    await store.updateDocLog(projectId, async (frames) => {
        if (frames && frames.length > 0) {
            applyUpdates(doc, frames, DOC_ORIGINS.log);
            return null;
        }
        const seed = await store.loadProjectSnapshot(projectId);
        if (seed) writeSongToDoc(doc, seed, DOC_ORIGINS.seed);
        return [Y.encodeStateAsUpdate(doc)];
    });

    let provider: CollabProvider | null = null;
    let pending: Uint8Array[] = [];
    let appendsSinceCompaction = 0;
    let chain: Promise<void> = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    /** Rewrite the log as the whole doc, after merging in whatever it holds that we lack. */
    const compact = () =>
        store.updateDocLog(projectId, (frames) => {
            if (frames) applyUpdates(doc, frames, DOC_ORIGINS.log);
            // The full state includes every queued edit.
            pending = [];
            appendsSinceCompaction = 0;
            return [Y.encodeStateAsUpdate(doc)];
        });

    const flushPending = async () => {
        if (pending.length === 0) return;
        const batch = pending;
        pending = [];
        try {
            await store.appendDocUpdate(projectId, Y.mergeUpdates(batch));
        } catch (err) {
            pending = [...batch, ...pending];
            throw err;
        }
        appendsSinceCompaction++;
        if (appendsSinceCompaction >= compactAfterAppends) await compact();
    };

    /** Runs `task` after every persistence task queued before it. */
    const enqueue = (task: () => Promise<void>): Promise<void> => {
        const run = chain.then(task);
        chain = run.catch(() => undefined);
        return run;
    };

    const flush = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
        return enqueue(flushPending);
    };

    const onUpdate = (update: Uint8Array, origin: unknown) => {
        if (origin === DOC_ORIGINS.log || (provider !== null && origin === provider)) return;
        pending.push(update);
        if (timer === null && !closed) {
            timer = setTimeout(() => {
                flush().catch((err: unknown) => console.warn('[collab] could not persist edits', err));
            }, persistDelayMs);
        }
    };
    // Throws when the project already has a live doc; nothing is open yet then.
    const detach = store.attachLiveDoc(projectId, {
        writeSavedSong: (song) => {
            writeSongToDoc(doc, song, DOC_ORIGINS.save);
            return flush();
        },
    });
    doc.on('update', onUpdate);
    try {
        provider = options.connect?.(doc) ?? null;
    } catch (err) {
        detach();
        doc.off('update', onUpdate);
        doc.destroy();
        throw err;
    }

    if (provider) {
        // Once peers have had their say, put the merged doc on disk.
        void provider.whenSynced(options.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS).then(() => {
            if (closed) return;
            enqueue(compact).catch((err: unknown) => console.warn('[collab] could not compact the doc log', err));
        });
    }

    return {
        projectId,
        doc,
        provider,
        readSong: () => readSongFromDoc(doc),
        flush,
        async close() {
            if (closed) return;
            closed = true;
            detach();
            try {
                await flush();
            } finally {
                doc.off('update', onUpdate);
                provider?.destroy();
                doc.destroy();
            }
        },
    };
}

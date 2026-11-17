/**
 * ProjectStore's doc-log codec for saves made with no collab session open
 * (#1597 P1). Loaded on demand by `ProjectStore` (see `loadDefaultDocCodec`),
 * so only projects that have a doc log ever pull in Yjs.
 */

import * as Y from 'yjs';
import type { ProjectDocCodec } from '@/services/ProjectStore';
import { DOC_ORIGINS, createProjectDoc } from './doc';
import { applyUpdates, writeSongToDoc } from './codec';

/** A log longer than this is rewritten as one frame holding the whole doc. */
export const COMPACT_AFTER_FRAMES = 64;

export const projectDocCodec: ProjectDocCodec = {
    nextFrames(frames, song, clientId) {
        const doc = createProjectDoc();
        try {
            applyUpdates(doc, frames, DOC_ORIGINS.log);
            // Continue an id only where its earlier edits are in the log (so the
            // clock carries on from them), and only after the frames are in: a
            // doc that sees its own id arrive in a remote update picks a new one.
            if (clientId !== null && Y.decodeStateVector(Y.encodeStateVector(doc)).has(clientId)) {
                doc.clientID = clientId;
            }
            const updates: Uint8Array[] = [];
            doc.on('update', (update: Uint8Array) => updates.push(update));
            writeSongToDoc(doc, song, DOC_ORIGINS.save);
            if (updates.length === 0) return { frames: null, clientId: doc.clientID };
            const next = frames.length + 1 > COMPACT_AFTER_FRAMES
                ? [Y.encodeStateAsUpdate(doc)]
                : [...frames, Y.mergeUpdates(updates)];
            return { frames: next, clientId: doc.clientID };
        } finally {
            doc.destroy();
        }
    },
};

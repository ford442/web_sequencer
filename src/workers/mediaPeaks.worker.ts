/// <reference lib="webworker" />
/**
 * Waveform peaks worker (#1629 D5). Builds the peaks of stored media from the
 * media store (it opens the same OPFS / IndexedDB files as the page), writes
 * them next to the media, and posts them back, so the page never holds the
 * audio to draw it. Builds run one at a time: each holds a page of audio.
 *
 * Loaded via `?worker&url` from src/audio/media/peakCache.ts.
 */
import { MediaStore } from '@/audio/media/MediaStore';
import { encodePeakFile } from '@/audio/media/peaks';
import type { PeaksWorkerRequest, PeaksWorkerResponse } from '@/audio/media/peakCache';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const store = new MediaStore();
let queue: Promise<void> = Promise.resolve();

function post(message: PeaksWorkerResponse, transfer: Transferable[] = []): void {
    scope.postMessage(message, transfer);
}

async function build(id: string): Promise<void> {
    try {
        const pyramid = await store.buildPeaks(id);
        if (!pyramid) {
            post({ type: 'missing', id });
            return;
        }
        // Peaks that could not be stored (quota) are still drawn; the next load rebuilds them.
        await store.writePeaks(id, pyramid).catch((error: unknown) => {
            console.warn('[peaks worker] could not store peaks:', error);
        });
        const bytes = encodePeakFile(pyramid);
        post({ type: 'peaks', id, bytes }, [bytes.buffer]);
    } catch (error) {
        post({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
    }
}

scope.onmessage = (event: MessageEvent<PeaksWorkerRequest>) => {
    const message = event.data;
    if (message?.type !== 'build' || typeof message.id !== 'string') return;
    queue = queue.then(() => build(message.id));
};

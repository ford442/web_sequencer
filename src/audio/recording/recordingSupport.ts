/**
 * Whether this browser can record a take (#1498 P1), checked without opening
 * anything or loading the recorder: the picker and the sampler ask this from
 * the entry chunk, and the recorder (`takeRecorder.ts`) loads on first use.
 */

import { TAKES_DIR } from './takeProtocol';

export class RecordingUnsupportedError extends Error {
    constructor(reason: string) {
        super(`Recording is not supported here: ${reason}`);
        this.name = 'RecordingUnsupportedError';
    }
}

export type RecordingSupport = { ok: true } | { ok: false; reason: string };

/** What this browser lacks for recording, checked without opening anything. */
export function recordingSupport(): RecordingSupport {
    if (typeof window !== 'undefined' && window.isSecureContext === false) return { ok: false, reason: 'the page is not a secure context' };
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return { ok: false, reason: 'no microphone access (getUserMedia)' };
    if (typeof AudioWorkletNode === 'undefined') return { ok: false, reason: 'no AudioWorklet' };
    if (typeof Worker === 'undefined') return { ok: false, reason: 'no Web Workers' };
    const storage = navigator.storage as (StorageManager & { getDirectory?: unknown }) | undefined;
    if (typeof storage?.getDirectory !== 'function') return { ok: false, reason: 'no origin private file system (OPFS)' };
    return { ok: true };
}

/**
 * True when this origin has a `takes/` folder in OPFS, i.e. something was
 * recorded here once; without it there is nothing to recover and the
 * recorder never loads.
 */
export async function hasTakesFolder(): Promise<boolean> {
    try {
        const storage = navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
        if (typeof storage?.getDirectory !== 'function') return false;
        await (await storage.getDirectory()).getDirectoryHandle(TAKES_DIR);
        return true;
    } catch {
        return false;
    }
}

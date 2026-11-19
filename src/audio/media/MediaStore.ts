/**
 * The media store (#1629 D2): decoded audio, content-addressed, shared by
 * every project of the origin.
 *
 *   media/<sha256>.f32   one file per piece of audio (`mediaFile.ts`)
 *
 * The id is the SHA-256 of the file's bytes, so the same audio imported twice,
 * or into two songs, is stored once, and a song names its media by hash only
 * (`AudioClip.mediaId`, `SavedSongData.media`). It sits on the same OPFS /
 * IndexedDB / memory backends as the ProjectStore (`projectFileBackends.ts`),
 * under its own root, so deleting a project never deletes audio another
 * project uses.
 *
 * Playback pages audio through `readFrames`: one channel's frames are one
 * contiguous range of the file, read without loading the rest of it.
 *
 *   media/<sha256>.peaks   its waveform peaks (`peaks.ts`), derived from the
 *                          audio, so a missing or outdated one is rebuilt
 */

import { detectBackend, type ProjectFileBackend } from '@/services/projectFileBackends';
import {
    MEDIA_HEADER_PROBE_BYTES,
    bytesToFloat32,
    channelByteRange,
    encodeMediaFile,
    parseMediaHeader,
    type MediaHeader,
} from './mediaFile';
import { MEDIA_ID_PATTERN } from '@/constants/song';
import { PeakBuilder, encodePeakFile, parsePeakFile, type PeakPyramid } from './peaks';

export const MEDIA_ROOT = 'media';

export interface MediaInfo {
    id: string;
    sampleRate: number;
    channels: number;
    frames: number;
}

export interface PutMediaResult extends MediaInfo {
    /** False when the store already held this audio (nothing was written). */
    created: boolean;
}

/** Lower-case hex SHA-256 of `bytes` (Web Crypto: main thread, workers and Node). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function mediaPath(id: string): string {
    return `${MEDIA_ROOT}/${id}.f32`;
}

export function peaksPath(id: string): string {
    return `${MEDIA_ROOT}/${id}.peaks`;
}

/** Frames per channel `buildPeaks` reads at a time (1 MiB of float32). */
const PEAK_PAGE_FRAMES = 1 << 18;

export class MediaStore {
    private backendPromise: Promise<ProjectFileBackend> | null = null;
    private readonly backendOverride?: ProjectFileBackend;
    private readonly headers = new Map<string, MediaHeader>();

    /** Pass a backend to bypass auto-detection (tests, a forced fallback). */
    constructor(backendOverride?: ProjectFileBackend) {
        this.backendOverride = backendOverride;
    }

    private backend(): Promise<ProjectFileBackend> {
        if (this.backendOverride) return Promise.resolve(this.backendOverride);
        this.backendPromise ??= detectBackend();
        return this.backendPromise;
    }

    private async range(id: string, start: number, end: number): Promise<Uint8Array | null> {
        const backend = await this.backend();
        const path = mediaPath(id);
        if (backend.readRange) return backend.readRange(path, start, end);
        const whole = await backend.readFile(path);
        return whole ? whole.slice(start, end) : null;
    }

    /**
     * Store planar audio. Returns its id; when the store already holds the
     * same audio nothing is written (`created: false`).
     */
    async put(planar: readonly Float32Array[], sampleRate: number): Promise<PutMediaResult> {
        const bytes = encodeMediaFile(planar, sampleRate);
        const id = await sha256Hex(bytes);
        const header = parseMediaHeader(bytes.subarray(0, MEDIA_HEADER_PROBE_BYTES));
        if (!header) throw new Error('Media file failed to round-trip its own header');
        const created = !(await this.header(id));
        if (created) {
            await (await this.backend()).writeFile(mediaPath(id), bytes);
            this.headers.set(id, header);
        }
        return { id, sampleRate, channels: header.channels, frames: header.frames, created };
    }

    private async header(id: string): Promise<MediaHeader | null> {
        if (!MEDIA_ID_PATTERN.test(id)) return null;
        const cached = this.headers.get(id);
        if (cached) return cached;
        const probe = await this.range(id, 0, MEDIA_HEADER_PROBE_BYTES);
        const header = probe ? parseMediaHeader(probe) : null;
        if (header) this.headers.set(id, header);
        return header;
    }

    /** The stored format of `id`, or null when the store does not hold it. */
    async info(id: string): Promise<MediaInfo | null> {
        const header = await this.header(id);
        return header ? { id, sampleRate: header.sampleRate, channels: header.channels, frames: header.frames } : null;
    }

    async has(id: string): Promise<boolean> {
        return (await this.header(id)) !== null;
    }

    /**
     * Frames `[from, from + count)`, one array per channel, clamped to the
     * media's length (so the arrays may be shorter than `count`, or empty).
     * Null when the store does not hold `id`.
     */
    async readFrames(id: string, from: number, count: number): Promise<Float32Array[] | null> {
        const header = await this.header(id);
        if (!header) return null;
        const start = Math.max(0, Math.min(header.frames, Math.floor(from)));
        const n = Math.max(0, Math.min(header.frames - start, Math.floor(count)));
        const out: Float32Array[] = [];
        for (let c = 0; c < header.channels; c++) {
            if (n === 0) {
                out.push(new Float32Array(0));
                continue;
            }
            const [a, b] = channelByteRange(header, c, start, n);
            const bytes = await this.range(id, a, b);
            if (!bytes) return null;
            out.push(bytesToFloat32(bytes));
        }
        return out;
    }

    /** Which backend the store sits on (a worker only sees the same files on a persistent one). */
    async backendKind(): Promise<ProjectFileBackend['kind']> {
        return (await this.backend()).kind;
    }

    /** The stored peaks of `id`; null when there are none this build reads (missing, corrupt, older format). */
    async readPeaks(id: string): Promise<PeakPyramid | null> {
        if (!MEDIA_ID_PATTERN.test(id)) return null;
        const bytes = await (await this.backend()).readFile(peaksPath(id));
        return bytes ? parsePeakFile(bytes) : null;
    }

    async writePeaks(id: string, pyramid: PeakPyramid): Promise<void> {
        if (!MEDIA_ID_PATTERN.test(id)) throw new Error(`Bad media id ${id}`);
        await (await this.backend()).writeFile(peaksPath(id), encodePeakFile(pyramid));
    }

    /**
     * Build the peaks of `id` from its stored audio, a page at a time, so the
     * file is never in memory whole — except on IndexedDB, which keeps a file
     * as one record and is read once. Null when the store does not hold `id`
     * (or it shrank while being read). Does not write the result.
     */
    async buildPeaks(id: string, pageFrames = PEAK_PAGE_FRAMES): Promise<PeakPyramid | null> {
        const header = await this.header(id);
        if (!header) return null;
        const backend = await this.backend();
        const whole = backend.kind === 'idb' || !backend.readRange ? await backend.readFile(mediaPath(id)) : null;
        const builder = new PeakBuilder(header.channels, header.frames);
        const page = Math.max(1 << 8, Math.floor(pageFrames));
        for (let from = 0; from < header.frames; from += page) {
            const n = Math.min(page, header.frames - from);
            const frames = whole
                ? Array.from({ length: header.channels }, (_, c) => {
                    const [a, b] = channelByteRange(header, c, from, n);
                    return bytesToFloat32(whole.subarray(a, b));
                })
                : await this.readFrames(id, from, n);
            if (!frames || frames.some((ch) => ch.length !== n)) return null;
            builder.push(frames);
        }
        return builder.finish();
    }

    /** Delete one piece of media and its peaks. The caller makes sure no song references it. */
    async remove(id: string): Promise<void> {
        if (!MEDIA_ID_PATTERN.test(id)) return;
        this.headers.delete(id);
        const backend = await this.backend();
        await backend.deleteFile(mediaPath(id));
        await backend.deleteFile(peaksPath(id));
    }
}

export const mediaStore = new MediaStore();

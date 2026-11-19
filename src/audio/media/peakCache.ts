/**
 * The waveform peaks the timeline draws (#1629 D5), by media id.
 *
 * `request(ids)` makes peaks available without blocking: the stored peaks
 * file when there is a current one, else a build from the stored audio in a
 * worker (`mediaPeaks.worker.ts`), which also writes the file for next time.
 * The page never reads the audio itself to draw it. The import primes the
 * cache with the peaks it built from the audio it had just decoded
 * (`prime`), so a fresh clip draws at once.
 *
 * Without a worker (tests, a worker that failed to start, a store on the
 * in-memory backend, which a worker cannot see) the build runs here, a page
 * of audio at a time.
 *
 * Listeners hear about every change, so a painter can redraw when a clip's
 * peaks arrive. At most `capacity` pyramids are held; the least recently used
 * one goes first and is reloaded from its file when it is drawn again.
 */

import peaksWorkerUrl from '@/workers/mediaPeaks.worker.ts?worker&url';
import { mediaStore, type MediaStore } from './MediaStore';
import { parsePeakFile, type PeakPyramid } from './peaks';

export interface PeaksWorkerRequest {
    type: 'build';
    id: string;
}

export type PeaksWorkerResponse =
    | { type: 'peaks'; id: string; bytes: Uint8Array }
    | { type: 'missing'; id: string }
    | { type: 'error'; id: string; message: string };

type PeaksWorker = Pick<Worker, 'postMessage' | 'addEventListener' | 'terminate'>;

export interface PeakCacheOptions {
    store?: MediaStore;
    /**
     * Starts the build worker. Null = always build on this thread. Default:
     * the peaks worker, when there is a Worker API and the store is persistent.
     */
    createWorker?: (() => PeaksWorker) | null;
    /** Pyramids held at once (default 64). */
    capacity?: number;
}

const DEFAULT_CAPACITY = 64;

export class PeakCache {
    private readonly store: MediaStore;
    private readonly capacity: number;
    private readonly createWorker: (() => PeaksWorker) | null | undefined;
    /** Insertion order is recency: the first key is the least recently used. */
    private readonly entries = new Map<string, PeakPyramid>();
    /** Ids the store does not hold; not asked for again until `prime` or `retry`. */
    private readonly missing = new Set<string>();
    private readonly inflight = new Map<string, Promise<PeakPyramid | null>>();
    private readonly listeners = new Set<() => void>();
    private workerPromise: Promise<PeaksWorker | null> | null = null;
    /** Jobs the worker holds: resolved with its peaks, or undefined to build here instead. */
    private readonly jobs = new Map<string, (result: PeakPyramid | undefined) => void>();
    /** Bumped on every change (a painter compares it to know it must redraw). */
    version = 0;

    constructor(options: PeakCacheOptions = {}) {
        this.store = options.store ?? mediaStore;
        this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
        this.createWorker = options.createWorker;
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notify(): void {
        this.version++;
        for (const listener of [...this.listeners]) listener();
    }

    /** The peaks of `id` if they are here now. */
    get(id: string): PeakPyramid | null {
        const hit = this.entries.get(id);
        if (!hit) return null;
        this.entries.delete(id);
        this.entries.set(id, hit);
        return hit;
    }

    /** True when the store was found not to hold `id`. */
    isMissing(id: string): boolean {
        return this.missing.has(id);
    }

    private put(id: string, pyramid: PeakPyramid): void {
        this.missing.delete(id);
        this.entries.delete(id);
        this.entries.set(id, pyramid);
        while (this.entries.size > this.capacity) {
            const oldest = this.entries.keys().next().value as string;
            this.entries.delete(oldest);
        }
        this.notify();
    }

    /** Peaks the caller built itself (the import, from the audio it decoded). */
    prime(id: string, pyramid: PeakPyramid): void {
        this.put(id, pyramid);
    }

    /** Ask again for an id once found missing (its media may have arrived since). */
    retry(id: string): void {
        if (this.missing.delete(id)) this.request([id]);
    }

    /** Start loading every id that is not here, not on its way, and not known missing. */
    request(ids: Iterable<string>): void {
        for (const id of ids) {
            if (this.entries.has(id) || this.inflight.has(id) || this.missing.has(id)) continue;
            void this.ensure(id);
        }
    }

    /** The peaks of `id`, loaded or built if need be. Null when the store does not hold the media. */
    ensure(id: string): Promise<PeakPyramid | null> {
        const hit = this.get(id);
        if (hit) return Promise.resolve(hit);
        const pending = this.inflight.get(id);
        if (pending) return pending;
        const promise = this.load(id).then(
            (pyramid) => {
                this.inflight.delete(id);
                if (pyramid) {
                    this.put(id, pyramid);
                } else {
                    this.missing.add(id);
                    this.notify();
                }
                return pyramid;
            },
            (err: unknown) => {
                this.inflight.delete(id);
                console.warn(`[peaks] ${id.slice(0, 12)}…: ${err instanceof Error ? err.message : String(err)}`);
                return null;
            },
        );
        this.inflight.set(id, promise);
        return promise;
    }

    private async load(id: string): Promise<PeakPyramid | null> {
        const stored = await this.store.readPeaks(id).catch(() => null);
        if (stored) return stored;
        const worker = await this.worker();
        if (worker) {
            const built = await new Promise<PeakPyramid | undefined>((resolve) => {
                this.jobs.set(id, resolve);
                worker.postMessage({ type: 'build', id } satisfies PeaksWorkerRequest);
            });
            if (built) return built;
        }
        // No worker, or it could not see the media (a different backend) or failed.
        const pyramid = await this.store.buildPeaks(id);
        if (pyramid) {
            await this.store.writePeaks(id, pyramid).catch((err: unknown) => {
                console.warn('[peaks] could not store built peaks:', err);
            });
        }
        return pyramid;
    }

    private worker(): Promise<PeaksWorker | null> {
        this.workerPromise ??= this.startWorker();
        return this.workerPromise;
    }

    private async startWorker(): Promise<PeaksWorker | null> {
        let create = this.createWorker;
        if (create === undefined) {
            if (typeof Worker === 'undefined') return null;
            // A worker opens its own store; on the in-memory backend it would see nothing.
            const kind = await this.store.backendKind().catch(() => 'memory' as const);
            if (kind === 'memory') return null;
            create = () => new Worker(peaksWorkerUrl, { type: 'module', name: 'hyphon-media-peaks' });
        }
        if (!create) return null;
        let worker: PeaksWorker;
        try {
            worker = create();
        } catch (err) {
            console.warn('[peaks] worker failed to start; building on the main thread:', err);
            return null;
        }
        worker.addEventListener('message', (event: MessageEvent<PeaksWorkerResponse>) => {
            const message = event.data;
            const job = this.jobs.get(message.id);
            if (!job) return;
            this.jobs.delete(message.id);
            if (message.type === 'peaks') {
                job(parsePeakFile(message.bytes) ?? undefined);
            } else {
                if (message.type === 'error') console.warn(`[peaks] worker: ${message.message}`);
                job(undefined);
            }
        });
        worker.addEventListener('error', () => {
            // A dead worker: hand its jobs back to this thread, and stop using it.
            console.warn('[peaks] worker failed; building on the main thread');
            worker.terminate();
            this.workerPromise = Promise.resolve(null);
            for (const job of this.jobs.values()) job(undefined);
            this.jobs.clear();
        });
        return worker;
    }
}

export const peakCache = new PeakCache();
